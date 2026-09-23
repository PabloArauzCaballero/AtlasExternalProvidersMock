import { identityOf, derivedFloat } from "../domain/derive.mjs";

export const code = "WHATSAPP_GENERIC";
export const slug = "whatsapp";
export const mountPath = "/mock/whatsapp";
export const operationPath = "/verification/confirm";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Contactabilidad";
export const description =
  "Confirmación del código enviado por WhatsApp y si el número es alcanzable.";
export const latencyRangeMs = [200, 600];
export const operations = [
  {
    path: operationPath,
    method: "POST",
    summary: "Confirmar el código de verificación",
  },
];
/**
 * `expired_token` = el código caducó. Es la rama de vencimiento que pide el arquetipo "Vencimiento"
 * del paquete QA y que antes no se podía expresar: pedirla devolvía `OTP_VERIFIED`.
 */
export const handledScenarios = [
  "happy_path",
  "not_found",
  "low_confidence",
  "expired_token",
  "data_not_available",
];

/**
 * Este emulador confirma un código; NO es el sistema de OTP de Atlas.
 *
 * Vale la pena decirlo aquí porque el nombre invita a confundirlo: que `verification/confirm`
 * responda `OTP_VERIFIED` no significa que el `start`/`confirm` del backend, su TTL, su límite de
 * intentos y su canal de envío estén probados. Eso vive en AtlasBackend y se prueba contra él.
 */
export function respond(
  scenario,
  input = {},
  _operation = operationPath,
  ctx = {},
) {
  const identity = identityOf(input, ctx.personaKey);

  if (scenario === "not_found") {
    return {
      provider: code,
      status: "NOT_REACHABLE",
      whatsappReachable: false,
      phoneMatch: false,
      contactabilityScore: derivedFloat(identity, "wa.unreachable", 0, 0.15),
    };
  }
  if (scenario === "expired_token") {
    return {
      provider: code,
      status: "OTP_EXPIRED",
      reasonCode: "VERIFICATION_CODE_EXPIRED",
      whatsappReachable: true,
      phoneMatch: null,
      contactabilityScore: derivedFloat(identity, "wa.expired", 0.5, 0.8),
    };
  }
  if (scenario === "low_confidence") {
    return {
      provider: code,
      status: "OTP_UNCERTAIN",
      whatsappReachable: true,
      phoneMatch: false,
      contactabilityScore: derivedFloat(identity, "wa.uncertain", 0.25, 0.5),
      manualReviewRequired: true,
    };
  }
  if (scenario === "data_not_available") {
    return {
      provider: code,
      status: "DATA_NOT_AVAILABLE",
      reasonCode: "CHANNEL_DID_NOT_ANSWER",
      whatsappReachable: null,
    };
  }
  return {
    provider: code,
    status: "OTP_VERIFIED",
    whatsappReachable: true,
    phoneMatch: true,
    contactabilityScore: derivedFloat(identity, "wa.ok", 0.85, 0.99),
  };
}
