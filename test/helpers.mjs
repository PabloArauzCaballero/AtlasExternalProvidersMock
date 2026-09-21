/**
 * Arranque del emulador para una suite: instancia propia, puerto efímero, configuración explícita.
 *
 * Esto es lo que `createMockServer(config)` habilita y antes no se podía hacer: cada test levanta
 * SU emulador con SU configuración —cuerpo máximo de 512 bytes para probar el 413, latencia 0 para
 * no esperar— sin variables de entorno compartidas ni un proceso hijo del que sólo se ve el stdout.
 */
import { createMockServer } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";

export const CONTROL_TOKEN = "token-de-control-de-pruebas";

export async function startMock(overrides = {}) {
  const config = loadConfig({
    MOCK_PROVIDERS_PORT: "0",
    MOCK_PROVIDERS_DEFAULT_LATENCY_MS: "0",
    // Techo 0 ⇒ el rango declarado por cada proveedor se recorta a cero. Una suite que espera de
    // verdad los 600–2500 ms del buró tarda cuarenta segundos y no comprueba nada más por ello; la
    // latencia tiene su propio bloque de pruebas, que sube este techo a propósito.
    MOCK_PROVIDERS_MAX_LATENCY_MS: "0",
    MOCK_PROVIDERS_TIMEOUT_EXTRA_MS: "0",
    MOCK_PROVIDERS_CONTROL_TOKEN: CONTROL_TOKEN,
    ...overrides,
  });
  const silent = { error: () => {}, debug: () => {} };
  const { server, store } = createMockServer(config, { logger: silent });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    store,
    config,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
    async call(path, init = {}) {
      const response = await fetch(`${base}${path}`, init);
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { __unparsable: text };
      }
      return { status: response.status, headers: response.headers, body, text };
    },
    async post(path, payload, headers = {}) {
      return this.call(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    },
    /** Da de alta una corrida por el plano de control y devuelve sus cabeceras de tráfico. */
    async createRun({ tenantId = "t-1", runId = "r-1", scenarioProfile, seed = "seed-1" } = {}) {
      const created = await this.post(
        "/mock/control/runs",
        { tenantId, runId, seed, scenarioProfile },
        { authorization: `Bearer ${CONTROL_TOKEN}` },
      );
      if (created.status !== 201) throw new Error(`no se pudo crear la corrida: ${created.status} ${created.text}`);
      return {
        tenantId,
        runId,
        runToken: created.body.runToken,
        headers: {
          "x-mock-tenant-id": tenantId,
          "x-mock-run-id": runId,
          "x-mock-run-token": created.body.runToken,
        },
        control: { authorization: `Bearer ${CONTROL_TOKEN}`, "x-mock-tenant-id": tenantId },
      };
    },
  };
}
