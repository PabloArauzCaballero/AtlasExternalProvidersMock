import { identityOf, derivedInt, derivedFloat, derivedReference } from "../domain/derive.mjs";

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
/**
 * `unauthorized` no aparece aquí: es genérico y lo resuelve el servidor. `data_not_available` es la
 * rama "el buró no tiene historial de esta persona", distinta de `not_found` ("la persona no existe
 * para el buró"): la primera es un thin file y la segunda un documento desconocido, y una política
 * de crédito las trata diferente.
 */
export const handledScenarios = ["happy_path", "cost_blocked", "not_found", "data_not_available", "manual_review_required"];

/**
 * El score y la deuda se derivan del documento, no son `680` para todo el mundo.
 *
 * Con un score constante, una corrida de mil personas prueba UNA vez la regla de elegibilidad y
 * novecientas noventa y nueve veces la misma rama. Derivado, el rango 450–820 cruza los cortes
 * habituales y además es COHERENTE con lo que observan SEGIP y digital trust para esa misma
 * persona, porque los tres derivan de la misma identidad.
 */
export function respond(scenario, input = {}, _operation = operationPath, ctx = {}) {
  const identity = identityOf(input, ctx.personaKey);
  const providerReference = derivedReference("INFOCENTER-MOCK", identity, "credit-report");

  if (scenario === "cost_blocked") {
    return {
      provider: code,
      status: "BLOCKED_BY_COST_POLICY",
      reasonCode: "INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL",
      estimatedCostAmount: derivedFloat(identity, "infocenter.cost", 12, 45),
      currency: "BOB",
      providerReference,
    };
  }
  if (scenario === "not_found") {
    return { provider: code, status: "NOT_FOUND", reasonCode: "DOCUMENT_UNKNOWN_TO_BUREAU", providerReference };
  }
  if (scenario === "data_not_available") {
    // Thin file: la persona existe y no tiene historial. Ni COMPLETED con un score inventado ni
    // NOT_FOUND: es una tercera cosa, y el motor de riesgo tiene que poder distinguirla.
    return {
      provider: code,
      status: "DATA_NOT_AVAILABLE",
      reasonCode: "NO_CREDIT_HISTORY",
      bureauScore: null,
      activeDebtCount: 0,
      providerReference,
    };
  }
  if (scenario === "manual_review_required") {
    return {
      provider: code,
      status: "MANUAL_REVIEW_REQUIRED",
      reasonCode: "BUREAU_RECORD_INCONSISTENT",
      bureauScore: derivedInt(identity, "infocenter.review", 430, 560),
      activeDebtCount: derivedInt(identity, "infocenter.debts.review", 3, 7),
      maxDaysPastDue12m: derivedInt(identity, "infocenter.dpd.review", 31, 120),
      manualReviewRequired: true,
      estimatedCostAmount: derivedFloat(identity, "infocenter.cost", 12, 45),
      currency: "BOB",
      providerReference,
    };
  }

  const bureauScore = derivedInt(identity, "infocenter.score", 450, 820);
  return {
    provider: code,
    status: "COMPLETED",
    bureauScore,
    // La mora acompaña al score en vez de sortearse aparte: un 800 con 90 días de mora es una
    // persona que no existe, y una fixture incoherente hace fallar al motor de riesgo por el
    // motivo equivocado.
    activeDebtCount: bureauScore >= 700 ? derivedInt(identity, "infocenter.debts", 0, 2) : derivedInt(identity, "infocenter.debts", 1, 5),
    maxDaysPastDue12m: bureauScore >= 700 ? 0 : derivedInt(identity, "infocenter.dpd", 1, 60),
    estimatedCostAmount: derivedFloat(identity, "infocenter.cost", 12, 45),
    currency: "BOB",
    providerReference,
  };
}
