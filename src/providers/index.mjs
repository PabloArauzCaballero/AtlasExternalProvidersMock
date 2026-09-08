import * as segip from "./segip.mjs";
import * as infocenter from "./infocenter.mjs";
import * as qr from "./qr.mjs";
import * as banking from "./banking.mjs";
import * as telco from "./telco.mjs";
import * as facebook from "./facebook.mjs";
import * as whatsapp from "./whatsapp.mjs";
import * as digitalTrust from "./digital-trust.mjs";

/**
 * Cada módulo es el "emulador" de un proveedor externo real. Agregar un proveedor nuevo
 * es agregar un archivo aquí y registrarlo en esta lista — el servidor, el health check
 * por módulo y el catálogo se derivan automáticamente de lo que el módulo exporta.
 */
export const providers = [segip, infocenter, qr, banking, telco, facebook, whatsapp, digitalTrust];

export function findProviderByMountPath(pathname) {
  return providers.find((provider) => pathname === provider.mountPath || pathname.startsWith(`${provider.mountPath}/`));
}

export function findProviderBySlug(slug) {
  return providers.find((provider) => provider.slug === slug);
}

/**
 * La operación pedida, relativa al `mountPath`: `/mock/banking/qr/generate` ⇒ `/qr/generate`.
 * Sin ella, un proveedor con dos operaciones no puede distinguirlas (ver `banking.mjs`).
 */
export function operationFromPath(provider, pathname) {
  const rest = pathname.slice(provider.mountPath.length);
  return rest === "" ? provider.operationPath : rest;
}

/**
 * Catálogo que sirve `GET /mock/providers`. La documentación de AtlasBackend
 * (`docs/external-providers/mock-server.md`) prometía este endpoint —"dominio, endpoint y rango de
 * latencia"— desde antes de que existiera; esto lo cumple. Lo consume el tablero del portal para
 * explicar cada tarjeta y para ofrecer los escenarios que ese proveedor entiende de verdad.
 */
export function providerCatalog() {
  return providers.map((provider) => ({
    code: provider.code,
    slug: provider.slug,
    domain: provider.domain ?? null,
    description: provider.description ?? null,
    mountPath: provider.mountPath,
    defaultOperationPath: provider.operationPath,
    operations: (provider.operations ?? [{ path: provider.operationPath, method: "POST", summary: null }]).map((operation) => ({
      ...operation,
      fullPath: `${provider.mountPath}${operation.path}`,
    })),
    latencyRangeMs: provider.latencyRangeMs ?? null,
    handledScenarios: provider.handledScenarios ?? ["happy_path"],
    healthPath: `/mock/health/${provider.slug}`,
  }));
}
