import { identityOf, derivedFloat, derivedPick } from "../domain/derive.mjs";

export const code = "DIGITAL_TRUST_GENERIC";
export const slug = "digital-trust";
export const mountPath = "/mock/digital-trust";
export const operationPath = "/check";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Confianza digital";
export const description =
  "Riesgo del correo, del dispositivo y de la IP; señal de identidad sintética.";
export const latencyRangeMs = [300, 900];
export const operations = [
  {
    path: operationPath,
    method: "POST",
    summary: "Evaluar señales de riesgo digital",
  },
];
export const handledScenarios = [
  "happy_path",
  "fraud_signal_high",
  "low_confidence",
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
      status: "COMPLETED",
      emailRiskLevel: derivedPick(identity, "dt.email.risk", [
        "MEDIUM",
        "HIGH",
      ]),
      deviceRiskScore: derivedFloat(identity, "dt.device.risk", 0.7, 0.95),
      ipRiskScore: derivedFloat(identity, "dt.ip.risk", 0.7, 0.95),
      syntheticIdentityRiskLevel: "HIGH",
      signalCoverage: derivedFloat(identity, "dt.coverage.risk", 0.7, 0.95),
      manualReviewRequired: true,
    };
  }
  if (scenario === "low_confidence") {
    // Señales insuficientes, no señales malas. La diferencia importa: un backend que trata "no sé"
    // como "riesgo alto" rechaza gente por falta de datos, y eso es un defecto, no una política.
    return {
      provider: code,
      status: "LOW_CONFIDENCE",
      emailRiskLevel: "UNKNOWN",
      deviceRiskScore: null,
      ipRiskScore: derivedFloat(identity, "dt.ip.low", 0.3, 0.6),
      syntheticIdentityRiskLevel: "UNKNOWN",
      signalCoverage: derivedFloat(identity, "dt.coverage.low", 0.2, 0.45),
      manualReviewRequired: true,
      reasonCode: "INSUFFICIENT_SIGNALS",
    };
  }
  if (scenario === "data_not_available") {
    return {
      provider: code,
      status: "DATA_NOT_AVAILABLE",
      reasonCode: "NO_DEVICE_FINGERPRINT",
      signalCoverage: 0,
    };
  }

  return {
    provider: code,
    status: "COMPLETED",
    emailRiskLevel: "LOW",
    deviceRiskScore: derivedFloat(identity, "dt.device", 0.05, 0.3),
    ipRiskScore: derivedFloat(identity, "dt.ip", 0.05, 0.3),
    syntheticIdentityRiskLevel: "LOW",
    signalCoverage: derivedFloat(identity, "dt.coverage.ok", 0.75, 0.98),
    manualReviewRequired: false,
  };
}
