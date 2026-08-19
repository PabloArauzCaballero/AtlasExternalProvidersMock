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

export function latencyMsFor(scenario, headerValue, defaultLatencyMs) {
  if (typeof headerValue === "string" && headerValue.trim() !== "" && Number.isFinite(Number(headerValue))) {
    return Number(headerValue);
  }
  if (scenario === "slow_response") return 3500;
  return defaultLatencyMs;
}
