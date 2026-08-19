export const code = "WHATSAPP_GENERIC";
export const slug = "whatsapp";
export const mountPath = "/mock/whatsapp";
export const operationPath = "/verification/confirm";

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
