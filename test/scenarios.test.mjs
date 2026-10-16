import assert from "node:assert/strict";
import test from "node:test";
import {
  backgroundFailureFor,
  latencyMsFor,
  transportFailureFor,
} from "../src/scenarios.mjs";

/*
 * Rescatado de una sesión cerrada (2026-09-22, nunca commiteado). La prueba de «la cabecera de
 * latencia prevalece sobre slow_response» se descarta: esa cabecera ya no se resuelve en
 * `latencyMsFor` sino en el servidor, contra un techo (ver el comentario de la función).
 */
test("un escenario explícito queda libre del fallo de fondo aunque la tasa sea 100 %", () => {
  assert.equal(backgroundFailureFor(1, true), null);
});

test("provider_down conserva el contrato de error de transporte", () => {
  assert.deepEqual(transportFailureFor("provider_down"), {
    statusCode: 503,
    payload: {
      status: "PROVIDER_UNAVAILABLE",
      reasonCode: "MOCK_PROVIDER_DOWN",
    },
  });
});

test("slow_response apunta al triple del techo del proveedor", () => {
  assert.equal(
    latencyMsFor("slow_response", { latencyRangeMs: [80, 160] }, 300),
    480,
  );
});
