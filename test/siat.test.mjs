/**
 * Emulador SIAT: lo que valida de verdad, contra HTTP real.
 *
 * Cada caso negativo existe porque su contrario es el fallo caro: un emulador que acepta un CUF
 * mal calculado o un hash que no cuadra deja que el ERP llegue al piloto del SIN con esos errores.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { startMock } from "./helpers.mjs";
import { calcularCuf } from "../src/providers/siat/cuf.mjs";
import { escribirTar, leerTar } from "../src/providers/siat/tar.mjs";
import { ahoraBolivia } from "../src/providers/siat/registro.mjs";

const XML_OFICIAL = readFileSync(
  new URL(
    "./fixtures/siat/facturaComputarizadaCompraVenta.xml",
    import.meta.url,
  ),
  "utf8",
);
const NIT = "1003579028";
const TOKEN = { apikey: "TokenApi mock-token" };
const SISTEMA = {
  codigoAmbiente: 2,
  codigoSistema: "SISTEMA-DE-PRUEBA",
  nit: NIT,
  codigoSucursal: 0,
  codigoPuntoVenta: 0,
};

async function llamar(mock, operacion, input, { headers = {}, run } = {}) {
  const response = await mock.post(
    `/mock/siat${operacion}`,
    { input },
    { ...TOKEN, ...(run?.headers ?? {}), ...headers },
  );
  assert.equal(response.status, 200, response.text);
  return response.body;
}

async function credenciales(mock, run) {
  const cuis = await llamar(
    mock,
    "/codigos/cuis",
    { ...SISTEMA, codigoModalidad: 2 },
    { run },
  );
  const cufd = await llamar(
    mock,
    "/codigos/cufd",
    { ...SISTEMA, codigoModalidad: 2, cuis: cuis.codigo },
    { run },
  );
  return {
    cuis: cuis.codigo,
    cufd: cufd.codigo,
    codigoControl: cufd.codigoControl,
  };
}

/** La factura oficial del SIN con el CUFD del emulador, la hora de ahora y el CUF recalculado. */
function facturaOficial(
  { cufd, codigoControl },
  {
    numeroFactura = 1,
    fechaEmision = ahoraBolivia(),
    codigoEmision = 1,
    cuf,
    xml = XML_OFICIAL,
  } = {},
) {
  const calculado = calcularCuf({
    nit: NIT,
    fechaEmision,
    codigoSucursal: 0,
    codigoModalidad: 2,
    codigoEmision,
    tipoFacturaDocumento: 1,
    codigoDocumentoSector: 1,
    numeroFactura,
    codigoPuntoVenta: 0,
    codigoControl,
  });
  return xml
    .replace(/<cuf>[^<]*<\/cuf>/, `<cuf>${cuf ?? calculado}</cuf>`)
    .replace(/<cufd>[^<]*<\/cufd>/, `<cufd>${cufd}</cufd>`)
    .replace(/<numeroFactura>[^<]*</, `<numeroFactura>${numeroFactura}<`)
    .replace(/<fechaEmision>[^<]*</, `<fechaEmision>${fechaEmision}<`);
}

/** Tres líneas de 10 × 1 = 10 cada una; montoTotal 30. */
function conTresLineas(xml) {
  const linea = `<detalle><actividadEconomica>451010</actividadEconomica><codigoProductoSin>49111</codigoProductoSin><codigoProducto>P-1</codigoProducto><descripcion>SERVICIO</descripcion><cantidad>1</cantidad><unidadMedida>58</unidadMedida><precioUnitario>10</precioUnitario><montoDescuento>0</montoDescuento><subTotal>10</subTotal><numeroSerie xsi:nil="true"/><numeroImei xsi:nil="true"/></detalle>`;
  return xml
    .replace(/<detalle>[\s\S]*<\/detalle>/, linea.repeat(3))
    .replace(/<montoTotal>99</, "<montoTotal>30<")
    .replace(/<montoTotalSujetoIva>99</, "<montoTotalSujetoIva>30<")
    .replace(/<montoTotalMoneda>99</, "<montoTotalMoneda>30<")
    .replace(/<descuentoAdicional>1</, "<descuentoAdicional>0<");
}

