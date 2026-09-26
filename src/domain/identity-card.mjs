/**
 * Cédula boliviana SINTÉTICA —anverso con campos rotulados, reverso con MRZ TD1— y selfie.
 *
 * Portado de AtlasDecisionEngineBackend
 * (`src/modules/workers/identity-verification/fixtures/identity-card.ts`), que es contra lo que el
 * Motor calibró su OCR (tesseract) y su comparador facial. Se conservan el diseño, las coordenadas,
 * `ESCALA` y la separación retrato-del-carnet / selfie: misma persona = mismo `rostro`, tomas
 * distintas. Lo único que cambia es la salida (JPEG, la decide `identity-images.mjs`) y que aquí no
 * hacen falta los escenarios negativos (escritorio, paisaje, plano, ilegible, sin retrato).
 *
 * No se parece a una cédula real y no debe parecerse: sin holograma, sin fondo de seguridad, sin
 * escudo, y con la leyenda DOCUMENTO SINTETICO. Ejercita el camino —OCR, rótulos, fechas, MRZ,
 * rostro—, no el diseño del documento.
 *
 * TRAMPA: `font-family` explícito. sharp compone el SVG con fontconfig y, en una imagen sin
 * fuentes, el texto se dibuja VACÍO: la tarjeta sale en blanco y el Motor responde «no se pudo
 * leer», que parece un fallo del lector. Por eso `Dockerfile.dev` instala `fonts-dejavu-core`.
 */
import sharp from "sharp";
import { retrato } from "./identity-faces.mjs";

/** Tamaño generoso: el OCR pierde precisión con letra pequeña remuestreada. */
const ANCHO = 1400;
const ALTO = 900;

/**
 * Se dibuja a 1800 px de lado largo —lo que el normalizador del Motor usa— para que el retrato
 * llegue al comparador con píxeles REALES y no ampliados. Se aplica con `viewBox`, así que las
 * coordenadas del diseño siguen en 1400×900.
 */
const ESCALA = 1800 / ANCHO;

/** Resolución de origen de TODO rostro (carnet y selfie): mismos granos, misma escala. */
const ORIGEN_RETRATO = 900;

const escalar = (valor) => Math.round(valor * ESCALA);

/** Dónde va el retrato del titular y dónde la foto fantasma, en coordenadas de diseño. */
const RETRATO = { x: ANCHO - 380, y: 180, w: 290, h: 360 };
const FANTASMA = { x: ANCHO - 380, y: 580, w: 116, h: 144 };

/** Ancho útil de la columna de texto del anverso: termina antes del retrato. */
const COLUMNA_TEXTO = RETRATO.x - 60 - 40;

/**
 * Tamaño de letra para que un nombre largo no invada el retrato. DejaVu Sans en mayúsculas avanza
 * ~0,72 em por carácter; se encoge sólo lo necesario y nunca por debajo de 24 px (el OCR lo lee).
 */
function tamanoQueCabe(texto, base, ancho = COLUMNA_TEXTO) {
  const necesario = texto.length * base * 0.72;
  if (necesario <= ancho) return base;
  return Math.max(24, Math.floor(ancho / (texto.length * 0.72)));
}

/**
 * @param {object} datos
 * @param {string} datos.numero
 * @param {string} datos.serie
 * @param {string} datos.seccion
 * @param {string} datos.nombres
 * @param {string} datos.apellidos
 * @param {string} datos.nacimiento   dd/mm/aaaa
 * @param {string} datos.emision      dd/mm/aaaa
 * @param {string} datos.expiracion   dd/mm/aaaa
 * @param {number} datos.rostro
 */
