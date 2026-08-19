export const code = "DIGITAL_TRUST_GENERIC";
export const slug = "digital-trust";
export const mountPath = "/mock/digital-trust";
export const operationPath = "/check";

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
