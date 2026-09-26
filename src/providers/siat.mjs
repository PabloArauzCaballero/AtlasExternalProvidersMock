/**
 * Emulador del SIAT (Servicio de Impuestos Nacionales de Bolivia) para la facturación en línea.
 *
 * El SIN habla SOAP; este emulador habla el JSON del resto del mock, con los MISMOS nombres de
 * campo que el WSDL del piloto (`referencia-sin/wsdl/*.inner.wsdl` del plan de facturación): la
 * petición lleva en `input` los campos de la `Solicitud…` de esa operación y la respuesta los de su
 * `Respuesta…`. Así el ERP arma un único dominio fiscal y sólo cambia el sobre al pasar al piloto.
 *
 * Lo que valida de verdad, pida la corrida el escenario que pida: token, ambiente, CUIS y CUFD
 * vigentes, gzip y hash del archivo, forma del XML, CUF recalculado, totales, fecha de emisión,
 * duplicados, formato tar+gzip del paquete y su cantidad, plazo de anulación. Lo que no puede
 * validar sin el padrón (dirección, actividades y productos del contribuyente) lo dice el piloto.
 * Los catálogos son de prueba y van marcados.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  CATALOGOS,
  ahoraBolivia,
  claveSucursal,
  conEstado,
  fechaVigencia,
  hexAleatorio,
  instanteBolivia,
  listaMensajes,
  mensaje,
  nuevoCodigoRecepcion,
  nuevoCufd,
} from "./siat/registro.mjs";
import { leerTar } from "./siat/tar.mjs";
import { validarFactura } from "./siat/validar-factura.mjs";

export const code = "SIAT_SIN";
export const slug = "siat";
export const mountPath = "/mock/siat";
export const operationPath = "/compra-venta/recepcionFactura";

export const domain = "Fiscal (SIN Bolivia)";
export const description =
  "Facturación en línea del SIN: CUIS, CUFD, sincronización de catálogos, eventos significativos y recepción, paquetes, verificación y anulación de facturas de compra-venta.";
export const latencyRangeMs = [300, 1500];

const CODIGOS = ["cuis", "cufd", "verificarNit", "verificarComunicacion"];
export const SINCRONIZACIONES = [
  "sincronizarActividades",
  "sincronizarFechaHora",
  "sincronizarListaActividadesDocumentoSector",
  "sincronizarListaLeyendasFactura",
  "sincronizarListaMensajesServicios",
  "sincronizarListaProductosServicios",
  "sincronizarParametricaEventosSignificativos",
  "sincronizarParametricaMotivoAnulacion",
  "sincronizarParametricaPaisOrigen",
  "sincronizarParametricaTipoDocumentoIdentidad",
  "sincronizarParametricaTipoDocumentoSector",
  "sincronizarParametricaTipoEmision",
  "sincronizarParametricaTipoHabitacion",
  "sincronizarParametricaTipoMetodoPago",
  "sincronizarParametricaTipoMoneda",
  "sincronizarParametricaTipoPuntoVenta",
  "sincronizarParametricaTiposFactura",
  "sincronizarParametricaUnidadMedida",
];
const OPERACIONES = [
  "registroEventoSignificativo",
  "consultaEventoSignificativo",
  "registroPuntoVenta",
  "consultaPuntoVenta",
];
const COMPRA_VENTA = [
  "recepcionFactura",
  "recepcionPaqueteFactura",
  "validacionRecepcionPaqueteFactura",
  "verificacionEstadoFactura",
  "anulacionFactura",
  "reversionAnulacionFactura",
];

// Explícitas, una por operación: el router del mock no entrega `:param` al proveedor.
export const operations = [
  ...CODIGOS.map((o) => ({
    path: `/codigos/${o}`,
    method: "POST",
    summary: `FacturacionCodigos · ${o}`,
  })),
  ...SINCRONIZACIONES.map((o) => ({
    path: `/sincronizacion/${o}`,
    method: "POST",
    summary: `FacturacionSincronizacion · ${o}`,
  })),
  ...OPERACIONES.map((o) => ({
    path: `/operaciones/${o}`,
    method: "POST",
    summary: `FacturacionOperaciones · ${o}`,
  })),
  ...COMPRA_VENTA.map((o) => ({
    path: `/compra-venta/${o}`,
    method: "POST",
    summary: `ServicioFacturacionCompraVenta · ${o}`,
  })),
];

/** Ver el anexo D del plan: qué representa cada escenario en el dominio fiscal. */
export const handledScenarios = [
  "happy_path",
  "partial_match",
  "low_confidence",
  "manual_review_required",
  "not_found",
  "expired_token",
  "duplicate_request",
  "data_not_available",
  "fraud_signal_high",
  "cost_blocked",
  "revoked_consent",
];

