/**
 * Imágenes de identidad de una persona QA: anverso y reverso de su cédula sintética y su selfie,
 * dibujados con SUS datos.
 *
 * Para qué: las corridas de N personas de AtlasBackend (`qa-orchestration`) subían a todas la misma
 * imagen genérica, y el OCR del Motor no encontraba ni un rótulo. Aquí cada persona recibe un
 * documento que el Motor sabe leer (mismo diseño contra el que calibró) y una selfie de la MISMA
 * cara en otra toma.
 *
 * Determinista: sin reloj, sin `Math.random`. Lo que no vino en la petición se deriva por hash del
 * número de documento, así que la misma persona recibe los mismos bytes en cada corrida.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { fnv1a } from "./derive.mjs";
import {
  renderCedula,
  renderCedulaReverso,
  renderSelfie,
} from "./identity-card.mjs";

/*
 * Memoria, no velocidad: el contenedor tiene un tope y cada persona es un dibujo distinto, así que
 * la caché de operaciones de libvips no reutiliza nada y sólo retiene memoria nativa. Con un hilo
 * por operación el RSS medido tras diez personas bajó de 267 a 220 MB, a costa de ~15 % de tiempo
 * (≈0,45 s por persona).
 */
sharp.cache(false);
sharp.concurrency(1);

export const IDENTITY_IMAGES_VERSION = "identity-images@mock-1";

const JPEG_QUALITY = 85;

