export const code = "DIGITAL_TRUST_GENERIC";
export const slug = "digital-trust";
export const mountPath = "/mock/digital-trust";
export const operationPath = "/check";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Confianza digital";
export const description =
  "Riesgo del correo, del dispositivo y de la IP; señal de identidad sintética.";
export const latencyRangeMs = [300, 900];
export const operations = [{ path: operationPath, method: "POST", summary: "Evaluar señales de riesgo digital" }];
export const handledScenarios = ["happy_path", "fraud_signal_high"];

export function respond(scenario) {
  if (scenario === "fraud_signal_high") {
    return {
      provider: code,
      status: "COMPLETED",
      emailRiskLevel: "MEDIUM",
      deviceRiskScore: 0.78,
      ipRiskScore: 0.84,
      syntheticIdentityRiskLevel: "HIGH",
      manualReviewRequired: true,
    };
  }
  return {
    provider: code,
    status: "COMPLETED",
    emailRiskLevel: "LOW",
    deviceRiskScore: 0.15,
    ipRiskScore: 0.18,
    syntheticIdentityRiskLevel: "LOW",
    manualReviewRequired: false,
  };
}