const AMBIENTE_PILOTO = 2;
const DIA_MS = 24 * 60 * 60 * 1000;
const VIGENCIA_CUIS_MS = 365 * DIA_MS;
const VIGENCIA_CUFD_MS = DIA_MS;
const MAX_FACTURAS_PAQUETE = 500;
/** Cuántas validaciones de un paquete responden 901 antes del resultado final. */
const VALIDACIONES_PENDIENTES = 1;

/* ------------------------------------------------------------- respuestas */

function base(operacion, escenario, cuerpo) {
  return {
    provider: code,
    operacion,
    status: cuerpo.transaccion ? "OK" : "RECHAZADO",
    ...cuerpo,
    escenario,
    simulated: true,
  };
}

function rechazo(codigos, extra = {}) {
  return {
    transaccion: false,
    mensajesList: [codigos].flat().map((codigo) => mensaje(codigo)),
    ...extra,
  };
}

const DESCRIPCION_ESTADO = {
  901: "PENDIENTE",
  902: "RECHAZADA",
  904: "OBSERVADA",
  905: "ANULACION CONFIRMADA",
  906: "ANULACION RECHAZADA",
  907: "REVERSION DE ANULACION CONFIRMADA",
  908: "VALIDADA",
  909: "REVERSION DE ANULACION RECHAZADA",
};

function recepcion(codigoEstado, { codigoRecepcion, mensajes = [] } = {}) {
  return {
    codigoDescripcion: DESCRIPCION_ESTADO[codigoEstado],
    codigoEstado,
    codigoRecepcion: codigoRecepcion ?? null,
    mensajesList: mensajes,
    transaccion:
      codigoEstado !== 902 && codigoEstado !== 906 && codigoEstado !== 909,
  };
}

/* ------------------------------------------------------------ validaciones */

function tokenValido(ctx) {
  const valor = ctx.headers?.apikey;
  return typeof valor === "string" && /^TokenApi\s+\S+/.test(valor.trim());
}

/** Ambiente, sistema y NIT: lo primero que mira el SIN en toda solicitud con datos. */
function validarSistema(input) {
  if (Number(input.codigoAmbiente) !== AMBIENTE_PILOTO) return 910;
  if (!String(input.codigoSistema ?? "").trim()) return 911;
  if (!/^\d{1,13}$/.test(String(input.nit ?? ""))) return 919;
  return null;
}

function cuisVigente(estado, input, ahora) {
  const cuis = Object.values(estado.cuis).find((c) => c.codigo === input.cuis);
  if (!cuis) return { error: 913 };
  if (cuis.venceEn <= ahora) return { error: 929 };
  if (
    cuis.clave !== claveSucursal(input.codigoSucursal, input.codigoPuntoVenta)
  )
    return { error: 930 };
  return { cuis };
}

function cufdVigente(estado, codigo, ahora) {
  const cufd = estado.cufd[codigo];
  if (!cufd) return { error: 914 };
  if (cufd.venceEn <= ahora) return { error: 953 };
  return { cufd };
}

/** Base de toda solicitud de recepción (`solicitudRecepcion` del WSDL). */
function validarRecepcion(
  estado,
  input,
  ahora,
  { cufdObligatorio = true } = {},
) {
  const sistema = validarSistema(input);
  if (sistema) return sistema;
  if (Number(input.codigoDocumentoSector) !== 1) return 932;
  if (![1, 2].includes(Number(input.codigoModalidad))) return 917;
  if (![1, 2].includes(Number(input.codigoEmision))) return 916;
  if (![1, 2].includes(Number(input.tipoFacturaDocumento))) return 915;
  const cuis = cuisVigente(estado, input, ahora);
  if (cuis.error) return cuis.error;
  if (cufdObligatorio) {
    const cufd = cufdVigente(estado, input.cufd, ahora);
    if (cufd.error) return cufd.error;
  }
  return null;
}

