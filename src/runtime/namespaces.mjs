/**
 * Namespaces: una corrida no puede ver, ni pisar, el estado de otra.
 *
 * El hallazgo H03 del paquete QA describe el problema en una línea: `activeScenario` era una
 * variable global del módulo y `POST /mock/reset` la devolvía a `happy_path` para todo el mundo.
 * Con una sola corrida eso no se nota. Con dos en paralelo —que es exactamente el objetivo del
 * motor QA— la corrida A pone `provider_down`, la B pone `happy_path` medio segundo después, y las
 * dos miden la otra cosa. Peor todavía: el `reset` de A borraba el estado de B.
 *
 * Aquí el estado cuelga de `tenantId/runId` y, dentro, de `personaKey/provider/entity`. El global
 * legacy sigue existiendo (el backend actual lo usa) pero vive en su propio namespace reservado y
 * no lo toca nadie más.
 *
 * ## Recuperación tras reinicio
 *
 * Esto es memoria de proceso: un reinicio del emulador PIERDE los namespaces. No se disimula. Cada
 * arranque genera un `epoch`, el `create` lo devuelve, y una llamada que trae un namespace de un
 * epoch anterior recibe `NAMESPACE_LOST_ON_RESTART` en vez de un namespace vacío recién creado que
 * parecería sano. En el perfil `recovery` esa distinción es justamente lo que se está probando.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createJournal, payloadHash } from "./journal.mjs";

/** Namespace reservado para el tráfico que no declara corrida: el consumidor legacy. */
export const LEGACY_NAMESPACE = "__legacy__";

export function createNamespaceStore({ maxNamespaces, ttlMs, journalMaxEntries, defaultScenario, now = () => Date.now() }) {
  const epoch = randomUUID();
  const namespaces = new Map();

  function keyOf(tenantId, runId) {
    return `${tenantId}::${runId}`;
  }

  function evictExpired() {
    const cutoff = now();
    for (const [key, namespace] of namespaces) {
      if (namespace.expiresAt <= cutoff && key !== LEGACY_NAMESPACE) namespaces.delete(key);
    }
  }

  function makeNamespace({ key, tenantId, runId, seed, fixtureVersion, scenarioProfile }) {
    return {
      key,
      epoch,
      /**
       * Se devuelve UNA vez, al dar de alta la corrida, y no se vuelve a publicar en ningún listado.
       * Es lo que impide que nombrar una corrida desde una cabecera alcance para entrar en ella.
       */
      runToken: key === LEGACY_NAMESPACE ? null : randomBytes(24).toString("base64url"),
      tenantId,
      runId,
      seed: seed ?? null,
      fixtureVersion: fixtureVersion ?? null,
      /** Escenario por defecto de ESTA corrida. Sustituye al `activeScenario` global. */
      scenarioProfile: scenarioProfile ?? defaultScenario,
      createdAt: new Date(now()).toISOString(),
      expiresAt: now() + ttlMs,
      /** `personaKey|provider|entityKey` → `{ stateVersion, state }`. */
      entities: new Map(),
      /** `principal|operation|key` → `{ payloadHash, result, storedAt }`. */
      idempotency: new Map(),
      /** Plan de fallos explícito por operación/persona, ver `fault-plan.mjs`. */
      faultPlan: null,
      /** Contadores por operación, para el patrón "las N primeras fallan". NO es un contador global. */
      attempts: new Map(),
      fixtures: new Map(),
      journal: createJournal(journalMaxEntries),
      requestCount: 0,
    };
  }

  const legacy = makeNamespace({ key: LEGACY_NAMESPACE, tenantId: null, runId: null, scenarioProfile: defaultScenario });
  legacy.expiresAt = Number.POSITIVE_INFINITY;
  namespaces.set(LEGACY_NAMESPACE, legacy);

  return {
    epoch,

    create({ tenantId, runId, seed, fixtureVersion, scenarioProfile }) {
      evictExpired();
      const key = keyOf(tenantId, runId);
      if (namespaces.has(key)) return { ok: false, code: "NAMESPACE_ALREADY_EXISTS", key };
      // Sin techo, un motor de carga que crea un namespace por corrida y nunca limpia termina
      // tumbando el emulador. Se rechaza con un código propio en vez de morir por memoria.
      if (namespaces.size >= maxNamespaces) return { ok: false, code: "NAMESPACE_LIMIT_REACHED", limit: maxNamespaces };
      const namespace = makeNamespace({ key, tenantId, runId, seed, fixtureVersion, scenarioProfile });
      namespaces.set(key, namespace);
      return { ok: true, namespace };
    },

    /**
     * Busca un namespace declarado. Nunca lo crea al vuelo: un runId que no existe es un error del
     * consumidor —o un emulador reiniciado— y las dos cosas tienen que verse.
     */
    resolve({ tenantId, runId, declaredEpoch = null }) {
      if (!tenantId || !runId) return { ok: true, namespace: namespaces.get(LEGACY_NAMESPACE), legacy: true };
      evictExpired();
      const namespace = namespaces.get(keyOf(tenantId, runId));
      if (!namespace) {
        return { ok: false, code: declaredEpoch && declaredEpoch !== epoch ? "NAMESPACE_LOST_ON_RESTART" : "NAMESPACE_NOT_FOUND" };
      }
      if (declaredEpoch && declaredEpoch !== namespace.epoch) return { ok: false, code: "NAMESPACE_LOST_ON_RESTART" };
      namespace.expiresAt = now() + ttlMs;
      return { ok: true, namespace, legacy: false };
    },

    /** Reset con ALCANCE. Nunca toca otra corrida, y por eso no existe un reset "de todo". */
    reset(namespace, { keepJournal = false } = {}) {
      namespace.entities.clear();
      namespace.idempotency.clear();
      namespace.attempts.clear();
      namespace.faultPlan = null;
      if (!keepJournal) namespace.journal.clear();
      namespace.journal.append({ type: "namespace_reset", keepJournal });
      return { ok: true, key: namespace.key, keptJournal: keepJournal };
    },

    delete(namespace) {
      if (namespace.key === LEGACY_NAMESPACE) return { ok: false, code: "LEGACY_NAMESPACE_IS_PERMANENT" };
      namespaces.delete(namespace.key);
      return { ok: true, key: namespace.key };
    },

    list() {
      evictExpired();
      return [...namespaces.values()].map((namespace) => ({
        key: namespace.key,
        epoch: namespace.epoch,
        tenantId: namespace.tenantId,
        runId: namespace.runId,
        seed: namespace.seed,
        fixtureVersion: namespace.fixtureVersion,
        scenarioProfile: namespace.scenarioProfile,
        createdAt: namespace.createdAt,
        expiresAt: Number.isFinite(namespace.expiresAt) ? new Date(namespace.expiresAt).toISOString() : null,
        entities: namespace.entities.size,
        requestCount: namespace.requestCount,
        journal: namespace.journal.stats(),
      }));
    },

    stats() {
      return { epoch, count: namespaces.size, limit: maxNamespaces, ttlMs };
    },
  };
}

