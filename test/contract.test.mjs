/**
 * Contrato del emulador: lo que sus consumidores dan por cierto.
 *
 * La documentación de AtlasBackend prometía este archivo desde antes de que existiera
 * (`docs/external-providers/mock-server.md` citaba `test/contract.test.mjs` y el repo no tenía ni
 * suite ni script `test`). Cada bloque de aquí abajo nombra el hallazgo del paquete QA que cierra,
 * porque son todos falsos positivos comprobados: casos en los que el emulador respondía 200 y una
 * prueba se apuntaba un PASS que no le correspondía.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock } from "./helpers.mjs";
import { SUPPORTED_SCENARIOS } from "../src/scenarios.mjs";

describe("enrutado por método y path exacto (H04, H05)", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("una operación declarada responde 200", async () => {
    const response = await mock.post("/mock/segip/identity/verify", { scenario: "happy_path", input: { documentNumber: "1234567" } });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "FOUND");
  });

  test("H04: una ruta que el proveedor no expone es 404, no un camino feliz", async () => {
    const response = await mock.post("/mock/segip/nonexistent", { scenario: "happy_path" });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "ROUTE_NOT_FOUND");
  });

  test("H05: el método equivocado sobre una ruta que existe es 405 con Allow", async () => {
    const response = await mock.call("/mock/segip/identity/verify");
    assert.equal(response.status, 405);
    assert.equal(response.body.error, "METHOD_NOT_ALLOWED");
    assert.equal(response.headers.get("allow"), "POST");
  });

  test("un prefijo del mountPath no arrastra a la operación", async () => {
    const response = await mock.post("/mock/segip", {});
    assert.equal(response.status, 404);
  });

  test("las dos operaciones de banca se distinguen", async () => {
    const qr = await mock.post("/mock/banking/qr/generate", { input: { amount: 250, currency: "BOB", reference: "COB-1" } });
    const transfer = await mock.post("/mock/banking/transfer/verify", { input: { amount: 250, reference: "COB-1", documentNumber: "9" } });
    assert.equal(qr.body.status, "QR_GENERATED");
    assert.equal(transfer.body.status, "VERIFIED");
  });
});

describe("escenarios: nada cae al camino feliz (H06)", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("H06: un escenario inexistente es 400, no 200 FOUND", async () => {
    const response = await mock.post("/mock/segip/identity/verify", { scenario: "unknown_scenario" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "UNKNOWN_SCENARIO");
    assert.deepEqual(response.body.scenarios, SUPPORTED_SCENARIOS);
  });

  test("un escenario conocido que ESTE proveedor no representa es 422 con la lista de los que sí", async () => {
    const response = await mock.post("/mock/segip/identity/verify", { scenario: "cost_blocked" });
    assert.equal(response.status, 422);
    assert.equal(response.body.error, "SCENARIO_NOT_SUPPORTED_BY_PROVIDER");
    assert.ok(response.body.supportedScenarios.includes("partial_match"));
    assert.ok(!response.body.supportedScenarios.includes("cost_blocked"));
  });

  test("los escenarios genéricos valen para cualquier proveedor", async () => {
    const down = await mock.post("/mock/segip/identity/verify", { scenario: "provider_down" });
    assert.equal(down.status, 503);
    assert.equal(down.body.status, "PROVIDER_UNAVAILABLE");
  });

  test("rate_limited trae Retry-After utilizable", async () => {
    const response = await mock.post("/mock/infocenter/credit-report", { scenario: "rate_limited" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "2");
  });

  test("invalid_payload inyecta JSON roto a propósito y queda marcado como inyección", async () => {
    const response = await mock.post("/mock/qr/payment/verify", { scenario: "invalid_payload" });
    assert.equal(response.status, 200);
    assert.equal(response.text, "{ invalid-json");
  });

  test("el catálogo publica la matriz proveedor × escenario con motivo", async () => {
    const response = await mock.call("/mock/providers");
    assert.equal(response.status, 200);
    const segip = response.body.providers.find((provider) => provider.slug === "segip");
    const costBlocked = segip.scenarioMatrix.find((row) => row.scenario === "cost_blocked");
    assert.equal(costBlocked.supported, false);
    assert.ok(costBlocked.reason.length > 0);
    // Toda fila declara un veredicto: un desplegable del portal no puede ofrecer 18 opciones de
    // las que la mitad devuelve 422.
    assert.equal(segip.scenarioMatrix.length, SUPPORTED_SCENARIOS.length);
  });
});

describe("cuerpo, tipo y tamaño (H07)", () => {
  let mock;
  before(async () => (mock = await startMock({ MOCK_PROVIDERS_MAX_BODY_BYTES: "1024" })));
  after(async () => mock.close());

  test("H07: JSON roto es 400 explícito, no un cuerpo vacío que pasa como válido", async () => {
    const response = await mock.call("/mock/segip/identity/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ roto",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_JSON");
  });

  test("un cuerpo que no es objeto es 400", async () => {
    const response = await mock.call("/mock/segip/identity/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[1,2,3]",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_BODY_SHAPE");
  });

  test("un cuerpo por encima del límite es 413", async () => {
    const response = await mock.call("/mock/segip/identity/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { relleno: "x".repeat(4096) } }),
    });
    assert.equal(response.status, 413);
    assert.equal(response.body.error, "PAYLOAD_TOO_LARGE");
  });

  test("un media type que no es JSON es 415", async () => {
    const response = await mock.call("/mock/segip/identity/verify", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hola",
    });
    assert.equal(response.status, 415);
    assert.equal(response.body.error, "UNSUPPORTED_MEDIA_TYPE");
  });

  test("sin cuerpo se atiende igual: el consumidor legacy manda POST vacío", async () => {
    const response = await mock.call("/mock/segip/identity/verify", { method: "POST" });
    assert.equal(response.status, 200);
  });
});

describe("latencia acotada (H08)", () => {
  let mock;
  before(async () => (mock = await startMock({ MOCK_PROVIDERS_MAX_LATENCY_MS: "500" })));
  after(async () => mock.close());

  test("una latencia negativa es 400", async () => {
    const response = await mock.post("/mock/segip/identity/verify", {}, { "x-mock-latency-ms": "-5" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_LATENCY_HEADER");
  });

  test("una latencia por encima del techo configurado es 400, no un cuelgue", async () => {
    const response = await mock.post("/mock/segip/identity/verify", {}, { "x-mock-latency-ms": "1000000" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_LATENCY_HEADER");
  });

  test("una latencia no numérica es 400", async () => {
    const response = await mock.post("/mock/segip/identity/verify", {}, { "x-mock-latency-ms": "despacio" });
    assert.equal(response.status, 400);
  });

  test("una latencia válida se respeta", async () => {
    const started = Date.now();
    const response = await mock.post("/mock/segip/identity/verify", {}, { "x-mock-latency-ms": "120" });
    assert.equal(response.status, 200);
    assert.ok(Date.now() - started >= 100, "la espera pedida se aplicó");
  });
});

describe("datos coherentes con la persona (H09)", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("H09: el camino feliz del QR devuelve el monto que se está verificando, no 600 fijo", async () => {
    const response = await mock.post("/mock/qr/payment/verify", {
      input: { amount: 1234.5, currency: "BOB", reference: "PAGO-77", documentNumber: "8891234" },
    });
    assert.equal(response.body.status, "PAYMENT_VERIFIED");
    assert.equal(response.body.paidAmount, 1234.5);
    assert.equal(response.body.reference, "PAGO-77");
  });

  test("partial_match devuelve una discrepancia comprobable contra lo pedido", async () => {
    const response = await mock.post("/mock/qr/payment/verify", {
      scenario: "partial_match",
      input: { amount: 1000, reference: "PAGO-78", documentNumber: "8891234" },
    });
    assert.equal(response.body.amountMatches, false);
    assert.equal(response.body.requestedAmount, 1000);
    assert.ok(response.body.paidAmount < 1000);
  });

  test("dos personas distintas obtienen observaciones distintas", async () => {
    const uno = await mock.post("/mock/infocenter/credit-report", { input: { documentNumber: "1111111" } });
    const dos = await mock.post("/mock/infocenter/credit-report", { input: { documentNumber: "9999999" } });
    assert.notEqual(uno.body.bureauScore, dos.body.bureauScore);
  });

  test("la misma persona obtiene siempre la misma observación", async () => {
    const uno = await mock.post("/mock/infocenter/credit-report", { input: { documentNumber: "5555555" } });
    const dos = await mock.post("/mock/infocenter/credit-report", { input: { documentNumber: "5555555" } });
    assert.equal(uno.body.bureauScore, dos.body.bureauScore);
    assert.equal(uno.body.providerReference, dos.body.providerReference);
  });

  test("score y mora no se contradicen", async () => {
    for (const documentNumber of ["1", "22", "333", "4444", "55555", "666666"]) {
      const { body } = await mock.post("/mock/infocenter/credit-report", { input: { documentNumber } });
      if (body.bureauScore >= 700) assert.equal(body.maxDaysPastDue12m, 0, `score ${body.bureauScore} con mora`);
    }
  });

  test("la antigüedad de la línea manda sobre su bucket", async () => {
    for (const phone of ["70000001", "70000002", "70000003", "70000004"]) {
      const { body } = await mock.post("/mock/telco/phone-trust/check", { input: { phoneNumber: phone } });
      assert.equal(body.lineAgeBucket, body.lineAgeDays >= 365 ? "OLD" : "RECENT");
    }
  });
});

describe("salud: vivo no es listo", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("/mock/live sólo afirma que el proceso atiende", async () => {
    const response = await mock.call("/mock/live");
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "LIVE");
  });

  test("/mock/ready comprueba el catálogo entero", async () => {
    const response = await mock.call("/mock/ready");
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "READY");
    assert.deepEqual(response.body.problems, []);
  });

  test("/mock/health se conserva para el consumidor actual", async () => {
    const response = await mock.call("/mock/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.modules.length, 8);
  });

  test("un módulo inexistente es 404 con causa", async () => {
    const response = await mock.call("/mock/health/no-existe");
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "UNKNOWN_MODULE");
  });
});