/** `archivo` base64 → gzip → contenido, y el hash contra `hashArchivo`. */
function abrirArchivo(input) {
  if (typeof input.archivo !== "string" || input.archivo === "")
    return { error: 920 };
  const bytes = Buffer.from(input.archivo, "base64");
  let contenido;
  try {
    contenido = gunzipSync(bytes);
  } catch {
    return { error: 920 };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== String(input.hashArchivo ?? "").toLowerCase())
    return { error: 969 };
  return { contenido };
}

function fechaEnvioValida(fechaEnvio) {
  return !Number.isNaN(instanteBolivia(fechaEnvio));
}

/* -------------------------------------------------------------- operaciones */

function cuis(input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  if (![1, 2].includes(Number(input.codigoModalidad))) return rechazo(917);
  const clave = claveSucursal(input.codigoSucursal, input.codigoPuntoVenta);
  return conEstado(ctx, input.nit, (estado) => {
    const vigente = estado.cuis[clave];
    // El SIN responde 980 si ya hay uno vigente, y devuelve el código igualmente.
    if (vigente && vigente.venceEn > ahora)
      return {
        codigo: vigente.codigo,
        fechaVigencia: fechaVigencia(vigente.venceEn),
        ...rechazo(980),
      };
    const nuevo = {
      codigo: hexAleatorio(4),
      clave,
      codigoModalidad: Number(input.codigoModalidad),
      venceEn: ahora + VIGENCIA_CUIS_MS,
    };
    estado.cuis[clave] = nuevo;
    return {
      codigo: nuevo.codigo,
      fechaVigencia: fechaVigencia(nuevo.venceEn),
      mensajesList: [],
      transaccion: true,
    };
  });
}

function cufd(input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  return conEstado(ctx, input.nit, (estado) => {
    const vigente = cuisVigente(estado, input, ahora);
    if (vigente.error) return rechazo(vigente.error);
    const { codigo, codigoControl } = nuevoCufd(input);
    const registro = {
      codigo,
      codigoControl,
      direccion: "CALLE SIMULADA N° 1, LA PAZ (emulador)",
      codigoSucursal: Number(input.codigoSucursal ?? 0),
      codigoPuntoVenta: Number(input.codigoPuntoVenta ?? 0),
      venceEn: ahora + VIGENCIA_CUFD_MS,
    };
    estado.cufd[codigo] = registro;
    return {
      codigo,
      codigoControl,
      direccion: registro.direccion,
      fechaVigencia: fechaVigencia(registro.venceEn),
      mensajesList: [],
      transaccion: true,
    };
  });
}

function verificarNit(input, ctx, ahora, escenario) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  const sinCuis = conEstado(
    ctx,
    input.nit,
    (estado) => cuisVigente(estado, input, ahora).error,
  );
  if (sinCuis) return rechazo(sinCuis);
  const objetivo = String(input.nitParaVerificacion ?? "");
  if (escenario === "not_found" || !/^\d{5,13}$/.test(objetivo))
    return rechazo(994);
  if (escenario === "fraud_signal_high") return rechazo(938);
  return { mensajesList: [mensaje(986)], transaccion: true };
}

function sincronizar(nombre, input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  const sinCuis = conEstado(
    ctx,
    input.nit,
    (estado) => cuisVigente(estado, input, ahora).error,
  );
  if (sinCuis) return rechazo(sinCuis);
  if (nombre === "sincronizarFechaHora")
    return {
      fechaHora: ahoraBolivia(ahora),
      mensajesList: [],
      transaccion: true,
    };
  if (nombre === "sincronizarListaMensajesServicios")
    return {
      listaCodigos: listaMensajes(),
      mensajesList: [],
      transaccion: true,
      catalogoDePrueba: false,
    };
  const catalogo = CATALOGOS[nombre];
  return {
    [catalogo.campo]: catalogo.items,
    mensajesList: [],
    transaccion: true,
    // Declarado: estos valores son del emulador, no del SIN.
    catalogoDePrueba: true,
  };
}

