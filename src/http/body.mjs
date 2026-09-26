/**
 * Lectura del cuerpo con límite, tipo y error explícito.
 *
 * El `readBody` anterior hacía tres cosas peligrosas a la vez: concatenaba `chunk` a un string sin
 * techo (un cliente podía sostener el proceso hasta quedarse sin memoria), resolvía `{}` ante JSON
 * roto —así que un cuerpo corrupto entraba al emulador como "petición válida sin datos" y salía
 * como happy path— y resolvía `{}` también ante `error`, mezclando "el cliente cortó" con "el
 * cliente no mandó nada".
 *
 * Aquí las tres se separan y ninguna resuelve en silencio. El resultado es un discriminado:
 * `{ ok: true, value }` o `{ ok: false, code, status, detail }`, y quien llama decide la respuesta.
 */

const JSON_MEDIA_TYPES = new Set([
  "application/json",
  "application/problem+json",
  "text/json",
]);

function mediaTypeOf(header) {
  if (typeof header !== "string" || header.trim() === "") return null;
  return header.split(";")[0].trim().toLowerCase();
}

/**
 * @returns {Promise<{ok: true, value: object, bytes: number} | {ok: false, code: string, status: number, detail: string}>}
 */
export function readJsonBody(req, { maxBytes }) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Se rechaza ANTES de leer: no tiene sentido gastar memoria en un cuerpo que ya se anunció
    // demasiado grande. Ojo con la tentación de `req.destroy()` aquí: cierra el socket antes de
    // escribir la respuesta y el cliente ve un "connection reset" en vez del 413 que explica qué
    // pasó. Se contesta primero; la conexión la cierra el servidor al no consumir el cuerpo.
    return Promise.resolve({
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      detail: `El cuerpo declara ${declared} bytes y el límite es ${maxBytes}.`,
    });
  }

  const mediaType = mediaTypeOf(req.headers["content-type"]);
  if (mediaType !== null && !JSON_MEDIA_TYPES.has(mediaType)) {
    return Promise.resolve({
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      detail: `Este emulador sólo acepta application/json; llegó "${mediaType}".`,
    });
  }

  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
      resolve(result);
    };

    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        // Se deja de acumular AQUÍ, no al final: sin esto el proceso ya tendría el cuerpo entero en
        // memoria cuando descubre que sobraba. `finish` quita el listener de `data`, con lo que el
        // stream deja de fluir y el socket se cierra al terminar la respuesta.
        finish({
          ok: false,
          status: 413,
          code: "PAYLOAD_TOO_LARGE",
          detail: `El cuerpo superó el límite de ${maxBytes} bytes.`,
        });
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (bytes === 0) return finish({ ok: true, value: {}, bytes: 0 });
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return finish({
          ok: false,
          status: 400,
          code: "INVALID_JSON",
          detail: "El cuerpo no es JSON válido.",
        });
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return finish({
          ok: false,
          status: 400,
          code: "INVALID_BODY_SHAPE",
          detail: "El cuerpo tiene que ser un objeto JSON.",
        });
      }
      return finish({ ok: true, value: parsed, bytes });
    };

    // `error` y `aborted` NO son "cuerpo vacío": el cliente se fue. Quien llama tiene que saberlo
    // para no contestar a una conexión que ya no existe ni contar la llamada como atendida.
    const onError = (error) =>
      finish({
        ok: false,
        status: 400,
        code: "REQUEST_STREAM_ERROR",
        detail: error?.message ?? "stream error",
        aborted: true,
      });
    const onAborted = () =>
      finish({
        ok: false,
        status: 499,
        code: "CLIENT_ABORTED",
        detail: "El cliente cortó la conexión.",
        aborted: true,
      });

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}
