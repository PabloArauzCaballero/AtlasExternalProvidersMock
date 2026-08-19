export const code = "QR_GENERIC";
export const slug = "qr";
export const mountPath = "/mock/qr";
export const operationPath = "/payment/verify";

export function respond(scenario) {
  if (scenario === "not_found") {
    return {
      provider: code,
      status: "PAYMENT_NOT_FOUND",
      amountMatches: false,
      referenceMatches: false,
      providerReference: "QR-MOCK-404",
    };
  }
  if (scenario === "partial_match") {
    return {
      provider: code,
      status: "PAYMENT_PARTIAL_MATCH",
      amountMatches: false,
      referenceMatches: true,
      paidAmount: 590,
      currency: "BOB",
      manualReviewRequired: true,
      providerReference: "QR-MOCK-PARTIAL",
    };
  }
  if (scenario === "duplicate_request") {
    return {
      provider: code,
      status: "DUPLICATE_PAYMENT_REFERENCE",
      amountMatches: true,
      referenceMatches: true,
      duplicateDetected: true,
      manualReviewRequired: true,
      providerReference: "QR-MOCK-DUP",
    };
  }
  return {
    provider: code,
    status: "PAYMENT_VERIFIED",
    amountMatches: true,
    referenceMatches: true,
    paidAmount: 600,
    currency: "BOB",
    paidAt: "2026-01-01T12:00:00Z",
    providerReference: "QR-MOCK-001",
  };
}
