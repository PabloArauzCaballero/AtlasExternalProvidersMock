export const code = "SEGIP";
export const slug = "segip";
export const mountPath = "/mock/segip";
export const operationPath = "/identity/verify";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Identidad (KYC)";
export const description = "Registro estatal de identidad boliviano. Confirma que la cédula existe y que los datos coinciden.";
/**
 * Rango de latencia REALISTA del proveedor de verdad, no un número parejo para todos: un registro
 * estatal contesta en algo más de un segundo, y el tablero de proveedores externos sólo dice algo
 * útil si cada fila tarda lo que tardaría en producción.
 */
export const latencyRangeMs = [600, 1400];
export const operations = [{ path: operationPath, method: "POST", summary: "Verificar identidad contra el registro estatal" }];
export const handledScenarios = ["happy_path", "partial_match", "not_found", "data_not_available"];

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
