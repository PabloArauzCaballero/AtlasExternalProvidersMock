import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startMock, CONTROL_TOKEN } from "./helpers.mjs";
import {
  cedulaDe,
  clearIdentityImagesCache,
  validateIdentityImagesInput,
} from "../src/domain/identity-images.mjs";
import { construirMrzTd1 } from "../src/domain/identity-card.mjs";

const PATH = "/mock/qa/identity-images";
const CONTROL = {
  authorization: `Bearer ${CONTROL_TOKEN}`,
  "x-mock-tenant-id": "t-1",
};
const MARIELA = {
  personaKey: "qa-persona-1",
  firstName: "Mariela",
  lastName: "Quispe Mamani",
  documentNumber: "90123456",
  birthDate: "1990-04-12",
  sex: "F",
  city: "La Paz",
};
const KINDS = ["identity_front", "identity_back", "selfie"];

describe("POST /mock/qa/identity-images", () => {
  let mock;
  before(async () => {
    mock = await startMock();
  });
  after(async () => {
    await mock.close();
  });

  it("503 si el plano de control está apagado", async () => {
    const off = await startMock({ MOCK_PROVIDERS_CONTROL_TOKEN: "" });
    try {
      const response = await off.post(PATH, MARIELA, CONTROL);
      assert.equal(response.status, 503);
      assert.equal(response.body.error, "CONTROL_PLANE_DISABLED");
    } finally {
      await off.close();
    }
  });

  it("401 sin token o con token equivocado", async () => {
    const sinToken = await mock.post(PATH, MARIELA, {
      "x-mock-tenant-id": "t-1",
    });
    assert.equal(sinToken.status, 401);
    const otro = await mock.post(PATH, MARIELA, {
      ...CONTROL,
      authorization: "Bearer otro-token-cualquiera-123",
    });
    assert.equal(otro.status, 401);
    assert.equal(otro.body.error, "CONTROL_UNAUTHORIZED");
  });

  it("400 TENANT_REQUIRED sin x-mock-tenant-id", async () => {
    const response = await mock.post(PATH, MARIELA, {
      authorization: CONTROL.authorization,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "TENANT_REQUIRED");
  });

  it("400 INVALID_INPUT con un mensaje por campo", async () => {
    const response = await mock.post(
      PATH,
      {
        personaKey: "p",
        firstName: "",
        lastName: "R0jas",
        documentNumber: "abc",
        birthDate: "1990-02-30",
        sex: "X",
      },
      CONTROL,
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_INPUT");
    const errors = response.body.errors.join(" ");
    for (const campo of [
      "firstName",
      "lastName",
      "documentNumber",
      "birthDate",
      "sex",
    ])
      assert.match(errors, new RegExp(campo));
  });

  it("devuelve tres JPEG válidos con su huella y tamaño", async () => {
    const response = await mock.post(PATH, MARIELA, CONTROL);
    assert.equal(response.status, 200);
    assert.equal(response.body.version, "identity-images@mock-1");
    assert.deepEqual(
      Object.keys(response.body.images).sort(),
      [...KINDS].sort(),
    );
    for (const kind of KINDS) {
      const image = response.body.images[kind];
      const bytes = Buffer.from(image.base64, "base64");
      assert.equal(image.contentType, "image/jpeg");
      assert.equal(image.bytes, bytes.length);
      assert.equal(bytes[0], 0xff, `${kind}: cabecera JPEG`);
      assert.equal(bytes[1], 0xd8, `${kind}: cabecera JPEG`);
      assert.equal(
        image.sha256,
        createHash("sha256").update(bytes).digest("hex"),
      );
      assert.ok(image.bytes > 20_000, `${kind}: ${image.bytes} bytes`);
      assert.ok(image.bytes < 400_000, `${kind}: ${image.bytes} bytes`);
    }
    const huellas = new Set(KINDS.map((k) => response.body.images[k].sha256));
    assert.equal(huellas.size, 3, "tres imágenes distintas");
  });

  it("es determinista: mismos datos, mismos bytes", async () => {
    const primera = await mock.post(PATH, MARIELA, CONTROL);
    // Sin caché: la igualdad tiene que salir de volver a dibujar, no de recordar.
    clearIdentityImagesCache();
    const segunda = await mock.post(PATH, MARIELA, CONTROL);
    for (const kind of KINDS)
      assert.equal(
        segunda.body.images[kind].base64,
        primera.body.images[kind].base64,
        kind,
      );
  });

  it("otra persona produce otro documento y otra cara", async () => {
    const a = await mock.post(PATH, MARIELA, CONTROL);
    const b = await mock.post(
      PATH,
      { ...MARIELA, documentNumber: "7654321", firstName: "Juan" },
      CONTROL,
    );
    for (const kind of KINDS)
      assert.notEqual(b.body.images[kind].sha256, a.body.images[kind].sha256);
  });
});

describe("datos derivados de la cédula", () => {
  it("fechas coherentes: expiración a diez años y futura", () => {
    const datos = cedulaDe(validateIdentityImagesInput(MARIELA).value);
    assert.equal(datos.nacimiento, "12/04/1990");
    assert.equal(datos.nombres, "MARIELA");
    assert.equal(datos.apellidos, "QUISPE MAMANI");
    assert.equal(datos.lugarNacimiento, "LA PAZ-MURILLO-LA PAZ");
    assert.ok(new Date(datos.expiracionIso) > new Date());
    assert.ok(datos.rostro >= 1 && datos.rostro <= 100_000);
    assert.ok(datos.variante >= 1 && datos.variante <= 5);
  });

  it("sexo derivado si no viene, y estable", () => {
    const { sex: _omit, ...sinSexo } = MARIELA;
    const input = validateIdentityImagesInput(sinSexo).value;
    const sexo = cedulaDe(input).sexo;
    assert.ok(sexo === "M" || sexo === "F");
    assert.equal(cedulaDe(input).sexo, sexo);
  });

  it("nombres con tilde y eñe salen en ASCII y la MRZ tiene 3×30", () => {
    const datos = cedulaDe(
      validateIdentityImagesInput({
        ...MARIELA,
        firstName: "José Ñandú",
        lastName: "Peña Ávila",
      }).value,
    );
    assert.equal(datos.nombres, "JOSE NANDU");
    assert.equal(datos.apellidos, "PENA AVILA");
    const mrz = construirMrzTd1(datos);
    assert.equal(mrz.length, 3);
    for (const line of mrz) assert.match(line, /^[A-Z0-9<]{30}$/);
    assert.match(mrz[0], /^IDBOL90123456<\d/);
  });

  it("una persona nacida después de la ventana se emite tras nacer", () => {
    const datos = cedulaDe(
      validateIdentityImagesInput({ ...MARIELA, birthDate: "2026-06-01" })
        .value,
    );
    assert.ok(new Date(datos.expiracionIso) > new Date("2036-06-01"));
  });
});