const NOMBRE = /^[\p{L}][\p{L} '.-]*$/u;
const DOCUMENTO = /^[0-9]{4,10}(-?[0-9][A-Z])?$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Lugares de nacimiento en el formato del reverso (DEPARTAMENTO-PROVINCIA-LOCALIDAD). La clave es
 * como la suele mandar el consumidor; si manda otra ciudad se imprime tal cual.
 */
const LUGARES = {
  "LA PAZ": "LA PAZ-MURILLO-LA PAZ",
  "EL ALTO": "LA PAZ-MURILLO-EL ALTO",
  "SANTA CRUZ": "SANTA CRUZ-ANDRES IBANEZ-SANTA CRUZ DE LA SIERRA",
  "SANTA CRUZ DE LA SIERRA": "SANTA CRUZ-ANDRES IBANEZ-SANTA CRUZ DE LA SIERRA",
  COCHABAMBA: "COCHABAMBA-CERCADO-COCHABAMBA",
  ORURO: "ORURO-CERCADO-ORURO",
  SUCRE: "CHUQUISACA-OROPEZA-SUCRE",
  POTOSI: "POTOSI-TOMAS FRIAS-POTOSI",
  TARIJA: "TARIJA-CERCADO-TARIJA",
  TRINIDAD: "BENI-CERCADO-TRINIDAD",
  COBIJA: "PANDO-NICOLAS SUAREZ-COBIJA",
};
const CIUDADES = Object.keys(LUGARES).filter(
  (c) => c !== "SANTA CRUZ DE LA SIERRA",
);
const CALLES = [
  "AV. 6 DE AGOSTO",
  "C. SANCHEZ LIMA",
  "AV. BANZER",
  "C. JORDAN",
  "AV. AMERICA",
  "C. BOLIVAR",
  "AV. BUSCH",
  "C. SUCRE",
];
const ZONAS = [
  "SOPOCACHI",
  "MIRAFLORES",
  "EQUIPETROL",
  "CALA CALA",
  "SAN PEDRO",
  "VILLA FATIMA",
  "CENTRAL",
  "ACHUMANI",
];
/** Sin género gramatical: la profesión no puede contradecir el sexo que va en la MRZ. */
const PROFESIONES = [
  "ESTUDIANTE",
  "COMERCIANTE",
  "DOCENTE",
  "ECONOMISTA",
  "TRANSPORTISTA",
  "PERIODISTA",
  "DENTISTA",
  "AGENTE DE VENTAS",
];
const GRUPOS = ["O RH +", "O RH +", "A RH +", "B RH +", "AB RH +", "O RH -"];

/** Mayúsculas y sin diacríticos: lo que el Motor calibró (ASCII) y lo único que admite la MRZ. */
function ascii(texto) {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fechaValida(texto) {
  const m = FECHA.exec(texto);
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1) return null;
  if (d.getUTCDate() !== dia) return null;
  return d;
}

/**
 * Valida el cuerpo. Devuelve `{ ok: true, value }` o `{ ok: false, errors }` con un mensaje por
 * campo: quien llama es un motor de corridas y el mensaje es lo único que ve en su informe.
 */
export function validateIdentityImagesInput(payload) {
  const errors = [];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return { ok: false, errors: ["El cuerpo tiene que ser un objeto JSON."] };

  const texto = (campo, max) => {
    const v = payload[campo];
    if (typeof v !== "string" || v.trim() === "") {
      errors.push(`\`${campo}\` es obligatorio y tiene que ser texto.`);
      return "";
    }
    if (v.trim().length > max)
      errors.push(`\`${campo}\` no puede superar ${max} caracteres.`);
    return v.trim();
  };

  const personaKey = texto("personaKey", 200);
  const firstName = texto("firstName", 60);
  const lastName = texto("lastName", 60);
  if (firstName && !NOMBRE.test(firstName))
    errors.push(
      "`firstName` sólo admite letras, espacios, apóstrofo, punto y guion.",
    );
  if (lastName && !NOMBRE.test(lastName))
    errors.push(
      "`lastName` sólo admite letras, espacios, apóstrofo, punto y guion.",
    );

  const documentNumber = texto("documentNumber", 13).toUpperCase();
  if (documentNumber && !DOCUMENTO.test(documentNumber))
    errors.push(
      "`documentNumber` tiene que ser de 4 a 10 dígitos, con complemento opcional (p. ej. 1234567-1A).",
    );

  const birthDateText = texto("birthDate", 10);
  const birth = birthDateText ? fechaValida(birthDateText) : null;
  if (birthDateText && birth === null)
    errors.push(
      "`birthDate` tiene que ser una fecha real en formato YYYY-MM-DD.",
    );
  else if (birth && (birth.getUTCFullYear() < 1900 || birth > new Date()))
    errors.push("`birthDate` tiene que estar entre 1900 y hoy.");

  let sex = null;
  if (payload.sex !== undefined && payload.sex !== null) {
    if (payload.sex !== "M" && payload.sex !== "F")
      errors.push('`sex` sólo admite "M" o "F".');
    else sex = payload.sex;
  }

  let city = null;
  if (payload.city !== undefined && payload.city !== null) {
    if (typeof payload.city !== "string" || payload.city.trim().length > 60)
      errors.push("`city` tiene que ser texto de hasta 60 caracteres.");
    else if (payload.city.trim() !== "") city = payload.city.trim();
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      personaKey,
      firstName,
      lastName,
      documentNumber,
      birthDate: birthDateText,
      sex,
      city,
    },
  };
}

const dosDigitos = (n) => String(n).padStart(2, "0");
const iso = (d) =>
  `${d.getUTCFullYear()}-${dosDigitos(d.getUTCMonth() + 1)}-${dosDigitos(d.getUTCDate())}`;
