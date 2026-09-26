/**
 * Journal del emulador: la prueba de que una llamada ATRAVESÓ el adaptador real.
 *
 * Es la pieza que convierte "el test pasó" en evidencia. Sin journal, un E2E que interceptó `fetch`
 * y uno que salió por la red producen exactamente el mismo informe verde; con journal, sólo el
 * segundo deja rastro aquí. Por eso el paquete QA lo exige para cerrar un recorrido con evidencia
 * externa, y por eso también sirve al revés: si la política de consentimiento o de costo bloqueó la
 * consulta, la ENTRADA AUSENTE es la expectativa correcta y se puede demostrar.
 *
 * Tres reglas que no se negocian:
 *
 * - **Acotado.** Buffer circular por namespace. Un soak de ocho horas no puede convertir el journal
 *   en la causa del OOM que dice estar midiendo.
 * - **Redactado antes de guardar**, no al renderizar. Lo que no se guarda no se puede filtrar en un
 *   export, en un log ni en la pantalla del portal.
 * - **Hash en vez de cuerpo.** `payloadHash` permite comparar dos intentos ("¿es la misma
 *   intención?") sin conservar el cuerpo, que es donde viven el documento y el teléfono.
 */
import { createHash } from "node:crypto";

const SENSITIVE_KEY =
  /(authorization|cookie|token|secret|password|otp|code|documento|document|ci|nit|phone|telefono|email|correo)/i;

/** Hash canónico: claves ordenadas, así que dos cuerpos equivalentes dan el mismo hash. */
export function payloadHash(value) {
  return createHash("sha256")
    .update(canonical(value))
    .digest("hex")
    .slice(0, 32);
}

function canonical(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

/**
 * Deja la FORMA del objeto —qué campos llegaron, de qué tipo— y borra el contenido de los
 * sensibles. La forma es lo que se necesita para diagnosticar "faltó un campo requerido"; el
 * contenido es lo que no puede estar aquí.
 */
export function redact(value, depth = 0) {
  if (depth > 4) return "[depth]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value).slice(0, 40)) {
      out[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redact(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === "string")
    return value.length > 64 ? `[string:${value.length}]` : value;
  return value;
}

export function createJournal(maxEntries) {
  const entries = [];
  let sequence = 0;
  let dropped = 0;

  return {
    append(entry) {
      sequence += 1;
      entries.push({
        sequence,
        occurredAt: new Date().toISOString(),
        ...entry,
      });
      if (entries.length > maxEntries) {
        entries.shift();
        dropped += 1;
      }
      return sequence;
    },
    /** Cursor durable: `afterSequence` deja reconectar sin duplicar ni perder entradas. */
    read({
      afterSequence = 0,
      limit = 200,
      provider = null,
      personaKey = null,
    } = {}) {
      const filtered = entries.filter(
        (entry) =>
          entry.sequence > afterSequence &&
          (provider === null || entry.provider === provider) &&
          (personaKey === null || entry.personaKey === personaKey),
      );
      return {
        entries: filtered.slice(0, limit),
        nextCursor:
          filtered.length > 0
            ? filtered[Math.min(filtered.length, limit) - 1].sequence
            : afterSequence,
        hasMore: filtered.length > limit,
        totalAppended: sequence,
        droppedByRetention: dropped,
      };
    },
    /** El reset no borra el contador: perder evidencia se contabiliza, no se disimula. */
    clear() {
      dropped += entries.length;
      entries.length = 0;
    },
    stats() {
      return {
        held: entries.length,
        totalAppended: sequence,
        droppedByRetention: dropped,
        maxEntries,
      };
    },
  };
}
