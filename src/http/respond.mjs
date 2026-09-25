/**
 * Una sola salida para todas las respuestas, y una sola forma de error.
 *
 * Dos motivos concretos:
 *
 * 1. **No responder dos veces.** Con esperas (`latencyMs`) y cortes del cliente en medio, era fácil
 *    que un handler llamara `send` después de que la conexión ya hubiera terminado; Node lanza
 *    `ERR_STREAM_WRITE_AFTER_END` y el proceso se cae dentro de un `.catch` que vuelve a intentar
 *    escribir. `sendJson` comprueba `writableEnded` y no escribe sobre una respuesta cerrada.
 * 2. **No filtrar el stack.** El handler de error anterior devolvía `error.message` tal cual. Un
 *    emulador que contesta con su propio stack trace es una fuga gratuita; aquí el detalle interno
 *    va al log estructurado y al cliente sólo le llega un código estable.
 *
 * Y una tercera, desde el plan de producción (TSK-MOCK-02): **toda respuesta dice que es simulada.**
 * Cabecera `x-atlas-simulated: true` en todas —éxito, error, salud, el JSON roto de
 * `invalid_payload`— y campo `simulated: true` en todo cuerpo JSON de objeto. Antes sólo cuatro de
 * los ocho proveedores llevaban una pista (`providerReference` con `MOCK`), y un consumidor apuntado
 * aquí por error no podía distinguirlo de un proveedor real por el contenido. El campo va al final
 * y no pisa nada: el validador de contrato de AtlasBackend (`provider-response.contract.ts`) sólo
 * exige campos, no prohíbe los que sobran.
 */

export const SIMULATED_HEADER = "x-atlas-simulated";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sendJson(res, statusCode, payload, headers = {}) {
  if (res.writableEnded || res.destroyed) return false;
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", ...headers, [SIMULATED_HEADER]: "true" });
  res.end(JSON.stringify(isPlainObject(payload) ? { ...payload, simulated: true } : payload));
  return true;
}

/**
 * Forma única de error del emulador. `status` es SIEMPRE el código del emulador rechazando la
 * petición (400/404/405/413/415/422), nunca la respuesta de negocio de un proveedor: un consumidor
 * tiene que poder distinguir "el emulador no entendió" de "el proveedor contestó que no".
 */
export function sendError(res, statusCode, code, detail, extra = {}, headers = {}) {
  return sendJson(res, statusCode, { ok: false, error: code, detail, ...extra }, headers);
}

/** Respuesta cruda, para el único caso que NO es JSON: el escenario `invalid_payload`. */
export function sendRaw(res, statusCode, contentType, body) {
  if (res.writableEnded || res.destroyed) return false;
  res.writeHead(statusCode, { "content-type": contentType, [SIMULATED_HEADER]: "true" });
  res.end(body);
  return true;
}
