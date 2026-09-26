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
 * Escenarios de transporte: representan una falla del "proveedor" antes de que su emulador de
 * negocio (segip.mjs, qr.mjs, etc.) llegue a construir una respuesta — por eso se resuelven en un
 * solo lugar en vez de repetirse en cada módulo.
 *
 * Semántica declarada, que es lo que un consumidor necesita para no confundir capas:
 * - `provider_down` (503): el proveedor no está. NO es "el backend está caído".
 * - `unauthorized` (401): las credenciales de Atlas CONTRA EL PROVEEDOR no sirven. No es la sesión
 *   del cliente final caducada, y tratarlo como tal es cómo se deslogea a un usuario por un
 *   problema de integración.
 * - `rate_limited` (429): cuota del proveedor. Va con `Retry-After`, que el servidor añade.
 * - `provider_internal_error` (500): el proveedor falló por su cuenta.
 */
export function transportFailureFor(scenario) {
  if (scenario === "provider_down") {
    return {
      statusCode: 503,
      payload: {
        status: "PROVIDER_UNAVAILABLE",
        reasonCode: "MOCK_PROVIDER_DOWN",
      },
    };
  }
  if (scenario === "unauthorized") {
    return {
      statusCode: 401,
      payload: { status: "UNAUTHORIZED", reasonCode: "MOCK_UNAUTHORIZED" },
    };
  }
  if (scenario === "rate_limited") {
    return {
      statusCode: 429,
      payload: {
        status: "RATE_LIMITED",
        reasonCode: "MOCK_RATE_LIMITED",
        retryAfterSeconds: 2,
      },
    };
  }
  if (scenario === "provider_internal_error") {
    return {
      statusCode: 500,
      payload: {
        status: "PROVIDER_INTERNAL_ERROR",
        reasonCode: "MOCK_INTERNAL_ERROR",
      },
    };
  }
  return null;
}

/**
 * Cuánto tarda ESTE proveedor, no cuánto tarda "el emulador".
 *
 * Antes era un único valor parejo (300 ms) para los ocho, y eso hacía inútil cualquier tablero de
 * latencias: un buró de crédito y un OAuth de Meta no tardan lo mismo ni de lejos. Cada módulo
 * declara su `latencyRangeMs` y aquí se sortea un valor dentro del rango.
 *
 * La cabecera `x-mock-latency-ms` ya NO se resuelve aquí: se valida y se aplica en el servidor,
 * porque una latencia pedida por cabecera necesita comprobarse contra el techo configurado y esa
 * decisión es del borde, no del catálogo de escenarios.
 *
 * Es uniforme y aleatorio a propósito, y por eso el emulador NO promete latencias reproducibles al
 * repetir una semilla: lo reproducible son los DATOS, no los tiempos de red. Para fijar un número
 * exacto en una prueba de frontera está la cabecera.
 */
export function latencyMsFor(scenario, provider, defaultLatencyMs) {
  const range = Array.isArray(provider?.latencyRangeMs)
    ? provider.latencyRangeMs
    : null;
  // `slow_response` apunta al triple del techo del proveedor: provoca un p95 feo sin caerse y sin
  // cruzar necesariamente el deadline del consumidor, que es lo que separa `slow` de `timeout`.
  if (scenario === "slow_response") return range ? range[1] * 3 : 3_500;
  if (!range) return defaultLatencyMs;
  const [min, max] = range;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Fallo de fondo aleatorio, apagado por defecto (`MOCK_PROVIDERS_ERROR_RATE=0`).
 *
 * Existe para las DEMOS: un tablero de siete días con el 100 % de éxito y una línea plana no
 * enseña nada de lo que el tablero sirve para ver. Con `0.05`, una de cada veinte llamadas cae con
 * un fallo de transporte realista. Nunca se activa solo, y no toca las llamadas que pidieron un
 * escenario explícito ni las que tienen una regla del plan de fallos: si alguien pidió algo
 * concreto, es una prueba, no una demo, y meterle ruido encima la invalida.
 */
export function backgroundFailureFor(errorRate, scenarioWasExplicit) {
  if (scenarioWasExplicit || !(errorRate > 0) || Math.random() >= errorRate)
    return null;
  const roll = Math.random();
  if (roll < 0.5) return transportFailureFor("provider_down");
  if (roll < 0.8) return transportFailureFor("provider_internal_error");
  return transportFailureFor("rate_limited");
}
