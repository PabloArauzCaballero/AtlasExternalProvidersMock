import {
  identityOf,
  derivedFloat,
  derivedInt,
  derivedReference,
} from "../domain/derive.mjs";

export const code = "FACEBOOK_META";
export const slug = "facebook";
export const mountPath = "/mock/facebook";
export const operationPath = "/me";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Redes sociales";
export const description =
  "Confianza por cuenta de Meta: coincidencia de nombre y correo del perfil conectado.";
export const latencyRangeMs = [150, 500];
export const operations = [
  {
    path: operationPath,
    method: "POST",
    summary: "Leer el perfil conectado por OAuth",
  },
];
export const handledScenarios = [
  "happy_path",
  "expired_token",
  "revoked_consent",
  "data_not_available",
];

export function respond(
  scenario,
  input = {},
  _operation = operationPath,
  ctx = {},
) {
  const identity = identityOf(input, ctx.personaKey);

  if (scenario === "expired_token") {
    return {
      provider: code,
      status: "TOKEN_EXPIRED",
      reasonCode: "EXPIRED_TOKEN",
      accountAgeAvailable: false,
    };
  }
  if (scenario === "revoked_consent") {
    return {
      provider: code,
      status: "REVOKED",
      reasonCode: "REVOKED_CONSENT",
      accountAgeAvailable: false,
    };
  }
  if (scenario === "data_not_available") {
    return {
      provider: code,
      status: "DATA_NOT_AVAILABLE",
      reasonCode: "PROFILE_NOT_SHARED",
      accountAgeAvailable: false,
      accountAgeDays: null,
    };
  }
  return {
    provider: code,
    status: "CONNECTED",
    // Hash POR PERSONA, no la cadena literal "mock_hash" para todas: con una constante, una prueba
    // de "dos personas no comparten perfil" pasa siempre sin comprobar nada.
    profileIdHash: derivedReference("FB", identity, "profile"),
    nameMatchScore: derivedFloat(identity, "fb.name", 0.72, 0.98),
    emailMatch: true,
    accountAgeAvailable: true,
    accountAgeDays: derivedInt(identity, "fb.age", 180, 4000),
    reasonCode: null,
  };
}
