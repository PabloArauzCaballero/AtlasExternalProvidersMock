/**
 * Código Único de Factura (CUF), tal como lo calcula el SIN.
 *
 * El emulador lo RECALCULA en cada recepción y lo compara con el que trae el XML: un CUF que no
 * coincide es un 1002 en el SIN, y aceptarlo aquí sería dejar pasar exactamente el error que más
 * cuesta encontrar en el piloto. La longitud del CUF depende del NIT (56 con 9 dígitos, 57 con
 * 10), así que nunca se comprueba por longitud: se recalcula.
 *
 * Verificado contra los tres vectores oficiales (siatinfo «Generación CUF» y los XML de
 * compra-venta); ver `test/siat.test.mjs`.
 */

/** Módulo 11 del SIN: pesos 2..9 cíclicos desde la derecha; 10 → '1', 11 → '0'. */
export function modulo11(cadena) {
  let suma = 0;
  let mult = 2;
  for (let i = cadena.length - 1; i >= 0; i -= 1) {
    suma += mult * Number(cadena[i]);
    mult = mult === 9 ? 2 : mult + 1;
  }
  const dig = suma % 11;
  if (dig === 10) return "1";
  if (dig === 11) return "0";
  return String(dig);
}

/** `2021-10-06T16:03:48.675` → `20211006160348675`. Sin zona: la hora es la local del emisor. */
export function fechaParaCuf(fechaEmision) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(
      String(fechaEmision ?? "").trim(),
    );
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms = "0"] = match;
  return `${y}${mo}${d}${h}${mi}${s}${ms.padEnd(3, "0")}`;
}

function pad(value, width) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text) || text.length > width) return null;
  return text.padStart(width, "0");
}

/**
 * @returns {string|null} el CUF, o `null` si algún campo no tiene la forma que exige el algoritmo.
 */
export function calcularCuf({
  nit,
  fechaEmision,
  codigoSucursal,
  codigoModalidad,
  codigoEmision,
  tipoFacturaDocumento,
  codigoDocumentoSector,
  numeroFactura,
  codigoPuntoVenta,
  codigoControl,
}) {
  const partes = [
    pad(nit, 13),
    fechaParaCuf(fechaEmision),
    pad(codigoSucursal, 4),
    pad(codigoModalidad, 1),
    pad(codigoEmision, 1),
    pad(tipoFacturaDocumento, 1),
    pad(codigoDocumentoSector, 2),
    pad(numeroFactura, 10),
    pad(codigoPuntoVenta ?? 0, 4),
  ];
  if (partes.some((parte) => parte === null) || !codigoControl) return null;
  const cadena = partes.join("");
  const conDigito = cadena + modulo11(cadena);
  return BigInt(conDigito).toString(16).toUpperCase() + codigoControl;
}
