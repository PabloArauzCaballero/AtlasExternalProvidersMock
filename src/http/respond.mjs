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
 */

export function sendJson(res, statusCode, payload, headers = {}) {
  if (res.writableEnded || res.destroyed) return false;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
  return true;
}

/**
 * Forma única de error del emulador. `status` es SIEMPRE el código del emulador rechazando la
 * petición (400/404/405/413/415/422), nunca la respuesta de negocio de un proveedor: un consumidor
 * tiene que poder distinguir "el emulador no entendió" de "el proveedor contestó que no".
 */
export function sendError(
  res,
  statusCode,
  code,
  detail,
  extra = {},
  headers = {},
) {
  return sendJson(
    res,
    statusCode,
    { ok: false, error: code, detail, ...extra },
    headers,
  );
}

/** Respuesta cruda, para el único caso que NO es JSON: el escenario `invalid_payload`. */
export function sendRaw(res, statusCode, contentType, body) {
  if (res.writableEnded || res.destroyed) return false;
  res.writeHead(statusCode, { "content-type": contentType });
  res.end(body);
  return true;
}
