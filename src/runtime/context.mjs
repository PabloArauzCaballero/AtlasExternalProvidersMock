/**
 * `MockControlContext`: de qué corrida y de qué persona viene esta llamada.
 *
 * El punto delicado es que llega en cabeceras, y una cabecera la pone cualquiera. Si bastara con
 * escribir `x-mock-run-id: lo-que-sea` para elegir namespace y escenario, el emulador sería un
 * panel de control abierto: un cliente del backend podría forzar `provider_down` sobre la corrida
 * de otro, o leer su journal. El paquete QA lo dice sin rodeos: el contexto tiene que ser
 * *scoped*, no "confiable por venir en un header público".
 *
 * Cómo se resuelve aquí, sin criptografía de más:
 *
 * - Un namespace **sólo** nace por el plano de control autenticado (`/mock/control/runs`).
 * - Ese alta devuelve un `runToken` aleatorio que el emulador guarda y no vuelve a publicar.
 * - El tráfico de negocio que nombra una corrida tiene que traer ese token. Sin él, o con otro, es
 *   401: nombrar la corrida no basta.
 * - Una llamada SIN contexto cae al namespace legacy, que es lo que hace hoy AtlasBackend. No se
 *   rompe al consumidor actual; simplemente no puede tocar corridas nuevas.
 *
 * El resto del contexto (`personaKey`, `logicalOperationId`, `attempt`) no da permisos: sólo
 * etiqueta el journal y alimenta el plan de fallos DENTRO de una corrida ya autorizada.
 */

const HEADERS = {
  tenantId: "x-mock-tenant-id",
  runId: "x-mock-run-id",
  runToken: "x-mock-run-token",
  personaKey: "x-mock-persona-key",
  logicalOperationId: "x-mock-logical-operation-id",
  attempt: "x-mock-attempt",
  epoch: "x-mock-epoch",
  schemaVersion: "x-mock-schema-version",
  idempotencyKey: "x-idempotency-key",
  traceparent: "traceparent",
};

function header(req, name) {
  const value = req.headers[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Acotado a propósito: estas etiquetas terminan en el journal y en métricas del portal. */
function label(value, max = 120) {
  if (value === null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function readContext(req, body = {}) {
  const attemptRaw = header(req, HEADERS.attempt);
  const attempt = attemptRaw === null ? null : Number(attemptRaw);
  return {
    tenantId: label(header(req, HEADERS.tenantId)),
    runId: label(header(req, HEADERS.runId)),
    runToken: header(req, HEADERS.runToken),
    personaKey: label(header(req, HEADERS.personaKey)),
    logicalOperationId: label(header(req, HEADERS.logicalOperationId)),
    declaredAttempt: Number.isInteger(attempt) && attempt >= 1 ? attempt : null,
    epoch: label(header(req, HEADERS.epoch), 64),
    schemaVersion: label(header(req, HEADERS.schemaVersion), 32),
    idempotencyKey:
      label(header(req, HEADERS.idempotencyKey), 200) ??
      label(
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
        200,
      ),
    traceparent: label(header(req, HEADERS.traceparent), 64),
  };
}

/** `traceId` del W3C traceparent, sólo para correlacionar. NO identifica persona ni da permisos. */
export function traceIdOf(context) {
  if (!context.traceparent) return null;
  const parts = context.traceparent.split("-");
  return parts.length >= 3 && /^[0-9a-f]{32}$/i.test(parts[1])
    ? parts[1]
    : null;
}

/**
 * @returns {{ok:true, namespace, legacy:boolean} | {ok:false, status:number, code:string, detail:string}}
 */
export function authorizeContext(store, context) {
  const named = Boolean(context.tenantId || context.runId);
  if (!named)
    return { ok: true, namespace: store.resolve({}).namespace, legacy: true };
  if (!context.tenantId || !context.runId) {
    return {
      ok: false,
      status: 400,
      code: "INCOMPLETE_RUN_CONTEXT",
      detail:
        "Una corrida se nombra con x-mock-tenant-id y x-mock-run-id a la vez.",
    };
  }
  const resolved = store.resolve({
    tenantId: context.tenantId,
    runId: context.runId,
    declaredEpoch: context.epoch,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.code === "NAMESPACE_LOST_ON_RESTART" ? 409 : 404,
      code: resolved.code,
      detail:
        resolved.code === "NAMESPACE_LOST_ON_RESTART"
          ? "El emulador se reinició: el estado de esa corrida ya no existe. No se sirve un namespace vacío como si fuera el mismo."
          : "Esa corrida no está dada de alta. Se crea por el plano de control, no nombrándola desde una cabecera.",
    };
  }
  if (resolved.namespace.runToken !== context.runToken) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_RUN_TOKEN",
      detail:
        "Nombrar una corrida no alcanza: hace falta el token que devolvió su alta.",
    };
  }
  return { ok: true, namespace: resolved.namespace, legacy: false };
}
