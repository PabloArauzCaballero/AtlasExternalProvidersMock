/**
 * Buzón QA: donde el backend entrega correos, SMS y WhatsApp de un entorno QA, y de donde el motor
 * de corridas lee el código que la persona sintética "recibió".
 *
 * Existe para NO introducir atajos: el plan QA prohíbe un bypass de verificación en los endpoints
 * públicos. Con los proveedores de notificación del backend en modo `webhook` apuntando aquí, el
 * código sale por el camino real (se genera, se hashea, se envía) y la prueba lo lee de donde llegó.
 *
 * - La ENTRADA (`POST /mock/inbox/:channel`) no pide token: la usa el adaptador `webhook` del
 *   backend, que no manda credenciales. Por eso el buzón sólo existe en un emulador de QA y está
 *   acotado: tamaño, cantidad y antigüedad.
 * - La LECTURA (`GET /mock/control/inbox`) exige el token del plano de control, como el journal:
 *   un código de verificación es un secreto, aunque sea de una persona ficticia.
 */
import { readJsonBody } from "../http/body.mjs";
import { sendJson, sendError } from "../http/respond.mjs";
import { route } from "../http/router.mjs";

const CHANNELS = new Set(["email", "sms", "whatsapp", "push"]);
const MAX_MESSAGES = 5_000;
const TTL_MS = 60 * 60_000;

function normalize(address) {
  return typeof address === "string"
    ? address
        .trim()
        .toLowerCase()
        .replace(/[\s()-]/g, "")
    : "";
}

function addressOf(payload) {
  if (typeof payload.to === "string") return payload.to;
  if (Array.isArray(payload.to)) return String(payload.to[0] ?? "");
  const target = Array.isArray(payload.deliveryTargets)
    ? payload.deliveryTargets[0]
    : null;
  return target && typeof target.address === "string" ? target.address : "";
}

export function createInbox({ now = () => Date.now() } = {}) {
  const messages = [];
  let sequence = 0;
  const prune = () => {
    const cutoff = now() - TTL_MS;
    while (
      messages.length > 0 &&
      (messages.length > MAX_MESSAGES || messages[0].receivedAtMs < cutoff)
    )
      messages.shift();
  };
  return {
    deliver(channel, payload) {
      prune();
      sequence += 1;
      messages.push({
        sequence,
        channel,
        to: normalize(addressOf(payload)),
        subject:
          typeof payload.subject === "string"
            ? payload.subject.slice(0, 300)
            : null,
        body: String(payload.body ?? payload.text ?? "").slice(0, 8_000),
        receivedAt: new Date(now()).toISOString(),
        receivedAtMs: now(),
      });
      return sequence;
    },
    read({ to = null, channel = null, after = 0, limit = 50 } = {}) {
      prune();
      const wanted = to === null ? null : normalize(to);
      const found = messages.filter(
        (message) =>
          message.sequence > after &&
          (wanted === null || message.to === wanted) &&
          (channel === null || message.channel === channel),
      );
      return {
        messages: found
          .slice(-limit)
          .map(({ receivedAtMs: _ignored, ...message }) => message),
        lastSequence: sequence,
      };
    },
    stats() {
      return {
        held: messages.length,
        totalReceived: sequence,
        maxMessages: MAX_MESSAGES,
        ttlMs: TTL_MS,
      };
    },
  };
}

export function inboxRoutes(inbox, authorize) {
  return [
    route(
      "POST",
      "/mock/inbox/:channel",
      async ({ req, res, params, config }) => {
        if (!CHANNELS.has(params.channel))
          return sendError(
            res,
            404,
            "UNKNOWN_CHANNEL",
            "Canal desconocido para el buzón QA.",
          );
        const parsed = await readJsonBody(req, {
          maxBytes: config.maxBodyBytes,
        });
        if (!parsed.ok)
          return parsed.aborted
            ? undefined
            : sendError(res, parsed.status, parsed.code, parsed.detail);
        const id = inbox.deliver(params.channel, parsed.value ?? {});
        return sendJson(res, 202, {
          ok: true,
          id: `qa-inbox-${id}`,
          messageId: `qa-inbox-${id}`,
        });
      },
    ),
    route("GET", "/mock/control/inbox", ({ req, res, url, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const after = Number(url.searchParams.get("after") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      if (!Number.isInteger(after) || after < 0)
        return sendError(
          res,
          400,
          "INVALID_CURSOR",
          "`after` tiene que ser un entero ≥ 0.",
        );
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        return sendError(
          res,
          400,
          "INVALID_LIMIT",
          "`limit` tiene que estar entre 1 y 500.",
        );
      return sendJson(res, 200, {
        ok: true,
        ...inbox.read({
          to: url.searchParams.get("to"),
          channel: url.searchParams.get("channel"),
          after,
          limit,
        }),
        stats: inbox.stats(),
      });
    }),
  ];
}
