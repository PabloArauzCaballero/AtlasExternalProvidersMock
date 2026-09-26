import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock } from "./helpers.mjs";
import { FAKER_TYPES } from "../src/fakers/generators.mjs";

describe("fakers de QA", () => {
  let mock;
  before(async () => {
    mock = await startMock();
  });
  after(async () => {
    await mock.close();
  });

  it("el catálogo publica cada tipo con sus parámetros y sin la función generadora", async () => {
    const { status, body } = await mock.call("/mock/fakers");
    assert.equal(status, 200);
    assert.equal(body.types.length, FAKER_TYPES.length);
    const persona = body.types.find((entry) => entry.type === "persona");
    assert.ok(
      persona.params.some(
        (param) => param.name === "edadMin" && param.default === 18,
      ),
    );
    assert.equal(persona.generate, undefined);
    assert.deepEqual(
      body.variants.map((variant) => variant.value),
      ["valido", "frontera", "invalido"],
    );
  });

  it("la misma semilla da exactamente el mismo lote, y otra semilla otro", async () => {
    const first = await mock.post("/mock/fakers/persona", {
      seed: "qa-regresion",
      count: 5,
    });
    const again = await mock.post("/mock/fakers/persona", {
      seed: "qa-regresion",
      count: 5,
    });
    const other = await mock.post("/mock/fakers/persona", {
      seed: "qa-frontera",
      count: 5,
    });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items, again.body.items);
    assert.notDeepEqual(first.body.items, other.body.items);
  });

  it("ampliar el lote no reescribe los primeros elementos", async () => {
    const small = await mock.post("/mock/fakers/caso", { seed: "s", count: 3 });
    const big = await mock.post("/mock/fakers/caso", { seed: "s", count: 30 });
    assert.deepEqual(big.body.items.slice(0, 3), small.body.items);
  });

  it("dentro de un lote los correos y teléfonos no se repiten", async () => {
    const { body } = await mock.post("/mock/fakers/persona", {
      seed: "unicos",
      count: 200,
    });
    assert.equal(new Set(body.items.map((item) => item.email)).size, 200);
    assert.ok(new Set(body.items.map((item) => item.phone)).size > 190);
  });

  it("respeta los parámetros: edad, departamento y dominio", async () => {
    const { body } = await mock.post("/mock/fakers/persona", {
      seed: "p",
      count: 50,
      params: {
        edadMin: 30,
        edadMax: 35,
        departamento: "SC",
        dominioCorreo: "ejemplo.test",
      },
    });
    for (const item of body.items) {
      assert.ok(item.age >= 30 && item.age <= 35, `edad ${item.age}`);
      assert.equal(item.documentExtension, "SC");
      assert.equal(item.city, "Santa Cruz de la Sierra");
      assert.match(item.email, /@ejemplo\.test$/);
      assert.match(item.phone, /^\+591(6999|7999|7998)\d{4}$/);
      assert.match(item.birthDate, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("la edad declarada cuadra con la fecha de nacimiento en la fecha de referencia", async () => {
    const { body } = await mock.post("/mock/fakers/persona", {
      seed: "edad",
      count: 100,
    });
    for (const item of body.items) {
      const birth = new Date(`${item.birthDate}T00:00:00Z`);
      const ref = new Date(`${body.referenceDate}T00:00:00Z`);
      let age = ref.getUTCFullYear() - birth.getUTCFullYear();
      const beforeBirthday =
        ref.getUTCMonth() < birth.getUTCMonth() ||
        (ref.getUTCMonth() === birth.getUTCMonth() &&
          ref.getUTCDate() < birth.getUTCDate());
      if (beforeBirthday) age -= 1;
      assert.equal(
        age,
        item.age,
        `${item.birthDate} → ${age}, declarado ${item.age}`,
      );
    }
  });

  it("la variante frontera pega la edad al mínimo o al máximo", async () => {
    const { body } = await mock.post("/mock/fakers/persona", {
      seed: "f",
      count: 20,
      variant: "frontera",
      params: { edadMin: 18, edadMax: 70 },
    });
    for (const item of body.items)
      assert.ok(item.age === 18 || item.age === 70);
  });

  it("la variante inválida rompe una regla y dice cuál", async () => {
    const { body } = await mock.post("/mock/fakers/persona", {
      seed: "i",
      count: 20,
      variant: "invalido",
    });
    for (const item of body.items) {
      assert.ok(item._invalid?.field, "falta _invalid.field");
      assert.ok(item._invalid.reason.length > 0);
    }
  });

  it("todos los tipos generan con sus valores por defecto y en las tres variantes", async () => {
    for (const entry of FAKER_TYPES) {
      for (const variant of ["valido", "frontera", "invalido"]) {
        const { status, body } = await mock.post(`/mock/fakers/${entry.type}`, {
          seed: "todos",
          count: 3,
          variant,
        });
        assert.equal(
          status,
          200,
          `${entry.type}/${variant}: ${JSON.stringify(body)}`,
        );
        assert.equal(body.items.length, 3);
        for (const field of entry.fields)
          assert.ok(field in body.items[0], `${entry.type} sin ${field}`);
      }
    }
  });

  it("el caso completo es coherente: la cuenta está a nombre de la persona", async () => {
    const { body } = await mock.post("/mock/fakers/caso", {
      seed: "c",
      count: 10,
    });
    for (const item of body.items) {
      assert.equal(item.cuentaBancaria.holderName, item.persona.fullName);
      assert.equal(item.persona.city, item.direccion.city);
    }
  });

  it("GET con query string equivale al POST", async () => {
    const viaGet = await mock.call(
      "/mock/fakers/monto?seed=q&count=4&minimo=10&maximo=20&moneda=USD",
    );
    const viaPost = await mock.post("/mock/fakers/monto", {
      seed: "q",
      count: 4,
      params: { minimo: 10, maximo: 20, moneda: "USD" },
    });
    assert.equal(viaGet.status, 200);
    assert.deepEqual(viaGet.body.items, viaPost.body.items);
    for (const item of viaGet.body.items)
      assert.ok(
        item.amount >= 10 && item.amount <= 20 && item.currency === "USD",
      );
  });

  it("rechaza con 422 y TODOS los errores a la vez", async () => {
    const { status, body } = await mock.post("/mock/fakers/persona", {
      count: 999,
      variant: "raro",
      params: { edadMin: 50, edadMax: 20, inventado: 1 },
    });
    assert.equal(status, 422);
    assert.equal(body.error, "INVALID_FAKER_PARAMS");
    const params = body.errors.map((error) => error.param).sort();
    assert.deepEqual(params, ["count", "edadMax", "inventado", "variant"]);
  });

  it("un tipo inexistente es 404 con la lista de tipos", async () => {
    const { status, body } = await mock.post("/mock/fakers/marciano", {});
    assert.equal(status, 404);
    assert.equal(body.error, "UNKNOWN_FAKER");
    assert.match(body.detail, /persona/);
  });
});