function registroEventoSignificativo(input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  return conEstado(ctx, input.nit, (estado) => {
    const vigente = cuisVigente(estado, input, ahora);
    if (vigente.error) return rechazo(vigente.error);
    const actual = cufdVigente(estado, input.cufd, ahora);
    if (actual.error) return rechazo(actual.error);
    if (!estado.cufd[input.cufdEvento]) return rechazo(984);
    const motivos = CATALOGOS.sincronizarParametricaEventosSignificativos.items;
    if (
      !motivos.some(
        (m) => m.codigoClasificador === Number(input.codigoMotivoEvento),
      )
    )
      return rechazo(976);
    if (!input.fechaHoraFinEvento) return rechazo(960);
    const inicio = instanteBolivia(input.fechaHoraInicioEvento);
    const fin = instanteBolivia(input.fechaHoraFinEvento);
    if (
      Number.isNaN(inicio) ||
      Number.isNaN(fin) ||
      inicio >= fin ||
      fin > ahora
    )
      return rechazo(974);
    const codigoRecepcion = 1_000_000 + estado.siguienteEvento;
    estado.siguienteEvento += 1;
    estado.eventos[codigoRecepcion] = {
      codigoRecepcionEventoSignificativo: codigoRecepcion,
      codigoEvento: Number(input.codigoMotivoEvento),
      descripcion: String(input.descripcion ?? ""),
      cufdEvento: input.cufdEvento,
      fechaHoraInicioEvento: input.fechaHoraInicioEvento,
      fechaHoraFinEvento: input.fechaHoraFinEvento,
      clave: claveSucursal(input.codigoSucursal, input.codigoPuntoVenta),
    };
    return {
      codigoRecepcionEventoSignificativo: codigoRecepcion,
      mensajesList: [],
      transaccion: true,
    };
  });
}

function consultaEventoSignificativo(input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  return conEstado(ctx, input.nit, (estado) => {
    const vigente = cuisVigente(estado, input, ahora);
    if (vigente.error) return rechazo(vigente.error);
    const dia = String(input.fechaEvento ?? "").slice(0, 10);
    const listaCodigos = Object.values(estado.eventos)
      .filter((e) => e.fechaHoraInicioEvento.slice(0, 10) === dia)
      .map((e) => ({
        codigoEvento: e.codigoEvento,
        codigoRecepcionEventoSignificativo:
          e.codigoRecepcionEventoSignificativo,
        descripcion: e.descripcion,
        fechaInicio: e.fechaHoraInicioEvento,
        fechaFin: e.fechaHoraFinEvento,
      }));
    return { listaCodigos, mensajesList: [], transaccion: true };
  });
}

function registroPuntoVenta(input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  const tipos = CATALOGOS.sincronizarParametricaTipoPuntoVenta.items;
  if (
    !tipos.some(
      (t) => t.codigoClasificador === Number(input.codigoTipoPuntoVenta),
    )
  )
    return rechazo(947);
  return conEstado(ctx, input.nit, (estado) => {
    const vigente = cuisVigente(
      estado,
      { ...input, codigoPuntoVenta: 0 },
      ahora,
    );
    if (vigente.error) return rechazo(vigente.error);
    const codigoPuntoVenta = Object.keys(estado.puntosVenta).length + 1;
    estado.puntosVenta[codigoPuntoVenta] = {
      codigoPuntoVenta,
      nombrePuntoVenta: String(input.nombrePuntoVenta ?? ""),
      tipoPuntoVenta: Number(input.codigoTipoPuntoVenta),
    };
    return { codigoPuntoVenta, mensajesList: [], transaccion: true };
  });
}

function consultaPuntoVenta(input, ctx, ahora) {
  const error = validarSistema(input);
  if (error) return rechazo(error);
  return conEstado(ctx, input.nit, (estado) => {
    const vigente = cuisVigente(
      estado,
      { ...input, codigoPuntoVenta: 0 },
      ahora,
    );
    if (vigente.error) return rechazo(vigente.error);
    return {
      listaPuntosVentas: Object.values(estado.puntosVenta),
      mensajesList: [],
      transaccion: true,
    };
  });
}