const impresa = (d) =>
  `${dosDigitos(d.getUTCDate())}/${dosDigitos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

/**
 * Los datos de la tarjeta. Todo lo que no vino se deriva del número de documento.
 *
 * La emisión cae en una ventana FIJA (2023-01-01 … 2026-06-30) y la expiración a diez años, así que
 * sale vigente hasta 2033 sin depender del reloj: con `Date.now()` los bytes cambiarían de un día
 * a otro y el determinismo sería mentira. Si la persona nació después, se emite al nacer + 30 días.
 */
export function cedulaDe(input) {
  const semilla = (proposito) => fnv1a(`${input.documentNumber}|${proposito}`);
  const elige = (proposito, lista) => lista[semilla(proposito) % lista.length];

  const sexo = input.sex ?? (semilla("sexo") % 2 === 0 ? "F" : "M");
  const nacimiento = fechaValida(input.birthDate);

  const inicio = Date.UTC(2023, 0, 1);
  const fin = Date.UTC(2026, 5, 30);
  const dias = Math.floor((fin - inicio) / 86_400_000);
  let emision = new Date(
    inicio + (semilla("emision") % (dias + 1)) * 86_400_000,
  );
  if (emision <= nacimiento)
    emision = new Date(nacimiento.getTime() + 30 * 86_400_000);
  const expiracion = new Date(
    Date.UTC(
      emision.getUTCFullYear() + 10,
      emision.getUTCMonth(),
      emision.getUTCDate(),
    ),
  );

  const ciudad = input.city ? ascii(input.city) : elige("ciudad", CIUDADES);
  const lugarNacimiento = LUGARES[ciudad] ?? ciudad;
  const domicilio = `${elige("calle", CALLES)} NO.${100 + (semilla("portal") % 4900)} Z. ${elige("zona", ZONAS)}`;
  const casado = semilla("civil") % 3 === 0;
  const estadoCivil = casado
    ? sexo === "F"
      ? "CASADA"
      : "CASADO"
    : sexo === "F"
      ? "SOLTERA"
      : "SOLTERO";

  return {
    numero: input.documentNumber,
    serie: String(10000 + (semilla("serie") % 90000)),
    seccion: String(10000 + (semilla("seccion") % 90000)),
    nombres: ascii(input.firstName),
    apellidos: ascii(input.lastName),
    nacimiento: impresa(nacimiento),
    nacimientoIso: iso(nacimiento),
    emision: impresa(emision),
    expiracion: impresa(expiracion),
    expiracionIso: iso(expiracion),
    sexo,
    lugarNacimiento,
    domicilio,
    profesion: elige("profesion", PROFESIONES),
    estadoCivil,
    grupoSanguineo: elige("sangre", GRUPOS),
    /*
     * Rostro acotado a 1..100000: `rasgos()` multiplica la semilla por 2654435761, y con una
     * semilla de 32 bits el producto pasa de 2^53 y pierde los bits bajos.
     */
    rostro: 1 + (semilla("rostro") % 100_000),
    // Toma de la selfie: 1..5, nunca 0 (0 es el original impreso en el carnet).
    variante: 1 + (semilla("toma") % 5),
  };
}

async function comoJpeg(png) {
  const bytes = await sharp(png)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: false })
    .toBuffer();
  return {
    contentType: "image/jpeg",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    base64: bytes.toString("base64"),
  };
}

/**
 * Pocas entradas y de un proceso: el backend puede reintentar la misma persona y redibujarla cuesta
 * ~1 s de CPU. Acotada porque cada entrada son ~0,5 MB en base64.
 */
const CACHE_MAX = 32;
const cache = new Map();

/** Sólo para pruebas: demostrar el determinismo sin que responda la caché. */
export function clearIdentityImagesCache() {
  cache.clear();
}

export async function buildIdentityImages(input) {
  const clave = JSON.stringify([
    input.documentNumber,
    input.firstName,
    input.lastName,
    input.birthDate,
    input.sex,
    input.city,
  ]);
  const guardado = cache.get(clave);
  if (guardado) return guardado;

  const datos = cedulaDe(input);
  const [front, back, selfie] = await Promise.all([
    renderCedula(datos).then(comoJpeg),
    renderCedulaReverso(datos).then(comoJpeg),
    renderSelfie(datos.rostro, datos.variante).then(comoJpeg),
  ]);
  const result = {
    version: IDENTITY_IMAGES_VERSION,
    images: { identity_front: front, identity_back: back, selfie },
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(clave, result);
  return result;
}
