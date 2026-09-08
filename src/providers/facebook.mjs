export const code = "FACEBOOK_META";
export const slug = "facebook";
export const mountPath = "/mock/facebook";
export const operationPath = "/me";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Redes sociales";
export const description =
  "Confianza por cuenta de Meta: coincidencia de nombre y correo del perfil conectado.";
export const latencyRangeMs = [150, 500];
export const operations = [{ path: operationPath, method: "POST", summary: "Leer el perfil conectado por OAuth" }];
export const handledScenarios = ["happy_path", "expired_token", "revoked_consent"];

export function respond(scenario) {
  if (scenario === "expired_token") {
    return { provider: code, status: "TOKEN_EXPIRED", reasonCode: "EXPIRED_TOKEN", accountAgeAvailable: false };
  }
  if (scenario === "revoked_consent") {
    return { provider: code, status: "REVOKED", reasonCode: "REVOKED_CONSENT", accountAgeAvailable: false };
  }
  return {
    provider: code,
    status: "CONNECTED",
    profileIdHash: "mock_hash",
    nameMatchScore: 0.91,
    emailMatch: true,
    accountAgeAvailable: false,
    accountAgeDays: null,
    reasonCode: "DATA_NOT_AVAILABLE",
  };
}
