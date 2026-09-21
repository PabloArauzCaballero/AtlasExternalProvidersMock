/**
 * Entrypoint. Lo único que hace es leer el entorno, construir el emulador y escuchar —y morir con
 * un mensaje claro si la configuración no cuadra, en vez de arrancar a medias.
 *
 * El comportamiento vive en `app.mjs` (`createMockServer`) para que una suite pueda levantar su
 * propia instancia sin tocar `process.env` ni lanzar un proceso hijo.
 */
import { loadConfig, ConfigError } from "./config.mjs";
import { createMockServer } from "./app.mjs";
import { providers } from "./providers/index.mjs";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    // Fallar aquí es el punto: `listen(NaN)` no falla, escucha en un puerto efímero, y el emulador
    // queda "arriba" donde nadie lo busca mientras el tablero pinta ocho proveedores caídos.
    console.error(`[atlas-external-providers-mock-server] configuración inválida: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const { server, store } = createMockServer(config);

server.listen(config.port, () => {
  const { port } = server.address();
  console.log(`[atlas-external-providers-mock-server] listening on http://localhost:${port}`);
  console.log(`  modules: ${providers.map((provider) => provider.slug).join(", ")}`);
  console.log(`  epoch: ${store.epoch} (un reinicio invalida los namespaces de corridas anteriores)`);
  console.log(`  escenarios estrictos: ${config.strictScenarios ? "sí" : "NO — un escenario no soportado caerá al camino feliz"}`);
  console.log(`  plano de control: ${config.controlToken ? "activo" : "APAGADO (falta MOCK_PROVIDERS_CONTROL_TOKEN)"}`);
  if (config.backgroundErrorRate > 0) console.log(`  background error rate: ${config.backgroundErrorRate}`);
});

/** Apagado ordenado: se deja de aceptar conexiones y se espera a las que están en vuelo. */
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[atlas-external-providers-mock-server] ${signal}: cerrando`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
