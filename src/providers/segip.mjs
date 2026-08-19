export const code = "SEGIP";
export const slug = "segip";
export const mountPath = "/mock/segip";
export const operationPath = "/identity/verify";

export function respond(scenario) {
  if (scenario === "partial_match") {
    return {
      provider: code,
      status: "PARTIAL_MATCH",
      documentExists: true,
      nameMatches: false,
      birthDateMatches: true,
      extensionMatches: true,
      complementMatches: true,
      matchScore: 0.62,
      manualReviewRequired: true,
      providerReference: "SEGIP-MOCK-REF-002",
    };
  }
  if (scenario === "not_found") {
    return {
      provider: code,
      status: "NOT_FOUND",
      documentExists: false,
      matchScore: 0,
      manualReviewRequired: true,
      providerReference: "SEGIP-MOCK-REF-404",
    };
  }
  if (scenario === "data_not_available") {
    return { provider: code, status: "DATA_NOT_AVAILABLE", reasonCode: "DATA_NOT_AVAILABLE" };
  }
  return {
    provider: code,
    status: "FOUND",
    documentExists: true,
    nameMatches: true,
    birthDateMatches: true,
    extensionMatches: true,
    complementMatches: true,
    matchScore: 0.98,
    providerReference: "SEGIP-MOCK-REF-001",
  };
}
