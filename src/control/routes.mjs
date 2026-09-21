/**
 * Plano de control: dar de alta una corrida, plantarle un plan de fallos, leer su journal y
 * resetearla — sin tocar ninguna otra.
 *
 * Está SEPARADO del tráfico de negocio a propósito. El emulador anterior mezclaba las dos cosas:
 * `POST /mock/scenarios/active` y `POST /mock/reset` eran rutas públicas, sin autenticación, que
 * cambiaban el comportamiento de todo el proceso. Cualquiera con acceso de red al emulador podía
 * poner `provider_down` en mitad de la corrida de otro equipo.
 *
 * Dos decisiones:
 *
 * - **Apagado si no hay token.** Sin `MOCK_PROVIDERS_CONTROL_TOKEN` estas rutas responden 503, no
 *   200. Un emulador desplegado sin configurar no puede quedar administrable por defecto.
 * - **Nada de callbacks a URLs del cliente.** El paquete QA lo pide explícitamente y aquí ni
 *   siquiera hay campo donde ponerlas: el journal se LEE, no se empuja. Un emulador que hace
 *   requests salientes a donde le digan es un SSRF con uniforme de herramienta de pruebas.
 */
import { timingSafeEqual } from "node:crypto";
import { readJsonBody } from "../http/body.mjs";
import { sendJson, sendError } from "../http/respond.mjs";
import { route } from "../http/router.mjs";
import { validateFaultPlan } from "../runtime/fault-plan.mjs";
import { isKnownScenario } from "../capabilities.mjs";

