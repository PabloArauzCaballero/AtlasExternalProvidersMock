export const code = "INFOCENTER";
export const slug = "infocenter";
export const mountPath = "/mock/infocenter";
export const operationPath = "/credit-report";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Buró de crédito";
export const description =
  "Central de riesgo crediticio. Devuelve score, deudas vigentes y peor mora de los últimos 12 meses.";
/**
 * El más lento del catálogo a propósito: una consulta al buró es una llamada facturada contra un
 * tercero, y su latencia es la que hace visible el costo de pedirla en cada alta.
 */
export const latencyRangeMs = [900, 2500];
export const operations = [{ path: operationPath, method: "POST", summary: "Pedir el reporte crediticio de una persona" }];
export const handledScenarios = ["happy_path", "cost_blocked", "not_found"];

export function respond(scenario) {
  if (scenario === "cost_blocked") {
    return {
      provider: code,
      status: "BLOCKED_BY_COST_POLICY",
      reasonCode: "INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL",
      estimatedCostAmount: 0,
      currency: "BOB",
    };
  }
  if (scenario === "not_found") {
    return { provider: code, status: "NOT_FOUND" };
  }
  return {
    provider: code,
    status: "COMPLETED",
    bureauScore: 680,
    activeDebtCount: 2,
    maxDaysPastDue12m: 0,
    estimatedCostAmount: 0,
    currency: "BOB",
    providerReference: "INFOCENTER-MOCK-001",
  };
}
