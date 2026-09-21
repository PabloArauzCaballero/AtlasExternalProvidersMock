/**
 * Qué sabe hacer de verdad cada proveedor, y qué NO.
 *
 * El hallazgo H06 del paquete QA: `POST /mock/segip/identity/verify` con `unknown_scenario`
 * devolvía 200 FOUND. No era un caso raro — era el comportamiento por defecto, porque `respond()`
 * de cada módulo termina en un `return` del caso feliz y cualquier escenario que no reconozca cae
 * ahí. Una prueba que pide `fraud_signal_high` a SEGIP obtenía una identidad verificada y se
 * apuntaba un PASS.
 *
 * La corrección tiene dos mitades:
 *
 * - **Escenarios genéricos**: `provider_down`, `timeout`, `unauthorized`… no dependen del
 *   proveedor, son fallos del transporte o del borde. Los resuelve el servidor para los ocho.
 * - **Escenarios de negocio**: `partial_match`, `cost_blocked`, `revoked_consent`… sólo existen si
 *   ese proveedor los sabe representar. Cada módulo los declara en `handledScenarios`.
 *
 * Pedir un escenario de negocio a un proveedor que no lo declara es un 422 con la lista de los que
 * sí, nunca un éxito. La matriz completa se publica en `GET /mock/providers` para que el portal
 * pueda ofrecer sólo lo que existe en vez de un desplegable de 18 con trampas.
 */
import { SUPPORTED_SCENARIOS } from "./scenarios.mjs";
import { providers } from "./providers/index.mjs";

/** Versión del contrato que publica el emulador. Sube cuando cambia la FORMA de estas respuestas. */
export const SCHEMA_VERSION = "2.0.0";

/**
 * Resueltos por el servidor para cualquier proveedor: son el borde, no el negocio.
 * `happy_path` está aparte: lo entienden todos, pero lo contesta el módulo.
 */
export const GENERIC_SCENARIOS = Object.freeze([
  "provider_down",
  "timeout",
  "slow_response",
  "invalid_payload",
  "unauthorized",
  "rate_limited",
  "provider_internal_error",
]);

const REASONS = {
  generic: "Fallo de transporte resuelto por el emulador para todos los proveedores.",
  declared: "El módulo del proveedor construye una respuesta propia para este escenario.",
  baseline: "Caso base: toda operación tiene camino feliz.",
  notModelled: "Este proveedor no tiene una respuesta que represente ese escenario en su dominio.",
};

export function isKnownScenario(scenario) {
  return SUPPORTED_SCENARIOS.includes(scenario);
}

export function isGenericScenario(scenario) {
  return GENERIC_SCENARIOS.includes(scenario);
}

/** Todo lo que ese proveedor acepta: genéricos + happy_path + los que declara. */
export function scenariosSupportedBy(provider) {
  const declared = provider.handledScenarios ?? ["happy_path"];
  return [...new Set(["happy_path", ...GENERIC_SCENARIOS, ...declared])];
}

export function supportsScenario(provider, scenario) {
  return scenariosSupportedBy(provider).includes(scenario);
}

/** Matriz proveedor × escenario con `supported` y motivo, tal como la pide el paquete QA. */
export function scenarioMatrixFor(provider) {
  const declared = provider.handledScenarios ?? [];
  return SUPPORTED_SCENARIOS.map((scenario) => {
    if (scenario === "happy_path") return { scenario, supported: true, reason: REASONS.baseline };
    if (isGenericScenario(scenario)) return { scenario, supported: true, reason: REASONS.generic };
    const supported = declared.includes(scenario);
    return { scenario, supported, reason: supported ? REASONS.declared : REASONS.notModelled };
  });
}

/** Las operaciones REALES de un proveedor: método y path exacto, ya resueltos a ruta completa. */
export function operationsOf(provider) {
  const declared = provider.operations ?? [{ path: provider.operationPath, method: "POST", summary: null }];
  return declared.map((operation) => ({
    ...operation,
    method: (operation.method ?? "POST").toUpperCase(),
    fullPath: `${provider.mountPath}${operation.path}`,
  }));
}

export function providerCatalog() {
  return providers.map((provider) => ({
    code: provider.code,
    slug: provider.slug,
    domain: provider.domain ?? null,
    description: provider.description ?? null,
    mountPath: provider.mountPath,
    defaultOperationPath: provider.operationPath,
    schemaVersion: SCHEMA_VERSION,
    operations: operationsOf(provider),
    latencyRangeMs: provider.latencyRangeMs ?? null,
    handledScenarios: scenariosSupportedBy(provider),
    scenarioMatrix: scenarioMatrixFor(provider),
    healthPath: `/mock/health/${provider.slug}`,
  }));
}