/** Mensajes de una factura con su número de archivo (en paquetes). */
function mensajesDe({ errores, advertencias }, numeroArchivo) {
  const extra = numeroArchivo === undefined ? {} : { numeroArchivo };
  return [
    ...errores.map((c) => mensaje(c, { advertencia: false, ...extra })),
    ...advertencias.map((c) => mensaje(c, { advertencia: true, ...extra })),
  ];
}

/** Lo que el escenario de negocio le hace a una factura que la validación real dejó pasar. */
function efectoDeEscenario(escenario) {
  switch (escenario) {
    case "partial_match":
      return { errores: [1013], advertencias: [] };
    case "low_confidence":
      return { errores: [], advertencias: [2000] };
    case "manual_review_required":
      return { errores: [1009], advertencias: [] };
    case "fraud_signal_high":
      return { rechazo: 938 };
    case "revoked_consent":
      return { rechazo: 965 };
    default:
      return null;
  }
}

function registrarFactura(estado, resultado, codigoEstado, codigoRecepcion) {
  const { cabecera } = resultado;
  estado.facturas[resultado.cuf] = {
    cuf: resultado.cuf,
    codigoEstado,
    codigoRecepcion,
    numeroFactura: cabecera.numeroFactura,
    fechaEmision: cabecera.fechaEmision,
    anulada: false,
  };
  const clave = claveSucursal(
    cabecera.codigoSucursal,
    cabecera.codigoPuntoVenta,
  );
  estado.numeros[clave] ??= {};
  estado.numeros[clave][cabecera.numeroFactura] ??= resultado.cuf;
}

function recepcionFactura(input, ctx, ahora, escenario) {
  if (!fechaEnvioValida(input.fechaEnvio))
    return recepcion(902, { mensajes: [mensaje(943)] });
  return conEstado(ctx, input.nit, (estado) => {
    const base = validarRecepcion(estado, input, ahora);
    if (base) return recepcion(902, { mensajes: [mensaje(base)] });
    if (Number(input.codigoEmision) !== 1)
      return recepcion(902, { mensajes: [mensaje(916)] });
    const archivo = abrirArchivo(input);
    if (archivo.error)
      return recepcion(902, { mensajes: [mensaje(archivo.error)] });

    const resultado = validarFactura(archivo.contenido, {
      solicitud: input,
      estado,
      ahora,
    });
    const efecto =
      resultado.errores.length === 0 ? efectoDeEscenario(escenario) : null;
    if (efecto?.rechazo)
      return recepcion(902, { mensajes: [mensaje(efecto.rechazo)] });
    if (efecto) {
      resultado.errores.push(...efecto.errores);
      resultado.advertencias.push(...efecto.advertencias);
    }

    // `duplicate_request`: la factura YA entró (un envío anterior cuya respuesta se perdió). El
    // SIN contesta 952 y el ERP tiene que consultar el estado y adoptarlo, no reenviar.
    if (escenario === "duplicate_request" && resultado.errores.length === 0) {
      registrarFactura(estado, resultado, 908, nuevoCodigoRecepcion());
      return recepcion(902, { mensajes: [mensaje(952)] });
    }

    // Errores de coherencia (CUF, CUFD, hash…) → rechazada. Los de negocio de un escenario → observada.
    const soloEscenario =
      efecto && resultado.errores.every((c) => efecto.errores?.includes(c));
    if (resultado.errores.length > 0 && !soloEscenario)
      return recepcion(902, { mensajes: mensajesDe(resultado) });

    const codigoEstado =
      resultado.errores.length > 0 || resultado.advertencias.length > 0
        ? 904
        : 908;
    const codigoRecepcion = nuevoCodigoRecepcion();
    registrarFactura(estado, resultado, codigoEstado, codigoRecepcion);
    return recepcion(codigoEstado, {
      codigoRecepcion,
      mensajes: mensajesDe(resultado),
    });
  });
}

