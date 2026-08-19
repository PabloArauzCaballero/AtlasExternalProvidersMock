export const code = "TELCO_GENERIC";
export const slug = "telco";
export const mountPath = "/mock/telco";
export const operationPath = "/phone-trust/check";

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