export async function renderCedula(datos) {
  const numero = `N° ${datos.numero}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${escalar(ANCHO)}" height="${escalar(ALTO)}" viewBox="0 0 ${ANCHO} ${ALTO}">
  <rect width="${ANCHO}" height="${ALTO}" fill="#eef2ee"/>
  <rect x="20" y="20" width="${ANCHO - 40}" height="${ALTO - 40}" fill="#ffffff" stroke="#2f6b3f" stroke-width="4"/>
  <g font-family="DejaVu Sans, sans-serif" fill="#111111">
    <text x="60" y="92" font-size="34" fill="#2f6b3f">ESTADO PLURINACIONAL DE BOLIVIA</text>
    <text x="${ANCHO - 60}" y="92" font-size="34" fill="#2f6b3f" text-anchor="end">CEDULA DE IDENTIDAD</text>
    <text x="60" y="136" font-size="26" fill="#555555">SERVICIO GENERAL DE IDENTIFICACION PERSONAL</text>

    <text x="60" y="205" font-size="22" fill="#666666">SERIE</text>
    <text x="60" y="243" font-size="34">${escapar(datos.serie)}</text>
    <text x="330" y="205" font-size="22" fill="#666666">SECCION</text>
    <text x="330" y="243" font-size="34">${escapar(datos.seccion)}</text>

    <text x="60" y="315" font-size="22" fill="#666666">NOMBRES</text>
    <text x="60" y="357" font-size="${tamanoQueCabe(datos.nombres, 40)}">${escapar(datos.nombres)}</text>
    <text x="60" y="425" font-size="22" fill="#666666">APELLIDOS</text>
    <text x="60" y="467" font-size="${tamanoQueCabe(datos.apellidos, 40)}">${escapar(datos.apellidos)}</text>

    <text x="60" y="537" font-size="22" fill="#666666">FECHA DE NACIMIENTO</text>
    <text x="60" y="579" font-size="36">${escapar(datos.nacimiento)}</text>

    <text x="60" y="649" font-size="22" fill="#666666">FECHA DE EMISION</text>
    <text x="60" y="691" font-size="34">${escapar(datos.emision)}</text>
    <text x="470" y="649" font-size="22" fill="#666666">FECHA DE EXPIRACION</text>
    <text x="470" y="691" font-size="34">${escapar(datos.expiracion)}</text>

    <text x="60" y="790" font-size="46" fill="#1d5b8f">${escapar(numero)}</text>
    <text x="${ANCHO - 60}" y="${ALTO - 40}" font-size="24" fill="#888888" text-anchor="end">DOCUMENTO SINTETICO - SOLO PARA PRUEBAS</text>
  </g>
  <rect x="${RETRATO.x}" y="${RETRATO.y}" width="${RETRATO.w}" height="${RETRATO.h}" fill="#d8dcd6" stroke="#2f6b3f" stroke-width="3"/>
  <rect x="${FANTASMA.x}" y="${FANTASMA.y}" width="${FANTASMA.w}" height="${FANTASMA.h}" fill="#e6eae4"/>
</svg>`;

  return sharp(Buffer.from(svg))
    .composite(await retratosDe(datos.rostro))
    .png()
    .toBuffer();
}

/**
 * El retrato del titular y su copia pequeña (foto fantasma). La cédula vigente lleva las dos, y el
 * Motor tiene una regla que descarta el segundo rostro por tamaño: sin la fantasma no la probaría
 * nada. Se compone al tamaño YA escalado del lienzo porque `composite` pega en píxeles reales.
 */
async function retratosDe(rostro) {
  const original = await retrato(rostro, 0, ORIGEN_RETRATO);
  return [
    {
      input: await sharp(original)
        .resize(escalar(RETRATO.w), escalar(RETRATO.h), { fit: "cover" })
        .png()
        .toBuffer(),
      left: escalar(RETRATO.x),
      top: escalar(RETRATO.y),
    },
    {
      input: await sharp(original)
        .resize(escalar(FANTASMA.w), escalar(FANTASMA.h), { fit: "cover" })
        .modulate({ brightness: 1.25, saturation: 0.35 })
        .png()
        .toBuffer(),
      left: escalar(FANTASMA.x),
      top: escalar(FANTASMA.y),
    },
  ];
}

/**
 * El REVERSO, con su zona de lectura mecánica. Es la única parte con dígitos de control, y se
 * compone con los mismos datos que el anverso para que el contraste entre caras signifique algo.
 */