function empaquetar(bytes) {
  const archivo = gzipSync(bytes);
  return {
    archivo: archivo.toString("base64"),
    hashArchivo: createHash("sha256").update(archivo).digest("hex"),
  };
}

function solicitud(creds, extra = {}) {
  return {
    ...SISTEMA,
    codigoDocumentoSector: 1,
    codigoEmision: 1,
    codigoModalidad: 2,
    tipoFacturaDocumento: 1,
    cuis: creds.cuis,
    cufd: creds.cufd,
    fechaEnvio: ahoraBolivia(),
    ...extra,
  };
}

function codigos(respuesta) {
  return (respuesta.mensajesList ?? []).map((m) => m.codigo);
}

describe("SIAT · CUF", () => {
  test("reproduce los tres vectores oficiales", () => {
    const base = {
      codigoSucursal: 0,
      codigoEmision: 1,
      tipoFacturaDocumento: 1,
      codigoDocumentoSector: 1,
      numeroFactura: 1,
      codigoPuntoVenta: 0,
    };
    assert.equal(
      calcularCuf({
        ...base,
        nit: "123456789",
        fechaEmision: "2019-01-13T16:37:21.231",
        codigoModalidad: 1,
        codigoControl: "A19E23EF34124CD",
      }),
      "8727F63A15F8976591FDDE5B387C5D015A29E06A1A19E23EF34124CD",
    );
    assert.equal(
      calcularCuf({
        ...base,
        nit: NIT,
        fechaEmision: "2021-10-07T09:01:24.178",
        codigoModalidad: 1,
        codigoControl: "67A75AC82F24C74",
      }),
      "44AAEC00DBD34C819B4D7AFD5F91900D3A059E06A467A75AC82F24C74",
    );
    assert.equal(
      calcularCuf({
        ...base,
        nit: NIT,
        fechaEmision: "2021-10-06T16:03:48.675",
        codigoModalidad: 2,
        codigoControl: "67A75AC82F24C74",
      }),
      "44AAEC00DBD34C53C3E2CCE1A3FA7AF1E2A08606A667A75AC82F24C74",
    );
  });

  test("el tar que escribe se vuelve a leer igual", () => {
    const tar = escribirTar([
      { nombre: "1.xml", contenido: "<a/>" },
      { nombre: "2.xml", contenido: "x".repeat(700) },
    ]);
    const leidos = leerTar(tar);
    assert.deepEqual(
      leidos.map((a) => a.nombre),
      ["1.xml", "2.xml"],
    );
    assert.equal(leidos[1].contenido.length, 700);
  });
});

