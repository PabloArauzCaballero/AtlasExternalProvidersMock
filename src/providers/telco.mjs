export const code = "TELCO_GENERIC";
export const slug = "telco";
export const mountPath = "/mock/telco";
export const operationPath = "/phone-trust/check";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Telco";
export const description =
  "Confianza de la línea telefónica: antigüedad, cambio reciente de SIM y coincidencia del titular.";
export const latencyRangeMs = [300, 800];
export const operations = [{ path: operationPath, method: "POST", summary: "Consultar la confianza de un número" }];
export const handledScenarios = ["happy_path", "fraud_signal_high"];

export function respond(scenario) {
  if (scenario === "fraud_signal_high") {
    return {
      provider: code,
      status: "VERIFIED",
      phoneNumberActive: true,
      lineAgeDays: 3,
      lineAgeBucket: "NEW",
      recentSimChangeDetected: true,
      simSwapRiskLevel: "HIGH",
      ownerMatchScore: 0.42,
      manualReviewRequired: true,
    };
  }
  return {
    provider: code,
    status: "VERIFIED",
    phoneNumberActive: true,
    lineAgeDays: 720,
    lineAgeBucket: "OLD",
    recentSimChangeDetected: false,
    simSwapRiskLevel: "LOW",
    ownerMatchScore: 0.9,
    manualReviewRequired: false,
  };
}