function recepcionPaqueteFactura(input, ctx, ahora, escenario) {
  if (!fechaEnvioValida(input.fechaEnvio))
    return recepcion(902, { mensajes: [mensaje(943)] });
  return conEstado(ctx, input.nit, (estado) => {
    const base = validarRecepcion(estado, input, ahora);
    if (base) return recepcion(902, { mensajes: [mensaje(base)] });
    if (Number(input.codigoEmision) !== 2)
      return recepcion(902, { mensajes: [mensaje(916)] });
    const evento = estado.eventos[input.codigoEvento];
    if (!evento) return recepcion(902, { mensajes: [mensaje(957)] });
    const archivo = abrirArchivo(input);
    if (archivo.error)
      return recepcion(902, { mensajes: [mensaje(archivo.error)] });

    // Un XML por factura dentro de un tar: una concatenación o un XML suelto no es un paquete.
    let facturas;
    try {
      facturas = leerTar(archivo.contenido);
    } catch {
      return recepcion(902, { mensajes: [mensaje(920)] });
    }
    if (facturas.length === 0)
      return recepcion(902, { mensajes: [mensaje(920)] });
    if (facturas.length > MAX_FACTURAS_PAQUETE)
      return recepcion(902, { mensajes: [mensaje(954)] });
    if (facturas.length !== Number(input.cantidadFacturas))
      return recepcion(902, { mensajes: [mensaje(985)] });

    const mensajes = [];
    let observada = false;
    facturas.forEach(({ contenido }, indice) => {
      const resultado = validarFactura(contenido, {
        solicitud: input,
        estado,
        evento,
        ahora,
      });
      mensajes.push(...mensajesDe(resultado, indice));
      if (resultado.errores.length > 0 || resultado.advertencias.length > 0)
        observada = true;
      if (resultado.errores.length === 0)
        registrarFactura(estado, resultado, 908, null);
    });

    const codigoRecepcion = nuevoCodigoRecepcion();
    estado.paquetes[codigoRecepcion] = {
      validaciones: 0,
      siemprePendiente: escenario === "data_not_available",
      resultado: observada ? 904 : 908,
      mensajes,
    };
    return recepcion(901, { codigoRecepcion });
  });
}

function validacionRecepcionPaqueteFactura(input, ctx, ahora) {
  return conEstado(ctx, input.nit, (estado) => {
    const base = validarRecepcion(estado, input, ahora);
    if (base) return recepcion(902, { mensajes: [mensaje(base)] });
    const paquete = estado.paquetes[input.codigoRecepcion];
    if (!paquete) return recepcion(902, { mensajes: [mensaje(944)] });
    paquete.validaciones += 1;
    if (
      paquete.siemprePendiente ||
      paquete.validaciones <= VALIDACIONES_PENDIENTES
    )
      return recepcion(901, { codigoRecepcion: input.codigoRecepcion });
    return recepcion(paquete.resultado, {
      codigoRecepcion: input.codigoRecepcion,
      mensajes: paquete.mensajes,
    });
  });
}

function verificacionEstadoFactura(input, ctx, ahora, escenario) {
  return conEstado(ctx, input.nit, (estado) => {
    const base = validarRecepcion(estado, input, ahora);
    if (base) return recepcion(902, { mensajes: [mensaje(base)] });
    const factura = estado.facturas[input.cuf];
    if (!factura || escenario === "not_found")
      return recepcion(902, { mensajes: [mensaje(946)] });
    return recepcion(factura.anulada ? 905 : factura.codigoEstado, {
      codigoRecepcion: factura.codigoRecepcion,
    });
  });
}

/** Plazo de anulación: hasta el día 9 del mes siguiente a la emisión (hora de Bolivia). */
function dentroDePlazo(fechaEmision, ahora) {
  const [anio, mes] = String(fechaEmision).slice(0, 7).split("-").map(Number);
  const limite = instanteBolivia(
    `${mes === 12 ? anio + 1 : anio}-${String(mes === 12 ? 1 : mes + 1).padStart(2, "0")}-09T23:59:59.999`,
  );
  return ahora <= limite;
}