describe("SIAT · códigos y catálogos", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("sin apikey responde 989, no un éxito", async () => {
    const respuesta = await llamar(
      mock,
      "/codigos/cuis",
      { ...SISTEMA, codigoModalidad: 2 },
      { headers: { apikey: "" } },
    );
    assert.equal(respuesta.transaccion, false);
    assert.deepEqual(codigos(respuesta), [989]);
  });

  test("verificarComunicacion responde 926", async () => {
    const respuesta = await llamar(mock, "/codigos/verificarComunicacion", {});
    assert.deepEqual(codigos(respuesta), [926]);
  });

  test("ambiente de producción → 910; el emulador es piloto", async () => {
    const respuesta = await llamar(mock, "/codigos/cuis", {
      ...SISTEMA,
      codigoAmbiente: 1,
      codigoModalidad: 2,
    });
    assert.deepEqual(codigos(respuesta), [910]);
  });

  test("un segundo CUIS vigente es 980 y trae el mismo código", async () => {
    const primero = await llamar(mock, "/codigos/cuis", {
      ...SISTEMA,
      nit: "555001",
      codigoModalidad: 2,
    });
    const segundo = await llamar(mock, "/codigos/cuis", {
      ...SISTEMA,
      nit: "555001",
      codigoModalidad: 2,
    });
    assert.equal(primero.transaccion, true);
    assert.deepEqual(codigos(segundo), [980]);
    assert.equal(segundo.codigo, primero.codigo);
  });

  test("CUFD sin CUIS conocido → 913", async () => {
    const respuesta = await llamar(mock, "/codigos/cufd", {
      ...SISTEMA,
      codigoModalidad: 2,
      cuis: "NOEXISTE",
    });
    assert.deepEqual(codigos(respuesta), [913]);
  });

  test("los catálogos llegan con la forma del WSDL y marcados de prueba", async () => {
    const creds = await credenciales(mock);
    const leyendas = await llamar(
      mock,
      "/sincronizacion/sincronizarListaLeyendasFactura",
      { ...SISTEMA, cuis: creds.cuis },
    );
    assert.ok(leyendas.listaLeyendas.length > 0);
    assert.equal(leyendas.catalogoDePrueba, true);
    const hora = await llamar(mock, "/sincronizacion/sincronizarFechaHora", {
      ...SISTEMA,
      cuis: creds.cuis,
    });
    assert.match(
      hora.fechaHora,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/,
    );
  });

  test("expone las 32 operaciones del SIN", async () => {
    const { body } = await mock.call("/mock/providers");
    const siat = body.providers.find((p) => p.code === "SIAT_SIN");
    assert.equal(siat.operations.length, 32);
  });
});

