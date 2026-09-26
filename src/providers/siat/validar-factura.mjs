/**
 * Validación REAL de una factura de compra-venta, independiente del escenario pedido.
 *
 * Es lo que hace útil al emulador: un CUF mal calculado, un total que no cuadra o un CUFD de otro
 * día fallan aquí igual que fallarían en el SIN, aunque la corrida pida `happy_path`. Lo que no
 * puede comprobar sin el padrón del SIN (dirección, actividad del contribuyente, productos
 * homologados) NO se comprueba: eso sólo lo dice el piloto.
 */
import { calcularCuf } from "./cuf.mjs";
import { leerFactura } from "./xml.mjs";
import { instanteBolivia } from "./registro.mjs";

export const MAX_DETALLES = 500;
/** Tolerancia del emulador para `fechaEmision` en línea contra su reloj (a confirmar con el SIN). */
export const TOLERANCIA_EN_LINEA_MS = 5 * 60 * 1000;

const RAIZ_POR_MODALIDAD = {
  1: "facturaElectronicaCompraVenta",
  2: "facturaComputarizadaCompraVenta",
};

const CABECERA_OBLIGATORIA = [
  "nitEmisor",
  "razonSocialEmisor",
  "municipio",
  "numeroFactura",
  "cuf",
  "cufd",
  "codigoSucursal",
  "direccion",
  "fechaEmision",
  "codigoTipoDocumentoIdentidad",
  "numeroDocumento",
  "codigoCliente",
  "codigoMetodoPago",
  "montoTotal",
  "montoTotalSujetoIva",
  "codigoMoneda",
  "tipoCambio",
  "montoTotalMoneda",
  "leyenda",
  "usuario",
  "codigoDocumentoSector",
];

const DETALLE_OBLIGATORIO = [
  "actividadEconomica",
  "codigoProductoSin",
  "codigoProducto",
  "descripcion",
  "cantidad",
  "unidadMedida",
  "precioUnitario",
  "subTotal",
];

const DECIMAL = /^-?\d{1,15}(\.\d{1,5})?$/;
const ENTERO = /^\d{1,13}$/;

function numero(valor) {
  return valor !== null && valor !== undefined && DECIMAL.test(String(valor))
    ? Number(valor)
    : Number.NaN;
}

/** A céntimos, HALF-UP. El `1e-9` absorbe el error binario de `x.xx5`. */
function centimos(valor) {
  return Math.round(valor * 100 + (valor >= 0 ? 1e-9 : -1e-9));
}

/**
 * @param {Buffer} xml el XML ya descomprimido.
 * @param {object} contexto
 * @param {object} contexto.solicitud parámetros de la petición (nit, cufd, codigoModalidad, codigoEmision…).
 * @param {object} contexto.estado estado del NIT en el emulador.
 * @param {object} [contexto.evento] evento significativo del paquete (fuera de línea).
 * @param {number} [contexto.ahora] reloj del emulador (ms UTC).
 * @returns {{errores:number[], advertencias:number[], cuf:string|null, cabecera:object|null}}
 */
