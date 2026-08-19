export const code = "INFOCENTER";
export const slug = "infocenter";
export const mountPath = "/mock/infocenter";
export const operationPath = "/credit-report";

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