describe("SIAT · recepción de facturas", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("la factura oficial, con CUFD y CUF del emulador, se valida (908)", async () => {
    const creds = await credenciales(mock);
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(facturaOficial(creds))),
    );
    assert.equal(
      respuesta.codigoEstado,
      908,
      JSON.stringify(respuesta.mensajesList),
    );
    assert.ok(respuesta.codigoRecepcion);
  });

  test("hash que no corresponde al archivo → 969", async () => {
    const creds = await credenciales(mock);
    const paquete = empaquetar(facturaOficial(creds, { numeroFactura: 2 }));
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, { ...paquete, hashArchivo: "0".repeat(64) }),
    );
    assert.equal(respuesta.codigoEstado, 902);
    assert.deepEqual(codigos(respuesta), [969]);
  });

  test("el hash se compara sin distinguir mayúsculas", async () => {
    const creds = await credenciales(mock);
    const paquete = empaquetar(facturaOficial(creds, { numeroFactura: 3 }));
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, {
        ...paquete,
        hashArchivo: paquete.hashArchivo.toUpperCase(),
      }),
    );
    assert.equal(respuesta.codigoEstado, 908);
  });

  test("archivo que no es gzip → 920", async () => {
    const creds = await credenciales(mock);
    const plano = Buffer.from(facturaOficial(creds));
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, {
        archivo: plano.toString("base64"),
        hashArchivo: createHash("sha256").update(plano).digest("hex"),
      }),
    );
    assert.deepEqual(codigos(respuesta), [920]);
  });

  test("CUF alterado → 1002", async () => {
    const creds = await credenciales(mock);
    const xml = facturaOficial(creds, {
      numeroFactura: 4,
      cuf: "ABC123" + creds.codigoControl,
    });
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(xml)),
    );
    assert.equal(respuesta.codigoEstado, 902);
    assert.ok(codigos(respuesta).includes(1002));
  });

  test("CUFD del XML distinto del de la petición → 1003", async () => {
    const creds = await credenciales(mock);
    const otro = await credenciales(mock);
    const xml = facturaOficial(otro, { numeroFactura: 5 });
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(xml)),
    );
    assert.ok(codigos(respuesta).includes(1003));
  });

  test("total que no cuadra → 1013; subtotal que no cuadra → 1018", async () => {
    const creds = await credenciales(mock);
    const total = facturaOficial(creds, { numeroFactura: 6 }).replace(
      /<montoTotal>99</,
      "<montoTotal>98<",
    );
    const r1 = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(total)),
    );
    assert.deepEqual(codigos(r1), [1013]);
    const sub = facturaOficial(creds, { numeroFactura: 7 }).replace(
      /<subTotal>100</,
      "<subTotal>90<",
    );
    const r2 = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(sub)),
    );
    assert.deepEqual(codigos(r2), [1018]);
  });

  test("fechaEmision de hace una hora, en línea → 1009", async () => {
    const creds = await credenciales(mock);
    const xml = facturaOficial(creds, {
      numeroFactura: 8,
      fechaEmision: ahoraBolivia(Date.now() - 3_600_000),
    });
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(xml)),
    );
    assert.deepEqual(codigos(respuesta), [1009]);
  });

  test("XML sin un obligatorio → 939", async () => {
    const creds = await credenciales(mock);
    const xml = facturaOficial(creds, { numeroFactura: 9 }).replace(
      /<leyenda>[\s\S]*?<\/leyenda>/,
      "",
    );
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(xml)),
    );
    assert.deepEqual(codigos(respuesta), [939]);
  });

  test("el mismo CUF otra vez → 952", async () => {
    const creds = await credenciales(mock);
    const paquete = empaquetar(facturaOficial(creds, { numeroFactura: 10 }));
    const primero = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, paquete),
    );
    const segundo = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, paquete),
    );
    assert.equal(primero.codigoEstado, 908);
    assert.ok(codigos(segundo).includes(952));
  });

  test("sector 2 en el servicio de compra-venta → 932", async () => {
    const creds = await credenciales(mock);
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, {
        ...empaquetar(facturaOficial(creds, { numeroFactura: 11 })),
        codigoDocumentoSector: 2,
      }),
    );
    assert.deepEqual(codigos(respuesta), [932]);
  });

  test("anular: 905, y otra vez 936; verificar el estado da 905", async () => {
    const creds = await credenciales(mock);
    const xml = facturaOficial(creds, { numeroFactura: 12 });
    const cuf = /<cuf>([^<]+)</.exec(xml)[1];
    await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(xml)),
    );
    const anular = () =>
      llamar(
        mock,
        "/compra-venta/anulacionFactura",
        solicitud(creds, { cuf, codigoMotivo: 1 }),
      );
    assert.equal((await anular()).codigoEstado, 905);
    const repetida = await anular();
    assert.equal(repetida.codigoEstado, 906);
    assert.deepEqual(codigos(repetida), [936]);
    const estado = await llamar(
      mock,
      "/compra-venta/verificacionEstadoFactura",
      solicitud(creds, { cuf }),
    );
    assert.equal(estado.codigoEstado, 905);
  });

  test("anular con un motivo que no existe → 925", async () => {
    const creds = await credenciales(mock);
    const respuesta = await llamar(
      mock,
      "/compra-venta/anulacionFactura",
      solicitud(creds, { cuf: "X", codigoMotivo: 99 }),
    );
    assert.deepEqual(codigos(respuesta), [925]);
  });
});

