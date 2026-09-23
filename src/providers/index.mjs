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
 * por módulo, el catálogo y la tabla de rutas se derivan de lo que el módulo exporta.
 *
 * Contrato de un módulo:
 *   code, slug, mountPath, operationPath, operations[{path, method, summary}],
 *   latencyRangeMs, handledScenarios[], respond(scenario, input, operationPath, ctx)
 *
 * `ctx` trae `{ personaKey, attempt, entity, setEntity }`. Un proveedor sin estado lo ignora; los
 * que evolucionan (un QR que pasa de pendiente a verificado) leen `entity` y escriben con
 * `setEntity`. El estado vive en el namespace de la corrida, nunca en el módulo: dos corridas en
 * paralelo no pueden compartir una variable de archivo.
 */
export const providers = [
  segip,
  infocenter,
  qr,
  banking,
  telco,
  facebook,
  whatsapp,
  digitalTrust,
];

export function findProviderBySlug(slug) {
  return providers.find((provider) => provider.slug === slug);
}
