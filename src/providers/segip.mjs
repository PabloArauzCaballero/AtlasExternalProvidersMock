import { identityOf, derivedFloat, derivedReference } from "../domain/derive.mjs";

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
/**
 * `manual_review_required` es la rama "a corregir" de la tabla de evolución del paquete QA: el
 * documento existe y los datos no cierran, así que no es ni verificado ni inexistente — va a un
 * operador. Sin él, esa rama se pedía como `partial_match` y se perdía la distinción entre "coincide
 * a medias" y "hay que revisarlo a mano".
 */
export const handledScenarios = ["happy_path", "partial_match", "not_found", "data_not_available", "manual_review_required"];

/**
 * Las observaciones se DERIVAN del documento, no son constantes.
 *
 * `matchScore: 0.98` fijo para todas las personas convierte en tautología cualquier umbral que el
 * backend aplique sobre él: mil personas sintéticas cruzan el mismo corte de la misma forma, y una
 * regla de elegibilidad mal puesta nunca se manifiesta. Derivado del documento, el score es estable
 * para la misma persona (un reintento observa lo mismo) y distinto entre personas, que es lo que
 * hace que un umbral tenga algo que separar.
 */
export function respond(scenario, input = {}, _operation = operationPath, ctx = {}) {
  const identity = identityOf(input, ctx.personaKey);
  const providerReference = derivedReference("SEGIP-MOCK", identity, "identity");

  if (scenario === "partial_match") {
    return {
      provider: code,
      status: "PARTIAL_MATCH",
      documentExists: true,
      nameMatches: false,
      birthDateMatches: true,
      extensionMatches: true,
      complementMatches: true,
      matchScore: derivedFloat(identity, "segip.partial", 0.45, 0.74),
      manualReviewRequired: true,
      providerReference,
    };
  }
  if (scenario === "manual_review_required") {
    return {
      provider: code,
      status: "MANUAL_REVIEW_REQUIRED",
      documentExists: true,
      nameMatches: true,
      birthDateMatches: false,
      extensionMatches: true,
      complementMatches: false,
      matchScore: derivedFloat(identity, "segip.review", 0.55, 0.79),
      manualReviewRequired: true,
      reasonCode: "IDENTITY_DATA_NEEDS_CORRECTION",
      providerReference,
    };
  }
  if (scenario === "not_found") {
    return {
      provider: code,
      status: "NOT_FOUND",
      documentExists: false,
      matchScore: 0,
      manualReviewRequired: true,
      providerReference: derivedReference("SEGIP-MOCK-404", identity, "identity"),
    };
  }
  if (scenario === "data_not_available") {
    return { provider: code, status: "DATA_NOT_AVAILABLE", reasonCode: "DATA_NOT_AVAILABLE", providerReference };
  }
  return {
    provider: code,
    status: "FOUND",
    documentExists: true,
    nameMatches: true,
    birthDateMatches: true,
    extensionMatches: true,
    complementMatches: true,
    matchScore: derivedFloat(identity, "segip.match", 0.9, 0.99),
    manualReviewRequired: false,
    providerReference,
  };
}