export function validarFactura(xml, { solicitud, estado, evento, ahora }) {
  const errores = [];
  const advertencias = [];
  let factura;
  try {
    factura = leerFactura(xml.toString("utf8"));
  } catch {
    return { errores: [939], advertencias, cuf: null, cabecera: null };
  }
  const { cabecera, detalle } = factura;

  // Forma del XSD: raíz de la modalidad, obligatorios presentes, ≤ 500 detalles, importes > 0.
  const faltan =
    factura.raiz !== RAIZ_POR_MODALIDAD[Number(solicitud.codigoModalidad)] ||
    CABECERA_OBLIGATORIA.some((campo) => cabecera[campo] == null) ||
    detalle.length > MAX_DETALLES ||
    detalle.some((linea) =>
      DETALLE_OBLIGATORIO.some((campo) => linea[campo] == null),
    );
  if (faltan) return { errores: [939], advertencias, cuf: null, cabecera };

  const positivos = [
    cabecera.montoTotal,
    cabecera.montoTotalMoneda,
    cabecera.tipoCambio,
    ...detalle.flatMap((linea) => [
      linea.cantidad,
      linea.precioUnitario,
      linea.subTotal,
    ]),
  ].map(numero);
  if (
    positivos.some((valor) => !(valor > 0)) ||
    !ENTERO.test(cabecera.nitEmisor) ||
    !ENTERO.test(cabecera.numeroFactura)
  )
    return { errores: [939], advertencias, cuf: null, cabecera };

  // Emisor y CUFD.
  if (String(cabecera.nitEmisor) !== String(solicitud.nit)) errores.push(1001);
  const fueraDeLinea = Number(solicitud.codigoEmision) === 2;
  const cufdEsperado = fueraDeLinea ? evento?.cufdEvento : solicitud.cufd;
  if (cabecera.cufd !== cufdEsperado) errores.push(fueraDeLinea ? 1006 : 1003);
  const cufd = estado.cufd[cabecera.cufd];
  if (
    cufd &&
    (Number(cufd.codigoSucursal) !== Number(cabecera.codigoSucursal) ||
      Number(cufd.codigoPuntoVenta) !== Number(cabecera.codigoPuntoVenta ?? 0))
  )
    errores.push(1004);

  // CUF recalculado: nunca por longitud.
  const cuf = cufd
    ? calcularCuf({
        nit: cabecera.nitEmisor,
        fechaEmision: cabecera.fechaEmision,
        codigoSucursal: cabecera.codigoSucursal,
        codigoModalidad: solicitud.codigoModalidad,
        codigoEmision: solicitud.codigoEmision,
        tipoFacturaDocumento: solicitud.tipoFacturaDocumento,
        codigoDocumentoSector: cabecera.codigoDocumentoSector,
        numeroFactura: cabecera.numeroFactura,
        codigoPuntoVenta: cabecera.codigoPuntoVenta ?? 0,
        codigoControl: cufd.codigoControl,
      })
    : null;
  if (!cufd) errores.push(fueraDeLinea ? 1006 : 1003);
  else if (cuf !== cabecera.cuf) errores.push(1002);

  // Datos del comprador.
  if (
    cabecera.complemento != null &&
    Number(cabecera.codigoTipoDocumentoIdentidad) !== 1
  )
    errores.push(1011);
  if (cabecera.numeroTarjeta != null && Number(cabecera.codigoMetodoPago) !== 2)
    errores.push(1012);

  // Montos: fórmulas del sector 1, importes con IVA, HALF-UP a 2 decimales.
  let suma = 0;
  for (const linea of detalle) {
    const esperado = centimos(
      numero(linea.cantidad) * numero(linea.precioUnitario) -
        (numero(linea.montoDescuento ?? 0) || 0),
    );
    if (esperado !== centimos(numero(linea.subTotal))) {
      errores.push(1018);
      break;
    }
    suma += centimos(numero(linea.subTotal));
  }
  const descuentoAdicional = centimos(
    numero(cabecera.descuentoAdicional ?? 0) || 0,
  );
  if (
    !errores.includes(1018) &&
    suma - descuentoAdicional !== centimos(numero(cabecera.montoTotal))
  )
    errores.push(1013);

  // Fecha de emisión: en línea contra el reloj; fuera de línea dentro del evento.
  const emitida = instanteBolivia(cabecera.fechaEmision);
  if (Number.isNaN(emitida)) errores.push(939);
  else if (!fueraDeLinea) {
    if (Math.abs((ahora ?? Date.now()) - emitida) > TOLERANCIA_EN_LINEA_MS)
      errores.push(1009);
  } else if (evento) {
    const inicio = instanteBolivia(evento.fechaHoraInicioEvento);
    const fin = instanteBolivia(evento.fechaHoraFinEvento);
    if (emitida < inicio || emitida > fin) advertencias.push(2001);
  }

  // Duplicados: el mismo CUF es 952 (consultar, no fallar); el mismo número con otro CUF, aviso.
  if (cabecera.cuf && estado.facturas[cabecera.cuf]) errores.push(952);
  const clave = `${Number(cabecera.codigoSucursal)}|${Number(cabecera.codigoPuntoVenta ?? 0)}`;
  const usado = estado.numeros[clave]?.[cabecera.numeroFactura];
  if (usado && usado !== cabecera.cuf) advertencias.push(2000);

  return {
    errores: [...new Set(errores)],
    advertencias,
    cuf: cabecera.cuf,
    cabecera,
  };
}
