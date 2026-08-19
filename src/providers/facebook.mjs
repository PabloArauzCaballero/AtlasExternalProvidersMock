export const code = "FACEBOOK_META";
export const slug = "facebook";
export const mountPath = "/mock/facebook";
export const operationPath = "/me";

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
