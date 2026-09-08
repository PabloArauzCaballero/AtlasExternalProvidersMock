export const code = "QR_GENERIC";
export const slug = "qr";
export const mountPath = "/mock/qr";
export const operationPath = "/payment/verify";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Pagos";
export const description =
  "Verificación de pagos por QR interoperable: confirma monto, referencia y duplicados.";
export const latencyRangeMs = [250, 700];
export const operations = [{ path: operationPath, method: "POST", summary: "Verificar que un pago por QR entró" }];
export const handledScenarios = ["happy_path", "not_found", "partial_match", "duplicate_request"];

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
