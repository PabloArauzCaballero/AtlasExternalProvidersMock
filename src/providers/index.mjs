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
 * es agregar un archivo aquí y registrarlo en esta lista — el servidor y el health check
 * por módulo se derivan automáticamente de mountPath/slug/code.
 */
export const providers = [segip, infocenter, qr, banking, telco, facebook, whatsapp, digitalTrust];

export function findProviderByMountPath(pathname) {
  return providers.find((provider) => pathname === provider.mountPath || pathname.startsWith(`${provider.mountPath}/`));
}

export function findProviderBySlug(slug) {
  return providers.find((provider) => provider.slug === slug);
}
