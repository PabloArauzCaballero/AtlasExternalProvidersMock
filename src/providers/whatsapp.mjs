export const code = "WHATSAPP_GENERIC";
export const slug = "whatsapp";
export const mountPath = "/mock/whatsapp";
export const operationPath = "/verification/confirm";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Contactabilidad";
export const description =
  "Confirmación del código enviado por WhatsApp y si el número es alcanzable.";
export const latencyRangeMs = [200, 600];
export const operations = [{ path: operationPath, method: "POST", summary: "Confirmar el código de verificación" }];
export const handledScenarios = ["happy_path", "not_found", "low_confidence"];

export function respond(scenario) {
  if (scenario === "not_found") {
    return { provider: code, status: "NOT_REACHABLE", whatsappReachable: false, phoneMatch: false, contactabilityScore: 0.1 };
  }
  if (scenario === "low_confidence") {
    return {
      provider: code,
      status: "OTP_UNCERTAIN",
      whatsappReachable: true,
      phoneMatch: false,
      contactabilityScore: 0.35,
      manualReviewRequired: true,
    };
  }
  return { provider: code, status: "OTP_VERIFIED", whatsappReachable: true, phoneMatch: true, contactabilityScore: 0.96 };
}