describe("SIAT · escenarios", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("duplicate_request: 952, y la verificación adopta 908", async () => {
    const creds = await credenciales(mock);
    const xml = facturaOficial(creds, { numeroFactura: 20 });
    const cuf = /<cuf>([^<]+)</.exec(xml)[1];
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(creds, empaquetar(xml)),
      {
        headers: { "x-mock-scenario": "duplicate_request" },
      },
    );
    assert.deepEqual(codigos(respuesta), [952]);
    const estado = await llamar(
      mock,
      "/compra-venta/verificacionEstadoFactura",
      solicitud(creds, { cuf }),
    );
    assert.equal(estado.codigoEstado, 908);
  });

  test("partial_match: observada (904) con 1013", async () => {
    const creds = await credenciales(mock);
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(
        creds,
        empaquetar(facturaOficial(creds, { numeroFactura: 21 })),
      ),
      { headers: { "x-mock-scenario": "partial_match" } },
    );
    assert.equal(respuesta.codigoEstado, 904);
    assert.deepEqual(codigos(respuesta), [1013]);
  });

  test("un escenario que la operación no representa se declara no aplicado", async () => {
    const respuesta = await llamar(
      mock,
      "/codigos/verificarComunicacion",
      {},
      {
        headers: { "x-mock-scenario": "partial_match" },
      },
    );
    assert.equal(respuesta.escenario.aplicado, false);
  });

  test("expired_token: CUFD no vigente (953)", async () => {
    const creds = await credenciales(mock);
    const respuesta = await llamar(
      mock,
      "/compra-venta/recepcionFactura",
      solicitud(
        creds,
        empaquetar(facturaOficial(creds, { numeroFactura: 22 })),
      ),
      { headers: { "x-mock-scenario": "expired_token" } },
    );
    assert.deepEqual(codigos(respuesta), [953]);
  });
});

