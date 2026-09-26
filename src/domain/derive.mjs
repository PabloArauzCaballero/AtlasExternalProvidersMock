/**
 * Derivación determinista: la misma persona obtiene siempre las mismas observaciones, y personas
 * distintas obtienen observaciones distintas.
 *
 * El hallazgo H09 del paquete QA suena menor —"QR devuelve 600 BOB y una fecha fija"— y no lo es.
 * Un emulador cuyo camino feliz responde constantes vuelve inútiles justo las aserciones que
 * importan: si `paidAmount` siempre es 600, el test que comprueba "el monto verificado coincide con
 * el monto cobrado" pasa sin haber comprobado nada, y seguiría pasando con el cobro de OTRA
 * persona. Lo mismo con `bureauScore` y `matchScore`: un motor que simula mil personas y recibe el
 * mismo 680 mil veces no está probando la elegibilidad, está probando una constante.
 *
 * La regla, entonces:
 *
 * - lo que el consumidor MANDÓ (monto, moneda, referencia, documento) se devuelve, no se inventa;
 * - lo que el proveedor OBSERVA (score, antigüedad, riesgo) se deriva por hash de la identidad de
 *   la persona, así que es estable entre llamadas y entre proveedores —el mismo documento produce
 *   observaciones coherentes en SEGIP, INFOCENTER y digital trust— y distinto por persona.
 *
 * No es aleatorio: sin semilla de proceso, sin `Math.random`, sin reloj. Repetir una corrida con
 * las mismas personas da las mismas observaciones.
 */

function fnv1a(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Identidad estable de la persona para este emulador. Se prueban en orden los campos que de verdad
 * identifican, y `personaKey` cierra la lista: una llamada del motor QA siempre la trae.
 */
export function identityOf(input = {}, personaKey = null) {
  const candidates = [
    input.documentNumber,
    input.document,
    input.ci,
    input.nationalId,
    input.customerId,
    input.phoneNumber,
    input.phone,
    input.email,
    personaKey,
  ];
  const found = candidates.find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  // Sin ningún identificador, la observación es la del caso base. Se marca para que el informe
  // pueda distinguir "la persona no tenía identidad" de "la persona dio este score".
  return found ? String(found).trim() : null;
}

/** Entero determinista en `[min, max]` a partir de la identidad y de para-qué se pide. */
export function derivedInt(identity, purpose, min, max) {
  if (identity === null) return Math.round((min + max) / 2);
  const span = max - min + 1;
  return min + (fnv1a(`${identity}|${purpose}`) % span);
}

/** Decimal determinista en `[min, max]` con `decimals` de precisión. */
export function derivedFloat(identity, purpose, min, max, decimals = 2) {
  if (identity === null) return Number(((min + max) / 2).toFixed(decimals));
  const unit = fnv1a(`${identity}|${purpose}`) / 0xffffffff;
  return Number((min + unit * (max - min)).toFixed(decimals));
}

export function derivedPick(identity, purpose, options) {
  if (identity === null) return options[0];
  return options[fnv1a(`${identity}|${purpose}`) % options.length];
}

/** Referencia del proveedor: estable por persona y por operación, y legible en un journal. */
export function derivedReference(prefix, identity, purpose) {
  if (identity === null) return `${prefix}-ANON`;
  return `${prefix}-${fnv1a(`${identity}|${purpose}`).toString(16).toUpperCase().padStart(8, "0")}`;
}

/** Monto tal como lo pidió el consumidor. `null` si no lo mandó: no se inventa un cobro. */
export function requestedAmount(input = {}) {
  const raw = input.amount ?? input.requestedAmount ?? input.paidAmount;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}

export function requestedCurrency(input = {}) {
  return typeof input.currency === "string" && input.currency.trim() !== ""
    ? input.currency.trim().toUpperCase()
    : "BOB";
}

export function requestedReference(input = {}) {
  const raw =
    input.reference ?? input.paymentReference ?? input.transactionReference;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}
