/**
 * El buzón QA es abierto en la ENTRADA y autenticado en la LECTURA, y el README lo dice. Estas
 * pruebas fijan ambas mitades por HTTP (lo que hasta ahora sólo cubría `createInbox` en memoria) y
 * comprueban que los límites que el README cita son los del código.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTROL_TOKEN, startMock } from "./helpers.mjs";
import { MAX_MESSAGES, TTL_MS } from "../src/control/inbox.mjs";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const bearer = { authorization: `Bearer ${CONTROL_TOKEN}` };

describe("buzón QA por HTTP", () => {
  let mock;
  before(async () => {
    mock = await startMock({ MOCK_PROVIDERS_MAX_BODY_BYTES: "1024" });
  });
  after(() => mock.close());

  it("la entrada NO pide token (202) y la lectura sí", async () => {
    const put = await mock.post("/mock/inbox/email", {
      to: "Ana@Example.test",
      subject: "Factura",
      body: "hola",
    });
    assert.equal(put.status, 202);
    assert.match(put.body.id, /^qa-inbox-\d+$/);

    const anonymous = await mock.call("/mock/control/inbox");
    assert.equal(anonymous.status, 401);
    const wrong = await mock.call("/mock/control/inbox", {
      headers: { authorization: "Bearer otro-token-cualquiera" },
    });
    assert.equal(wrong.status, 401);

    const read = await mock.call("/mock/control/inbox?to=ana@example.test", {
      headers: bearer,
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.messages[0].subject, "Factura");
  });

  it("un canal desconocido es 404 y un cuerpo mayor que el máximo es 413", async () => {
    const unknown = await mock.post("/mock/inbox/fax", { to: "x", body: "y" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, "UNKNOWN_CHANNEL");
    const big = await mock.post("/mock/inbox/sms", {
      to: "x",
      body: "z".repeat(3000),
    });
    assert.equal(big.status, 413);
  });

  it("recorta asunto y texto a los límites documentados", async () => {
    await mock.post("/mock/inbox/whatsapp", {
      to: "+59170000001",
      subject: "s".repeat(400),
      body: "b".repeat(100),
    });
    const read = await mock.call("/mock/control/inbox?to=%2B59170000001", {
      headers: bearer,
    });
    assert.equal(read.body.messages[0].subject.length, 300);
  });
});

describe("README y buzón QA", () => {
  it("documenta la entrada abierta en «Quién puede hablar con el emulador»", () => {
    const section =
      readme.split("## Quién puede hablar con el emulador")[1] ?? "";
    assert.match(section, /`POST \/mock\/inbox\/:channel`/);
    assert.match(section, /no pide token/i);
    assert.match(section, /`GET \/mock\/control\/inbox`/);
  });

  it("los límites que cita el README son los del código", () => {
    assert.equal(
      MAX_MESSAGES,
      5_000,
      "actualiza «unos 5.000 mensajes» en el README",
    );
    assert.equal(
      TTL_MS,
      60 * 60_000,
      "actualiza «60 minutos de vida» en el README",
    );
    assert.match(
      readme,
      /unos 5\.000 mensajes en memoria y 60 minutos de vida/,
    );
    assert.match(readme, /asunto de 300 y texto de 8\.000 caracteres/);
  });

  it("dice la verdad del HEALTHCHECK: compara el SHA sólo si APP_COMMIT_SHA existe", () => {
    const smoke = readFileSync(
      new URL("../scripts/post-deploy-smoke.mjs", import.meta.url),
      "utf8",
    );
    assert.match(
      smoke,
      /if \(sha &&/,
      "el smoke dejó de comparar el SHA sólo si existe",
    );
    assert.match(readme, /sólo si `APP_COMMIT_SHA` está definido/);
    assert.doesNotMatch(readme, /compara el SHA servido con\s+`SOURCE_COMMIT`/);
  });

  it("dice que el compose nombra 3 de las 13 variables MOCK_PROVIDERS_*", () => {
    const names = new Set();
    for (const file of [
      "src/config.mjs",
      "src/app.mjs",
      "src/http/access.mjs",
      "scripts/post-deploy-smoke.mjs",
    ]) {
      let text = "";
      try {
        text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      } catch {
        continue;
      }
      for (const m of text.matchAll(/MOCK_PROVIDERS_[A-Z_]+/g)) names.add(m[0]);
    }
    const example = readFileSync(
      new URL("../.env.example", import.meta.url),
      "utf8",
    );
    for (const name of names)
      assert.ok(example.includes(name), `${name} falta en .env.example`);
    assert.equal(
      names.size,
      13,
      "cambió el número de variables: actualiza «3 de las 13» en el README",
    );
    assert.match(readme, /sólo 3 de las 13 variables `MOCK_PROVIDERS_\*`/);
  });
});