/**
 * Transición atómica de una entidad del proveedor. "Atómica" aquí es literal: Node es de un hilo y
 * esta función no tiene `await`, así que nadie observa el estado a medio cambiar. Se versiona para
 * que el consumidor pueda detectar una carrera (`stateVersion` inesperado) en vez de pisarla.
 */
export function transitionEntity(namespace, { personaKey, provider, entityKey }, mutate) {
  const key = `${personaKey ?? "-"}|${provider}|${entityKey}`;
  const current = namespace.entities.get(key) ?? { stateVersion: 0, state: null };
  const next = mutate(current.state);
  const record = { stateVersion: current.stateVersion + 1, state: next, updatedAt: new Date().toISOString() };
  namespace.entities.set(key, record);
  return record;
}

export function readEntity(namespace, { personaKey, provider, entityKey }) {
  return namespace.entities.get(`${personaKey ?? "-"}|${provider}|${entityKey}`) ?? null;
}

/**
 * Idempotencia por principal + operación + clave, con hash canónico del cuerpo.
 *
 * Dos resultados distintos, no uno:
 * - `replay`: misma clave, mismo cuerpo ⇒ se devuelve el resultado guardado y NO se ejecuta otra vez.
 * - `mismatch`: misma clave, cuerpo distinto ⇒ 422. Es un error del consumidor, no una operación
 *   nueva, y taparlo es exactamente cómo se duplica una solicitud de crédito en producción.
 */
export function rememberIdempotent(namespace, { principal, operation, key }, body, produce) {
  if (!key) return { kind: "fresh", result: produce() };
  const recordKey = `${principal ?? "-"}|${operation}|${key}`;
  const hash = payloadHash(body ?? {});
  const existing = namespace.idempotency.get(recordKey);
  if (existing) {
    if (existing.payloadHash !== hash) return { kind: "mismatch", storedHash: existing.payloadHash, receivedHash: hash };
    return { kind: "replay", result: existing.result, storedAt: existing.storedAt };
  }
  const result = produce();
  namespace.idempotency.set(recordKey, { payloadHash: hash, result, storedAt: new Date().toISOString() });
  return { kind: "fresh", result };
}

/** Intentos por operación lógica dentro de la corrida. Nunca un contador global del proceso. */
export function nextAttempt(namespace, operationKey) {
  const count = (namespace.attempts.get(operationKey) ?? 0) + 1;
  namespace.attempts.set(operationKey, count);
  return count;
}
