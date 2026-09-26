/**
 * Aislamiento entre corridas: el hallazgo H03 y todo lo que se apoya en él.
 *
 * El emulador tenía `activeScenario` como variable de módulo y un `POST /mock/reset` que la volvía
 * a `happy_path` para todo el proceso. Con una corrida no se nota; con dos en paralelo —que es el
 * objetivo del motor QA— las dos miden la del otro y el reset de una borra el estado de la otra.
 *
 * Estas pruebas son el oráculo del "reset aislado" del paquete QA: corridas A y B con la misma
 * persona y escenarios opuestos, A se resetea, B conserva lo suyo.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, CONTROL_TOKEN } from "./helpers.mjs";

describe("plano de control", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("sin token, el plano de control es 401", async () => {
    const response = await mock.post("/mock/control/runs", {
      tenantId: "t",
      runId: "r",
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "CONTROL_UNAUTHORIZED");
  });

  test("con un token equivocado también es 401", async () => {
    const response = await mock.post(
      "/mock/control/runs",
      { tenantId: "t", runId: "r" },
      { authorization: "Bearer otro-token-de-16" },
    );
    assert.equal(response.status, 401);
  });

  test("dar de alta una corrida devuelve su token una sola vez", async () => {
    const run = await mock.createRun({ runId: "alta-1" });
    assert.ok(run.runToken.length > 20);
    const listed = await mock.call("/mock/control/runs", {
      headers: { authorization: `Bearer ${CONTROL_TOKEN}` },
    });
    const row = listed.body.runs.find((entry) => entry.runId === "alta-1");
    assert.ok(row, "la corrida aparece listada");
    assert.equal(row.runToken, undefined, "el token NO se vuelve a publicar");
  });

  test("dos altas con el mismo identificador es 409", async () => {
    await mock.createRun({ runId: "dup-1" });
    const again = await mock.post(
      "/mock/control/runs",
      { tenantId: "t-1", runId: "dup-1" },
      { authorization: `Bearer ${CONTROL_TOKEN}` },
    );
    assert.equal(again.status, 409);
  });
});

describe("el contexto de corrida no se puede fabricar desde una cabecera", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("nombrar una corrida que no existe es 404, no un namespace nuevo", async () => {
    const response = await mock.post(
      "/mock/segip/identity/verify",
      {},
      {
        "x-mock-tenant-id": "t-1",
        "x-mock-run-id": "inventada",
        "x-mock-run-token": "lo-que-sea",
      },
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "NAMESPACE_NOT_FOUND");
  });

  test("nombrar una corrida real sin su token es 401", async () => {
    const run = await mock.createRun({ runId: "protegida" });
    const response = await mock.post(
      "/mock/segip/identity/verify",
      {},
      {
        "x-mock-tenant-id": run.tenantId,
        "x-mock-run-id": run.runId,
        "x-mock-run-token": "token-robado",
      },
    );
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "INVALID_RUN_TOKEN");
  });

  test("declarar tenant sin runId es 400", async () => {
    const response = await mock.post(
      "/mock/segip/identity/verify",
      {},
      { "x-mock-tenant-id": "t-1" },
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INCOMPLETE_RUN_CONTEXT");
  });

  test("una llamada sin contexto sigue funcionando: es el consumidor actual del backend", async () => {
    const response = await mock.post("/mock/segip/identity/verify", {
      scenario: "happy_path",
      input: {},
    });
    assert.equal(response.status, 200);
  });
});

describe("dos corridas en paralelo con escenarios opuestos (H03)", () => {
  let mock;
  let runA;
  let runB;
  before(async () => {
    mock = await startMock();
    runA = await mock.createRun({
      runId: "run-a",
      scenarioProfile: "provider_down",
    });
    runB = await mock.createRun({
      runId: "run-b",
      scenarioProfile: "happy_path",
    });
  });
  after(async () => mock.close());

  test("cada corrida recibe SU escenario, aunque compartan proveedor y persona", async () => {
    const [a, b] = await Promise.all([
      mock.post(
        "/mock/segip/identity/verify",
        { input: { documentNumber: "777" } },
        { ...runA.headers, "x-mock-persona-key": "p-1" },
      ),
      mock.post(
        "/mock/segip/identity/verify",
        { input: { documentNumber: "777" } },
        { ...runB.headers, "x-mock-persona-key": "p-1" },
      ),
    ]);
    assert.equal(a.status, 503, "A pidió provider_down");
    assert.equal(b.status, 200, "B pidió happy_path");
  });

  test("H03: el reset de una corrida no toca la otra", async () => {
    await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 10, reference: "R-A" } },
      {
        ...runA.headers,
        "x-mock-persona-key": "p-9",
        "x-mock-scenario": "happy_path",
      },
    );
    await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 10, reference: "R-B" } },
      { ...runB.headers, "x-mock-persona-key": "p-9" },
    );

    const reset = await mock.post(
      `/mock/control/runs/${runA.runId}/reset`,
      {},
      runA.control,
    );
    assert.equal(reset.status, 200);

    // B conserva su entidad verificada: una segunda verificación la ve como ya verificada.
    const bAgain = await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 10, reference: "R-B" } },
      { ...runB.headers, "x-mock-persona-key": "p-9" },
    );
    assert.equal(bAgain.body.alreadyVerified, true, "B conservó su estado");

    // A parte de cero.
    const aAgain = await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 10, reference: "R-A" } },
      {
        ...runA.headers,
        "x-mock-persona-key": "p-9",
        "x-mock-scenario": "happy_path",
      },
    );
    assert.equal(aAgain.body.alreadyVerified, false, "A quedó limpia");
  });

  test("el reset legacy no toca las corridas con namespace propio", async () => {
    await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 5, reference: "R-B2" } },
      { ...runB.headers, "x-mock-persona-key": "p-legacy" },
    );
    const legacyReset = await mock.post("/mock/reset", {});
    assert.equal(legacyReset.body.scope, "legacy");
    const still = await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 5, reference: "R-B2" } },
      { ...runB.headers, "x-mock-persona-key": "p-legacy" },
    );
    assert.equal(still.body.alreadyVerified, true);
  });

  test("el journal de una corrida sólo contiene sus llamadas", async () => {
    const journalB = await mock.call(
      `/mock/control/runs/${runB.runId}/journal`,
      { headers: runB.control },
    );
    assert.equal(journalB.status, 200);
    assert.ok(
      journalB.body.entries.length > 0,
      "hay evidencia de que las llamadas llegaron",
    );
    assert.ok(
      journalB.body.entries.every(
        (entry) => entry.runId === null || entry.runId === "run-b",
      ),
    );
  });

  test("el journal no guarda el cuerpo sensible", async () => {
    const journal = await mock.call(
      `/mock/control/runs/${runB.runId}/journal`,
      { headers: runB.control },
    );
    const serialized = JSON.stringify(journal.body);
    assert.ok(
      !serialized.includes(runB.runToken),
      "el token de la corrida no aparece en el journal",
    );
  });
});

describe("idempotencia por corrida y por persona", () => {
  let mock;
  let run;
  before(async () => {
    mock = await startMock();
    run = await mock.createRun({ runId: "idem" });
  });
  after(async () => mock.close());

  test("misma clave y mismo cuerpo devuelve el resultado guardado, sin ejecutar otra vez", async () => {
    const headers = {
      ...run.headers,
      "x-mock-persona-key": "p-idem",
      "x-idempotency-key": "K1",
    };
    const input = { amount: 300, reference: "IDEM-1", documentNumber: "42" };
    const first = await mock.post(
      "/mock/qr/payment/verify",
      { input },
      headers,
    );
    const second = await mock.post(
      "/mock/qr/payment/verify",
      { input },
      headers,
    );
    assert.equal(first.status, 200);
    assert.equal(second.body.idempotentReplay, true);
    assert.equal(second.body.providerReference, first.body.providerReference);
    // Y no marca un segundo cobro: es la MISMA intención, no una nueva.
    assert.equal(second.body.alreadyVerified, first.body.alreadyVerified);
  });

  test("misma clave con otro cuerpo es 422, no una operación nueva", async () => {
    const headers = {
      ...run.headers,
      "x-mock-persona-key": "p-idem",
      "x-idempotency-key": "K2",
    };
    await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 100, reference: "A" } },
      headers,
    );
    const conflict = await mock.post(
      "/mock/qr/payment/verify",
      { input: { amount: 999, reference: "A" } },
      headers,
    );
    assert.equal(conflict.status, 422);
    assert.equal(
      conflict.body.error,
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY",
    );
  });

  test("dos envíos concurrentes de la misma intención producen un solo efecto", async () => {
    const headers = {
      ...run.headers,
      "x-mock-persona-key": "p-carrera",
      "x-idempotency-key": "K3",
    };
    const input = { amount: 750, reference: "CARRERA", documentNumber: "77" };
    const [a, b] = await Promise.all([
      mock.post("/mock/qr/payment/verify", { input }, headers),
      mock.post("/mock/qr/payment/verify", { input }, headers),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.providerReference, b.body.providerReference);
    // Exactamente una de las dos ejecutó; la otra es replay.
    const replays = [a, b].filter(
      (response) => response.body.idempotentReplay === true,
    );
    assert.equal(replays.length, 1, "una ejecutó y la otra reprodujo");
  });

  test("la misma clave en OTRA persona es otra operación", async () => {
    const input = { amount: 10, reference: "X" };
    const uno = await mock.post(
      "/mock/qr/payment/verify",
      { input },
      {
        ...run.headers,
        "x-mock-persona-key": "p-a",
        "x-idempotency-key": "SHARED",
      },
    );
    const dos = await mock.post(
      "/mock/qr/payment/verify",
      { input },
      {
        ...run.headers,
        "x-mock-persona-key": "p-b",
        "x-idempotency-key": "SHARED",
      },
    );
    assert.equal(
      dos.body.idempotentReplay,
      undefined,
      "no es un replay de otra persona",
    );
    assert.notEqual(uno.body.providerReference, dos.body.providerReference);
  });
});

describe("plan de fallos por corrida", () => {
  let mock;
  let run;
  before(async () => {
    mock = await startMock();
    run = await mock.createRun({ runId: "fallos" });
  });
  after(async () => mock.close());

  test("un plan inválido se rechaza al plantarlo, no a mitad de corrida", async () => {
    const response = await mock.post(
      `/mock/control/runs/${run.runId}/fault-plan`,
      { rules: [{ scenario: "no_existe", match: {} }] },
      run.control,
    );
    assert.equal(response.status, 405, "PUT es el método del plan");
  });

  test("PUT con escenario desconocido es 400 con el detalle", async () => {
    const response = await mock.call(
      `/mock/control/runs/${run.runId}/fault-plan`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...run.control },
        body: JSON.stringify({
          rules: [{ scenario: "no_existe", match: { provider: "segip" } }],
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_FAULT_PLAN");
    assert.ok(response.body.errors[0].includes("no_existe"));
  });

  test("dos reglas con el mismo criterio son ambigüedad, no precedencia por orden", async () => {
    const response = await mock.call(
      `/mock/control/runs/${run.runId}/fault-plan`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...run.control },
        body: JSON.stringify({
          rules: [
            { scenario: "provider_down", match: { provider: "segip" } },
            { scenario: "timeout", match: { provider: "segip" } },
          ],
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.ok(
      response.body.errors.some((error) => error.includes("ambigüedad")),
    );
  });

  test("las N primeras tentativas fallan y la siguiente responde: contador POR operación", async () => {
    const installed = await mock.call(
      `/mock/control/runs/${run.runId}/fault-plan`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...run.control },
        body: JSON.stringify({
          rules: [
            {
              id: "segip-2-primeros",
              scenario: "provider_down",
              match: { provider: "segip" },
              applyTo: { firstAttempts: 2 },
            },
          ],
        }),
      },
    );
    assert.equal(installed.status, 200);

    const headers = {
      ...run.headers,
      "x-mock-persona-key": "p-retry",
      "x-mock-logical-operation-id": "verificar-identidad",
    };
    const uno = await mock.post(
      "/mock/segip/identity/verify",
      { input: { documentNumber: "1" } },
      headers,
    );
    const dos = await mock.post(
      "/mock/segip/identity/verify",
      { input: { documentNumber: "1" } },
      headers,
    );
    const tres = await mock.post(
      "/mock/segip/identity/verify",
      { input: { documentNumber: "1" } },
      headers,
    );
    assert.equal(uno.status, 503);
    assert.equal(dos.status, 503);
    assert.equal(tres.status, 200, "el tercer intento se recupera");

    // Otra persona arranca su propio contador: no hereda los intentos de la primera.
    const otra = await mock.post(
      "/mock/segip/identity/verify",
      { input: { documentNumber: "2" } },
      {
        ...run.headers,
        "x-mock-persona-key": "p-otra",
        "x-mock-logical-operation-id": "verificar-identidad",
      },
    );
    assert.equal(
      otra.status,
      503,
      "el contador es por operación lógica de esa persona",
    );
  });

  test("la regla más específica gana sobre la más amplia", async () => {
    await mock.call(`/mock/control/runs/${run.runId}/fault-plan`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...run.control },
      body: JSON.stringify({
        rules: [
          {
            id: "amplia",
            scenario: "provider_down",
            match: { provider: "telco" },
          },
          {
            id: "fina",
            scenario: "fraud_signal_high",
            match: { provider: "telco", personaKey: "p-fina" },
          },
        ],
      }),
    });
    const amplia = await mock.post(
      "/mock/telco/phone-trust/check",
      { input: {} },
      { ...run.headers, "x-mock-persona-key": "p-cualquiera" },
    );
    const fina = await mock.post(
      "/mock/telco/phone-trust/check",
      { input: {} },
      { ...run.headers, "x-mock-persona-key": "p-fina" },
    );
    assert.equal(amplia.status, 503);
    assert.equal(fina.status, 200);
    assert.equal(fina.body.simSwapRiskLevel, "HIGH");
  });

  test("quitar el plan devuelve la corrida a su perfil", async () => {
    const removed = await mock.call(
      `/mock/control/runs/${run.runId}/fault-plan`,
      { method: "DELETE", headers: run.control },
    );
    assert.equal(removed.status, 200);
    const response = await mock.post(
      "/mock/telco/phone-trust/check",
      { input: {} },
      { ...run.headers, "x-mock-persona-key": "p-cualquiera" },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.simSwapRiskLevel, "LOW");
  });
});

describe("límites de memoria y evidencia", () => {
  let mock;
  after(async () => mock?.close());

  test("el journal no crece sin fin: descarta y lo CONTABILIZA", async () => {
    mock = await startMock({ MOCK_PROVIDERS_JOURNAL_MAX_ENTRIES: "10" });
    const run = await mock.createRun({ runId: "soak" });
    for (let i = 0; i < 25; i += 1) {
      await mock.post(
        "/mock/segip/identity/verify",
        { input: { documentNumber: String(i) } },
        { ...run.headers, "x-mock-persona-key": `p-${i}` },
      );
    }
    const journal = await mock.call(
      `/mock/control/runs/${run.runId}/journal?limit=100`,
      { headers: run.control },
    );
    assert.ok(journal.body.entries.length <= 10, "el buffer está acotado");
    assert.equal(journal.body.totalAppended, 25, "se sabe cuántas hubo");
    assert.ok(
      journal.body.droppedByRetention > 0,
      "la evidencia perdida se cuenta, no se disimula",
    );
  });

  test("el número de namespaces está acotado", async () => {
    const limited = await startMock({ MOCK_PROVIDERS_MAX_NAMESPACES: "2" });
    await limited.createRun({ runId: "n-1" });
    const second = await limited.post(
      "/mock/control/runs",
      { tenantId: "t-1", runId: "n-2" },
      { authorization: "Bearer token-de-control-de-pruebas" },
    );
    assert.equal(second.status, 429);
    assert.equal(second.body.error, "NAMESPACE_LIMIT_REACHED");
    await limited.close();
  });
});