describe("SIAT · contingencia y paquetes", () => {
  let mock;
  // 500 facturas de 3 líneas pesan ~100 KB en base64: por encima de los 64 KiB por defecto.
  before(
    async () =>
      (mock = await startMock({
        MOCK_PROVIDERS_MAX_BODY_BYTES: String(2 * 1024 * 1024),
      })),
  );
  after(async () => mock.close());

  async function eventoAbierto(creds) {
    const nuevo = await credenciales(mock);
    const ahora = Date.now();
    const evento = await llamar(
      mock,
      "/operaciones/registroEventoSignificativo",
      {
        ...SISTEMA,
        cuis: creds.cuis,
        cufd: nuevo.cufd,
        cufdEvento: creds.cufd,
        codigoMotivoEvento: 2,
        descripcion: "INACCESIBILIDAD AL SERVICIO WEB",
        fechaHoraInicioEvento: ahoraBolivia(ahora - 600_000),
        fechaHoraFinEvento: ahoraBolivia(ahora - 1_000),
      },
    );
    assert.equal(evento.transaccion, true, JSON.stringify(evento.mensajesList));
    return {
      nuevo,
      codigoEvento: evento.codigoRecepcionEventoSignificativo,
      ahora,
    };
  }

  test("paquete tar+gz de 500 facturas de 3 líneas: 901 → 901 → 908", async () => {
    const creds = await credenciales(mock);
    const { nuevo, codigoEvento, ahora } = await eventoAbierto(creds);
    const archivos = Array.from({ length: 500 }, (_, i) => ({
      nombre: `${i + 1}.xml`,
      contenido: facturaOficial(creds, {
        numeroFactura: i + 1,
        codigoEmision: 2,
        fechaEmision: ahoraBolivia(ahora - 300_000),
        xml: conTresLineas(XML_OFICIAL),
      }),
    }));
    const base = solicitud(nuevo, { cuis: creds.cuis, codigoEmision: 2 });
    const recibido = await llamar(
      mock,
      "/compra-venta/recepcionPaqueteFactura",
      {
        ...base,
        ...empaquetar(escribirTar(archivos)),
        cantidadFacturas: 500,
        codigoEvento,
      },
    );
    assert.equal(
      recibido.codigoEstado,
      901,
      JSON.stringify(recibido.mensajesList),
    );
    const validar = () =>
      llamar(mock, "/compra-venta/validacionRecepcionPaqueteFactura", {
        ...base,
        codigoRecepcion: recibido.codigoRecepcion,
      });
    assert.equal((await validar()).codigoEstado, 901);
    const final = await validar();
    assert.equal(
      final.codigoEstado,
      908,
      JSON.stringify(final.mensajesList.slice(0, 3)),
    );
  });

  test("XML concatenados sin tar → 920; cantidad declarada distinta → 985", async () => {
    const creds = await credenciales(mock);
    const { nuevo, codigoEvento, ahora } = await eventoAbierto(creds);
    const xml = (n) =>
      facturaOficial(creds, {
        numeroFactura: n,
        codigoEmision: 2,
        fechaEmision: ahoraBolivia(ahora - 300_000),
      });
    const base = {
      ...solicitud(nuevo, { cuis: creds.cuis, codigoEmision: 2 }),
      codigoEvento,
    };
    const concatenado = await llamar(
      mock,
      "/compra-venta/recepcionPaqueteFactura",
      {
        ...base,
        ...empaquetar(Buffer.from(xml(1) + xml(2))),
        cantidadFacturas: 2,
      },
    );
    assert.deepEqual(codigos(concatenado), [920]);
    const tar = escribirTar([
      { nombre: "1.xml", contenido: xml(1) },
      { nombre: "2.xml", contenido: xml(2) },
    ]);
    const mal = await llamar(mock, "/compra-venta/recepcionPaqueteFactura", {
      ...base,
      ...empaquetar(tar),
      cantidadFacturas: 3,
    });
    assert.deepEqual(codigos(mal), [985]);
  });

  test("una factura del paquete con el CUFD de otro evento sale con su numeroArchivo", async () => {
    const creds = await credenciales(mock);
    const { nuevo, codigoEvento, ahora } = await eventoAbierto(creds);
    const fecha = ahoraBolivia(ahora - 300_000);
    const tar = escribirTar([
      {
        nombre: "1.xml",
        contenido: facturaOficial(creds, {
          numeroFactura: 1,
          codigoEmision: 2,
          fechaEmision: fecha,
        }),
      },
      {
        nombre: "2.xml",
        contenido: facturaOficial(nuevo, {
          numeroFactura: 2,
          codigoEmision: 2,
          fechaEmision: fecha,
        }),
      },
    ]);
    const base = solicitud(nuevo, { cuis: creds.cuis, codigoEmision: 2 });
    const recibido = await llamar(
      mock,
      "/compra-venta/recepcionPaqueteFactura",
      {
        ...base,
        ...empaquetar(tar),
        cantidadFacturas: 2,
        codigoEvento,
      },
    );
    const validar = () =>
      llamar(mock, "/compra-venta/validacionRecepcionPaqueteFactura", {
        ...base,
        codigoRecepcion: recibido.codigoRecepcion,
      });
    await validar();
    const final = await validar();
    assert.equal(final.codigoEstado, 904);
    const errores = final.mensajesList.filter((m) => !m.advertencia);
    assert.deepEqual(
      errores.map((m) => [m.codigo, m.numeroArchivo]),
      [[1006, 1]],
    );
  });
});

describe("SIAT · aislamiento por corrida", () => {
  let mock;
  before(async () => (mock = await startMock()));
  after(async () => mock.close());

  test("el CUIS de una corrida no existe en otra, y el reset de la corrida lo borra", async () => {
    const a = await mock.createRun({ runId: "siat-a" });
    const b = await mock.createRun({ runId: "siat-b" });
    const creds = await credenciales(mock, a);
    const enB = await llamar(
      mock,
      "/codigos/cufd",
      { ...SISTEMA, codigoModalidad: 2, cuis: creds.cuis },
      { run: b },
    );
    assert.deepEqual(codigos(enB), [913]);
    const reset = await mock.post(
      "/mock/control/runs/siat-a/reset",
      {},
      a.control,
    );
    assert.equal(reset.status, 200, reset.text);
    const trasReset = await llamar(
      mock,
      "/codigos/cufd",
      { ...SISTEMA, codigoModalidad: 2, cuis: creds.cuis },
      { run: a },
    );
    assert.deepEqual(codigos(trasReset), [913]);
  });
});
