import { identityOf, derivedInt, derivedFloat } from "../domain/derive.mjs";

export const code = "TELCO_GENERIC";
export const slug = "telco";
export const mountPath = "/mock/telco";
export const operationPath = "/phone-trust/check";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Telco";
export const description =
  "Confianza de la línea telefónica: antigüedad, cambio reciente de SIM y coincidencia del titular.";
export const latencyRangeMs = [300, 800];
export const operations = [
  {
    path: operationPath,
    method: "POST",
    summary: "Consultar la confianza de una línea",
  },
];
/** `manual_review_required` es la tercera rama de la tabla del paquete QA: estable / riesgo / revisión. */
export const handledScenarios = [
  "happy_path",
  "fraud_signal_high",
  "manual_review_required",
  "data_not_available",
];

export function respond(
  scenario,
  input = {},
  _operation = operationPath,
  ctx = {},
) {
  const identity = identityOf(input, ctx.personaKey);

  if (scenario === "fraud_signal_high") {
    return {
      provider: code,
      status: "VERIFIED",
      phoneNumberActive: true,
      lineAgeDays: derivedInt(identity, "telco.age.risk", 1, 14),
      lineAgeBucket: "NEW",
      recentSimChangeDetected: true,
      simSwapRiskLevel: "HIGH",
      ownerMatchScore: derivedFloat(identity, "telco.owner.risk", 0.2, 0.5),
      manualReviewRequired: true,
    };
  }
  if (scenario === "manual_review_required") {
    return {
      provider: code,
      status: "VERIFIED",
      phoneNumberActive: true,
      lineAgeDays: derivedInt(identity, "telco.age.review", 20, 120),
      lineAgeBucket: "RECENT",
      recentSimChangeDetected: false,
      simSwapRiskLevel: "MEDIUM",
      ownerMatchScore: derivedFloat(identity, "telco.owner.review", 0.55, 0.74),
      manualReviewRequired: true,
      reasonCode: "OWNER_MATCH_INCONCLUSIVE",
    };
  }
  if (scenario === "data_not_available") {
    return {
      provider: code,
      status: "DATA_NOT_AVAILABLE",
      reasonCode: "CARRIER_DID_NOT_ANSWER",
      phoneNumberActive: null,
    };
  }

  // La antigüedad manda sobre el resto: una línea de dos años no puede salir con `NEW`, y el
  // bucket se calcula de ella en vez de declararse aparte, que es como se cuelan las fixtures
  // contradictorias.
  const lineAgeDays = derivedInt(identity, "telco.age", 200, 2200);
  return {
    provider: code,
    status: "VERIFIED",
    phoneNumberActive: true,
    lineAgeDays,
    lineAgeBucket: lineAgeDays >= 365 ? "OLD" : "RECENT",
    recentSimChangeDetected: false,
    simSwapRiskLevel: "LOW",
    ownerMatchScore: derivedFloat(identity, "telco.owner", 0.82, 0.97),
    manualReviewRequired: false,
  };
}