function tokenMatches(expected, received) {
  if (typeof received !== "string" || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function authorize(req, res, config) {
  if (!config.controlToken) {
    sendError(res, 503, "CONTROL_PLANE_DISABLED", "El plano de control está apagado: falta MOCK_PROVIDERS_CONTROL_TOKEN.");
    return false;
  }
  const header = req.headers.authorization;
  const received = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!tokenMatches(config.controlToken, received)) {
    sendError(res, 401, "CONTROL_UNAUTHORIZED", "El plano de control necesita el token de administración.");
    return false;
  }
  return true;
}

/** El tenant viaja en cabecera, igual que en el tráfico de negocio: un runId solo no identifica nada. */
function tenantOf(req, res) {
  const tenantId = typeof req.headers["x-mock-tenant-id"] === "string" ? req.headers["x-mock-tenant-id"].trim() : "";
  if (tenantId === "") {
    sendError(res, 400, "TENANT_REQUIRED", "Toda operación de control declara x-mock-tenant-id.");
    return null;
  }
  return tenantId;
}

function findNamespace(store, req, res, runId) {
  const tenantId = tenantOf(req, res);
  if (tenantId === null) return null;
  const resolved = store.resolve({ tenantId, runId });
  if (!resolved.ok) {
    sendError(res, resolved.code === "NAMESPACE_LOST_ON_RESTART" ? 409 : 404, resolved.code, "Esa corrida no existe en este emulador.");
    return null;
  }
  return resolved.namespace;
}

function publicView(namespace) {
  return {
    key: namespace.key,
    epoch: namespace.epoch,
    tenantId: namespace.tenantId,
    runId: namespace.runId,
    seed: namespace.seed,
    fixtureVersion: namespace.fixtureVersion,
    scenarioProfile: namespace.scenarioProfile,
    createdAt: namespace.createdAt,
    requestCount: namespace.requestCount,
    entities: namespace.entities.size,
    idempotencyRecords: namespace.idempotency.size,
    faultPlanRules: namespace.faultPlan?.rules.length ?? 0,
    journal: namespace.journal.stats(),
  };
}

async function body(req, res, config) {
  const parsed = await readJsonBody(req, { maxBytes: config.maxBodyBytes });
  if (!parsed.ok) {
    if (!parsed.aborted) sendError(res, parsed.status, parsed.code, parsed.detail);
    return null;
  }
  return parsed.value;
}

export function controlRoutes(store, _config) {
  return [
    route("POST", "/mock/control/runs", async ({ req, res, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const payload = await body(req, res, config);
      if (payload === null) return undefined;
      const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
      const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
      if (tenantId === "" || runId === "") return sendError(res, 400, "INVALID_RUN_IDENTITY", "tenantId y runId son obligatorios.");
      if (payload.scenarioProfile !== undefined && !isKnownScenario(payload.scenarioProfile)) {
        return sendError(res, 400, "UNKNOWN_SCENARIO", "scenarioProfile no es un escenario conocido.", { scenario: payload.scenarioProfile });
      }
      const created = store.create({
        tenantId,
        runId,
        seed: typeof payload.seed === "string" ? payload.seed : null,
        fixtureVersion: typeof payload.fixtureVersion === "string" ? payload.fixtureVersion : null,
        scenarioProfile: payload.scenarioProfile,
      });
      if (!created.ok) return sendError(res, created.code === "NAMESPACE_LIMIT_REACHED" ? 429 : 409, created.code, "No se pudo dar de alta la corrida.", created);
      // `runToken` se entrega UNA vez. No vuelve a aparecer en ningún listado ni en el journal.
      return sendJson(res, 201, { ok: true, ...publicView(created.namespace), runToken: created.namespace.runToken });
    }),

    route("GET", "/mock/control/runs", ({ req, res, config }) => {
      if (!authorize(req, res, config)) return undefined;
      return sendJson(res, 200, { ok: true, ...store.stats(), runs: store.list() });
    }),

    route("GET", "/mock/control/runs/:runId", ({ req, res, params, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      return namespace === null ? undefined : sendJson(res, 200, { ok: true, ...publicView(namespace) });
    }),

    route("DELETE", "/mock/control/runs/:runId", ({ req, res, params, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      if (namespace === null) return undefined;
      const deleted = store.delete(namespace);
      return deleted.ok ? sendJson(res, 200, { ok: true, ...deleted }) : sendError(res, 409, deleted.code, "Ese namespace no se puede borrar.");
    }),

    /**
     * Reset CON ALCANCE. `keepJournal` existe porque el paquete QA lo pide en el oráculo del reset
     * aislado: limpiar el estado del proveedor sin destruir la evidencia de lo que ya pasó.
     */
    route("POST", "/mock/control/runs/:runId/reset", async ({ req, res, params, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      if (namespace === null) return undefined;
      const payload = await body(req, res, config);
      if (payload === null) return undefined;
      const result = store.reset(namespace, { keepJournal: payload.keepJournal === true });
      return sendJson(res, 200, { ok: true, ...result, scope: namespace.key });
    }),

    route("PUT", "/mock/control/runs/:runId/fault-plan", async ({ req, res, params, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      if (namespace === null) return undefined;
      const payload = await body(req, res, config);
      if (payload === null) return undefined;
      const validated = validateFaultPlan(payload);
      // Un plan inválido se rechaza AQUÍ, no a mitad de la corrida: ese es el sentido de validarlo
      // al plantarlo y no al aplicarlo.
      if (!validated.ok) return sendError(res, 400, "INVALID_FAULT_PLAN", "El plan de fallos no es válido.", { errors: validated.errors });
      namespace.faultPlan = validated.plan;
      namespace.journal.append({ type: "fault_plan_installed", rules: validated.plan.rules.length });
      return sendJson(res, 200, { ok: true, rules: validated.plan.rules.length, plan: validated.plan });
    }),

    route("DELETE", "/mock/control/runs/:runId/fault-plan", ({ req, res, params, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      if (namespace === null) return undefined;
      namespace.faultPlan = null;
      namespace.journal.append({ type: "fault_plan_removed" });
      return sendJson(res, 200, { ok: true });
    }),

    route("PUT", "/mock/control/runs/:runId/fixtures", async ({ req, res, params, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      if (namespace === null) return undefined;
      const payload = await body(req, res, config);
      if (payload === null) return undefined;
      const fixtures = payload.fixtures;
      if (fixtures === null || typeof fixtures !== "object" || Array.isArray(fixtures)) {
        return sendError(res, 400, "INVALID_FIXTURES", "`fixtures` tiene que ser un objeto de personaKey → datos.");
      }
      const keys = Object.keys(fixtures);
      if (keys.length > 5_000) return sendError(res, 413, "TOO_MANY_FIXTURES", "No más de 5000 fixtures por corrida.");
      for (const key of keys) namespace.fixtures.set(key, fixtures[key]);
      return sendJson(res, 200, { ok: true, stored: keys.length, total: namespace.fixtures.size });
    }),

    /**
     * El journal se lee con cursor. Es lo que convierte "la prueba pasó" en "la llamada llegó al
     * proveedor": sin una entrada aquí, un E2E que interceptó `fetch` y uno que salió por la red
     * son indistinguibles.
     */
    route("GET", "/mock/control/runs/:runId/journal", ({ req, res, params, url, config }) => {
      if (!authorize(req, res, config)) return undefined;
      const namespace = findNamespace(store, req, res, params.runId);
      if (namespace === null) return undefined;
      const afterSequence = Number(url.searchParams.get("after") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 200);
      if (!Number.isInteger(afterSequence) || afterSequence < 0) return sendError(res, 400, "INVALID_CURSOR", "`after` tiene que ser un entero ≥ 0.");
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) return sendError(res, 400, "INVALID_LIMIT", "`limit` tiene que estar entre 1 y 1000.");
      return sendJson(res, 200, {
        ok: true,
        runId: namespace.runId,
        ...namespace.journal.read({
          afterSequence,
          limit,
          provider: url.searchParams.get("provider"),
          personaKey: url.searchParams.get("personaKey"),
        }),
      });
    }),
  ];
}