export async function renderCedulaReverso(datos) {
  const mrz = construirMrzTd1(datos);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${escalar(ANCHO)}" height="${escalar(ALTO)}" viewBox="0 0 ${ANCHO} ${ALTO}">
  <rect width="${ANCHO}" height="${ALTO}" fill="#eef2ee"/>
  <rect x="20" y="20" width="${ANCHO - 40}" height="${ALTO - 40}" fill="#ffffff" stroke="#2f6b3f" stroke-width="4"/>
  <g font-family="DejaVu Sans, sans-serif" fill="#111111">
    <text x="60" y="100" font-size="22" fill="#666666">LUGAR DE NACIMIENTO</text>
    <text x="60" y="142" font-size="${tamanoQueCabe(datos.lugarNacimiento, 32, ANCHO - 120)}">${escapar(datos.lugarNacimiento)}</text>
    <text x="60" y="212" font-size="22" fill="#666666">DOMICILIO</text>
    <text x="60" y="254" font-size="${tamanoQueCabe(datos.domicilio, 32, ANCHO - 120)}">${escapar(datos.domicilio)}</text>
    <text x="60" y="324" font-size="22" fill="#666666">PROFESION</text>
    <text x="60" y="366" font-size="32">${escapar(datos.profesion)}</text>
    <text x="60" y="436" font-size="22" fill="#666666">ESTADO CIVIL</text>
    <text x="60" y="478" font-size="32">${escapar(datos.estadoCivil)}</text>
    <text x="620" y="436" font-size="22" fill="#666666">GRUPO SANGUINEO</text>
    <text x="620" y="478" font-size="32">${escapar(datos.grupoSanguineo)}</text>
  </g>
  <!-- Monoespaciada: el reconocedor lee la MRZ como una rejilla de posiciones fijas. -->
  <g font-family="DejaVu Sans Mono, monospace" font-size="40" fill="#111111">
    <text x="60" y="${ALTO - 190}">${escapar(mrz[0])}</text>
    <text x="60" y="${ALTO - 130}">${escapar(mrz[1])}</text>
    <text x="60" y="${ALTO - 70}">${escapar(mrz[2])}</text>
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * La selfie: OTRA TOMA de la misma persona. `variante` nunca es 0: documento y selfie tienen que
 * ser dos tomas de la misma cara, no el mismo archivo dos veces.
 */
export async function renderSelfie(rostro, variante = 1) {
  return sharp(await retrato(rostro, variante, ORIGEN_RETRATO))
    .resize(720, 720, { fit: "cover" })
    .png()
    .toBuffer();
}

/**
 * MRZ TD1 válida, con sus dígitos de control CALCULADOS: el analizador del Motor los comprueba, y
 * una MRZ inventada haría pasar a la persona por la rama del fallo.
 */
export function construirMrzTd1(datos) {
  const relleno = (texto, largo) => texto.padEnd(largo, "<").slice(0, largo);
  const aammdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  const mrzTexto = (texto) => texto.replace(/[^A-Z0-9]+/g, "<");

  const numero = relleno(mrzTexto(datos.numero), 9);
  const nacimiento = aammdd(datos.nacimientoIso);
  const caducidad = aammdd(datos.expiracionIso);

  const l1 = relleno(`IDBOL${numero}${control(numero)}`, 30);
  const cuerpo2 =
    nacimiento +
    control(nacimiento) +
    datos.sexo +
    caducidad +
    control(caducidad) +
    "BOL";
  const l2sinControl = relleno(cuerpo2, 29);
  const compuesto = control(
    l1.slice(5, 30) +
      l2sinControl.slice(0, 7) +
      l2sinControl.slice(8, 15) +
      l2sinControl.slice(18, 29),
  );
  const l2 = l2sinControl + compuesto;
  const l3 = relleno(
    `${mrzTexto(datos.apellidos)}<<${mrzTexto(datos.nombres)}`,
    30,
  );
  return [l1, l2, l3];
}

/** Dígito de control de ICAO 9303: pesos 7-3-1, letras 10..35, relleno cero. */
function control(valor) {
  const pesos = [7, 3, 1];
  let suma = 0;
  for (let i = 0; i < valor.length; i += 1) {
    const caracter = valor[i];
    let peso = 0;
    if (caracter >= "0" && caracter <= "9") peso = caracter.charCodeAt(0) - 48;
    else if (caracter >= "A" && caracter <= "Z")
      peso = caracter.charCodeAt(0) - 55;
    suma += peso * pesos[i % 3];
  }
  return String(suma % 10);
}

function escapar(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
