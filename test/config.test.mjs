/**
 * Configuración: fallar al arrancar es mejor que arrancar mal.
 *
 * `Number("ochomil")` es `NaN`, y `server.listen(NaN)` NO falla: Node escucha en un puerto efímero.
 * El emulador quedaba "arriba" en un puerto que nadie conocía mientras el tablero del portal
 * pintaba los ocho proveedores caídos y nadie tenía una línea de error que mirar.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError } from "../src/config.mjs";

describe("loadConfig", () => {
  test("los valores por defecto son los documentados", () => {
    const config = loadConfig({});
    assert.equal(config.port, 4010);
    assert.equal(config.defaultLatencyMs, 300);
    assert.equal(config.strictScenarios, true);
    assert.equal(
      config.controlToken,
      null,
      "sin token, el plano de control queda APAGADO",
    );
  });

  test("un puerto no numérico revienta con causa", () => {
    assert.throws(
      () => loadConfig({ MOCK_PROVIDERS_PORT: "ochomil" }),
      ConfigError,
    );
  });

  test("un puerto fuera de rango revienta", () => {
    assert.throws(
      () => loadConfig({ MOCK_PROVIDERS_PORT: "99999" }),
      ConfigError,
    );
  });

  test("un límite de cuerpo negativo revienta", () => {
    assert.throws(
      () => loadConfig({ MOCK_PROVIDERS_MAX_BODY_BYTES: "-1" }),
      ConfigError,
    );
  });

  test("una tasa de error fuera de [0,1] revienta", () => {
    assert.throws(
      () => loadConfig({ MOCK_PROVIDERS_ERROR_RATE: "5" }),
      ConfigError,
    );
  });

  test("una latencia por defecto mayor que el techo revienta", () => {
    assert.throws(
      () =>
        loadConfig({
          MOCK_PROVIDERS_DEFAULT_LATENCY_MS: "5000",
          MOCK_PROVIDERS_MAX_LATENCY_MS: "1000",
        }),
      ConfigError,
    );
  });

  test("un token de control corto revienta: no sirve como secreto", () => {
    assert.throws(
      () => loadConfig({ MOCK_PROVIDERS_CONTROL_TOKEN: "corto" }),
      ConfigError,
    );
  });

  test("un flag que no es booleano revienta en vez de interpretarse", () => {
    assert.throws(
      () => loadConfig({ MOCK_PROVIDERS_STRICT_SCENARIOS: "quizas" }),
      ConfigError,
    );
  });
});
