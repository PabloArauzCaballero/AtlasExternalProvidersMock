export const code = "BANKING_GENERIC";
export const slug = "banking";
export const mountPath = "/mock/banking";
export const operationPath = "/transfer/verify";

export function respond(scenario) {
  if (scenario === "happy_path") {
    return {
      provider: code,
      status: "VERIFIED",
      amountMatches: true,
      referenceMatches: true,
      providerReference: "BANK-MOCK-OK",
    };
  }
  return {
    provider: code,
    status: "PENDING",
    amountMatches: null,
    referenceMatches: null,
    providerReference: "BANK-MOCK-001",
  };
}