function anulacionFactura(input, ctx, ahora, escenario) {
  return conEstado(ctx, input.nit, (estado) => {
    const base = validarRecepcion(estado, input, ahora);
    if (base) return recepcion(906, { mensajes: [mensaje(base)] });
    const motivos = CATALOGOS.sincronizarParametricaMotivoAnulacion.items;
    if (
      !motivos.some((m) => m.codigoClasificador === Number(input.codigoMotivo))
    )
      return recepcion(906, { mensajes: [mensaje(925)] });
    const factura = estado.facturas[input.cuf];
    if (!factura || escenario === "not_found")
      return recepcion(906, { mensajes: [mensaje(946)] });
    if (factura.anulada) return recepcion(906, { mensajes: [mensaje(936)] });
    if (!dentroDePlazo(factura.fechaEmision, ahora))
      return recepcion(906, { mensajes: [mensaje(934)] });
    factura.anulada = true;
    factura.codigoMotivo = Number(input.codigoMotivo);
    return recepcion(905, { codigoRecepcion: nuevoCodigoRecepcion() });
  });
}

function reversionAnulacionFactura(input, ctx, ahora, escenario) {
  return conEstado(ctx, input.nit, (estado) => {
    const base = validarRecepcion(estado, input, ahora);
    if (base) return recepcion(909, { mensajes: [mensaje(base)] });
    const factura = estado.facturas[input.cuf];
    if (!factura || escenario === "not_found")
      return recepcion(909, { mensajes: [mensaje(946)] });
    if (!factura.anulada) return recepcion(909, { mensajes: [mensaje(945)] });
    factura.anulada = false;
    return recepcion(907, { codigoRecepcion: nuevoCodigoRecepcion() });
  });
}

const MANEJADORES = {
  cuis,
  cufd,
  verificarNit,
  registroEventoSignificativo,
  consultaEventoSignificativo,
  registroPuntoVenta,
  consultaPuntoVenta,
  recepcionFactura,
  recepcionPaqueteFactura,
  validacionRecepcionPaqueteFactura,
  verificacionEstadoFactura,
  anulacionFactura,
  reversionAnulacionFactura,
};

/** Escenarios que cortan ANTES de la lógica, porque son del sistema y no de la factura. */
function cortePorEscenario(escenario, nombre) {
  if (escenario === "cost_blocked") return rechazo(975);
  const usaCufd =
    nombre.startsWith("recepcion") || nombre === "anulacionFactura";
  if (escenario === "expired_token" && usaCufd)
    return recepcion(902, { mensajes: [mensaje(953)] });
  return null;
}

/** Qué escenario representa esta operación; los demás se registran como no aplicados. */
function escenarioAplicado(escenario, nombre) {
  if (escenario === "happy_path" || escenario === "cost_blocked") return true;
  const porOperacion = {
    recepcionFactura: [
      "partial_match",
      "low_confidence",
      "manual_review_required",
      "expired_token",
      "duplicate_request",
      "fraud_signal_high",
      "revoked_consent",
    ],
    recepcionPaqueteFactura: ["expired_token", "data_not_available"],
    verificacionEstadoFactura: ["not_found"],
    anulacionFactura: ["not_found", "expired_token"],
    reversionAnulacionFactura: ["not_found"],
    verificarNit: ["not_found", "fraud_signal_high"],
  };
  return (porOperacion[nombre] ?? []).includes(escenario);
}

export function respond(
  scenario,
  input = {},
  operation = operationPath,
  ctx = {},
) {
  const nombre = operation.split("/").pop();
  const ahora = Date.now();
  const escenario = {
    solicitado: scenario,
    // Un escenario que esta operación no sabe representar NO se disfraza de éxito: se dice.
    aplicado: escenarioAplicado(scenario, nombre),
  };

  if (!tokenValido(ctx)) return base(nombre, escenario, rechazo(989));
  if (nombre === "verificarComunicacion")
    return base(nombre, escenario, {
      mensajesList: [mensaje(926)],
      transaccion: true,
    });

  const corte = cortePorEscenario(scenario, nombre);
  if (corte) return base(nombre, escenario, corte);

  const datos = input && typeof input === "object" ? input : {};
  const cuerpo = SINCRONIZACIONES.includes(nombre)
    ? sincronizar(nombre, datos, ctx, ahora)
    : MANEJADORES[nombre](datos, ctx, ahora, scenario);
  return base(nombre, escenario, cuerpo);
}
