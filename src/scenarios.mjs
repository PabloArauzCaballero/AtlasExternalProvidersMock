export const SUPPORTED_SCENARIOS = [
  "happy_path",
  "provider_down",
  "timeout",
  "slow_response",
  "invalid_payload",
  "unauthorized",
  "rate_limited",
  "not_found",
  "partial_match",
  "data_not_available",
  "manual_review_required",
  "cost_blocked",
  "duplicate_request",
  "provider_internal_error",
  "fraud_signal_high",
  "low_confidence",
  "expired_token",
  "revoked_consent",
];

/**
 * Escenarios de transporte: representan una falla del "proveedor" antes de que su
 * emulador de negocio (segip.mjs, qr.mjs, etc.) llegue a construir una respuesta —
 * por eso se resuelven en un solo lugar en vez de repetirse en cada módulo.
 */
export function transportFailureFor(scenario) {
  if (scenario === "provider_down") {
    return { statusCode: 503, payload: { status: "PROVIDER_UNAVAILABLE", reasonCode: "MOCK_PROVIDER_DOWN" } };
  }
  if (scenario === "unauthorized") {
    return { statusCode: 401, payload: { status: "UNAUTHORIZED", reasonCode: "MOCK_UNAUTHORIZED" } };
  }
  if (scenario === "rate_limited") {
    return { statusCode: 429, payload: { status: "RATE_LIMITED", reasonCode: "MOCK_RATE_LIMITED" } };
  }
  if (scenario === "provider_internal_error") {
    return { statusCode: 500, payload: { status: "PROVIDER_INTERNAL_ERROR", reasonCode: "MOCK_INTERNAL_ERROR" } };
  }
  return null;
}

/**
 * Cuánto tarda ESTE proveedor, no cuánto tarda "el emulador".
 *
 * Antes era un único valor parejo (300 ms) para los ocho, y eso hacía inútil cualquier tablero de
 * latencias: un buró de crédito y un OAuth de Meta no tardan lo mismo ni de lejos. Ahora cada
 * módulo declara su `latencyRangeMs` y aquí se sortea un valor dentro del rango.
 *
 * Precedencia, de más fuerte a más débil:
 *   1. la cabecera `x-mock-latency-ms` — una prueba que necesita un número exacto lo fija;
 *   2. `slow_response` — el triple del techo del proveedor, para provocar un p95 feo sin caerse;
 *   3. el rango del proveedor;
 *   4. el default global, para un módulo que aún no declaró rango.
 */
export function latencyMsFor(scenario, headerValue, defaultLatencyMs, provider) {
  if (typeof headerValue === "string" && headerValue.trim() !== "" && Number.isFinite(Number(headerValue))) {
    return Number(headerValue);
  }
  const range = Array.isArray(provider?.latencyRangeMs) ? provider.latencyRangeMs : null;
  if (scenario === "slow_response") return range ? range[1] * 3 : 3500;
  if (!range) return defaultLatencyMs;
  const [min, max] = range;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Fallo de fondo aleatorio, apagado por defecto (`MOCK_PROVIDERS_ERROR_RATE=0`).
 *
 * Existe para las DEMOS: un tablero de siete días con el 100 % de éxito y una línea plana no
 * enseña nada de lo que el tablero sirve para ver. Con `0.05`, una de cada veinte llamadas cae con
 * un fallo de transporte realista. Nunca se activa solo, y no toca los escenarios pedidos
 * explícitamente por cabecera: si alguien pidió `happy_path`, es una prueba, no una demo.
 */
export function backgroundFailureFor(errorRate, scenarioWasExplicit) {
  if (scenarioWasExplicit || !(errorRate > 0) || Math.random() >= errorRate) return null;
  const roll = Math.random();
  if (roll < 0.5) return transportFailureFor("provider_down");
  if (roll < 0.8) return transportFailureFor("provider_internal_error");
  return transportFailureFor("rate_limited");
}
