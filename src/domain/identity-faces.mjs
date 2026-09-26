/**
 * Rostros sintéticos: una población DIBUJADA, no fotografías de nadie.
 *
 * Portado tal cual de AtlasDecisionEngineBackend
 * (`src/modules/workers/identity-verification/fixtures/identity-faces.ts`). El Motor calibró su
 * comparador facial contra ESTOS dibujos —tomas de la misma persona con mediana 0,93, personas
 * distintas con mediana 0,61—, así que cambiar la geometría, los colores o el grano aquí es
 * descalibrar lo que el Motor espera recibir. Si hay que tocarlo, se toca allí primero.
 *
 * Un rostro que entra al historial de git ya no sale: por eso se dibujan y no se versionan fotos.
 */
import sharp from "sharp";

/** Generador determinista: la misma semilla da siempre la misma persona. */
function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const entre = (r, a, b) => a + r() * (b - a);
const elige = (r, lista) => lista[Math.floor(r() * lista.length)];

const PIELES = [
  ["#f2d3b6", "#cfa77f"],
  ["#e0b48c", "#b3835a"],
  ["#c98f63", "#9a6740"],
  ["#a4703f", "#7a4f28"],
  ["#79512f", "#573818"],
  ["#5d3c22", "#3f2713"],
];
const PELOS = [
  "#0d0b0a",
  "#2e2118",
  "#5a3a1e",
  "#8a6230",
  "#b99a63",
  "#7a7a7a",
];
const IRIS = ["#2a1c12", "#4a3520", "#3a6b4d", "#37587d", "#6b5a3a"];
const FONDOS = [
  "#c9cfd6",
  "#d7d2c6",
  "#bfd0d6",
  "#d6cdd6",
  "#c6d6c9",
  "#dad6cb",
];
const LABIOS = ["#a45c52", "#8b4a44", "#bd6a5e", "#96504a", "#b0655c"];

/**
 * Los rasgos de una persona. Varían la GEOMETRÍA y no sólo el color: con sólo color el
 * descriptor veía a dos «personas» distintas a 0,99 de parecido.
 */
export function rasgos(semilla) {
  const r = aleatorio(semilla * 2654435761);
  const [piel, sombra] = elige(r, PIELES);
  return {
    piel,
    sombra,
    pelo: elige(r, PELOS),
    iris: elige(r, IRIS),
    fondo: elige(r, FONDOS),
    labios: elige(r, LABIOS),
    caraW: Math.round(entre(r, 118, 176)),
    caraH: Math.round(entre(r, 172, 218)),
    ojoSep: Math.round(entre(r, 56, 90)),
    ojoY: Math.round(entre(r, 214, 250)),
    ojoR: Math.round(entre(r, 10, 19)),
    ojoW: Math.round(entre(r, 26, 40)),
    ojoH: Math.round(entre(r, 13, 22)),
    cejaGrosor: Math.round(entre(r, 6, 16)),
    cejaAlto: Math.round(entre(r, 24, 44)),
    narizL: Math.round(entre(r, 42, 78)),
    narizW: Math.round(entre(r, 9, 20)),
    bocaW: Math.round(entre(r, 42, 78)),
    bocaY: Math.round(entre(r, 334, 384)),
    bocaGrosor: Math.round(entre(r, 22, 44)),
    menton: Math.round(entre(r, -10, 26)),
    flequillo: Math.round(entre(r, 96, 168)),
  };
}

/** El dibujo, en 512×512. */
export function svgRostro(g) {
  const w = 512;
  const cy = 258;
  const cx = w / 2;
  const oi = cx - g.ojoSep;
  const od = cx + g.ojoSep;
  const nx = g.narizW;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}">
  <defs>
    <radialGradient id="p" cx="50%" cy="38%" r="68%">
      <stop offset="0%" stop-color="${g.piel}"/><stop offset="100%" stop-color="${g.sombra}"/>
    </radialGradient>
    <radialGradient id="f" cx="50%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${g.fondo}"/><stop offset="100%" stop-color="#8d949c"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${w}" fill="url(#f)"/>
  <rect x="${cx - 58}" y="${cy + g.caraH - 70}" width="116" height="120" rx="34" fill="${g.sombra}"/>
  <ellipse cx="${cx}" cy="${w + 40}" rx="230" ry="130" fill="#3f4a58"/>
  <ellipse cx="${cx}" cy="${cy - 24}" rx="${g.caraW + 22}" ry="${g.caraH + 6}" fill="${g.pelo}"/>
  <ellipse cx="${cx - g.caraW + 6}" cy="${cy + 16}" rx="18" ry="30" fill="${g.sombra}"/>
  <ellipse cx="${cx + g.caraW - 6}" cy="${cy + 16}" rx="18" ry="30" fill="${g.sombra}"/>
  <path d="M ${cx - g.caraW} ${cy - 30}
           a ${g.caraW} ${g.caraH} 0 0 1 ${2 * g.caraW} 0
           q 0 ${g.caraH * 0.9} -${g.caraW} ${g.caraH * 0.62 + g.menton}
           q -${g.caraW} -${g.caraH * 0.62 + g.menton} -${g.caraW} -${g.caraH * 0.9} z" fill="url(#p)"/>
  <path d="M ${cx - g.caraW - 4} ${cy - 62} q ${g.caraW} -${g.flequillo} ${2 * g.caraW + 8} 0 q -${g.caraW} -58 -${2 * g.caraW + 8} 0 z" fill="${g.pelo}"/>
  <path d="M ${oi - g.ojoW} ${g.ojoY - g.cejaAlto} q ${g.ojoW} -20 ${2 * g.ojoW} -4"
        stroke="${g.pelo}" stroke-width="${g.cejaGrosor}" fill="none" stroke-linecap="round"/>
  <path d="M ${od + g.ojoW} ${g.ojoY - g.cejaAlto} q -${g.ojoW} -20 -${2 * g.ojoW} -4"
        stroke="${g.pelo}" stroke-width="${g.cejaGrosor}" fill="none" stroke-linecap="round"/>
  <ellipse cx="${oi}" cy="${g.ojoY}" rx="${g.ojoW}" ry="${g.ojoH}" fill="#f6f2ee"/>
  <ellipse cx="${od}" cy="${g.ojoY}" rx="${g.ojoW}" ry="${g.ojoH}" fill="#f6f2ee"/>
  <circle cx="${oi}" cy="${g.ojoY}" r="${g.ojoR}" fill="${g.iris}"/>
  <circle cx="${od}" cy="${g.ojoY}" r="${g.ojoR}" fill="${g.iris}"/>
  <circle cx="${oi}" cy="${g.ojoY}" r="${(g.ojoR * 0.45).toFixed(1)}" fill="#141014"/>
  <circle cx="${od}" cy="${g.ojoY}" r="${(g.ojoR * 0.45).toFixed(1)}" fill="#141014"/>
  <circle cx="${oi - 5}" cy="${g.ojoY - 6}" r="4" fill="#fff" opacity="0.9"/>
  <circle cx="${od - 5}" cy="${g.ojoY - 6}" r="4" fill="#fff" opacity="0.9"/>
  <path d="M ${oi - g.ojoW} ${g.ojoY} a ${g.ojoW} ${g.ojoH} 0 0 1 ${2 * g.ojoW} 0" stroke="#4a3a2e" stroke-width="5" fill="none"/>
  <path d="M ${od - g.ojoW} ${g.ojoY} a ${g.ojoW} ${g.ojoH} 0 0 1 ${2 * g.ojoW} 0" stroke="#4a3a2e" stroke-width="5" fill="none"/>
  <path d="M ${cx} ${g.ojoY + 6} l -${nx / 2} ${g.narizL} q ${nx / 2} 12 ${nx} 0 z" fill="${g.sombra}" opacity="0.55"/>
  <ellipse cx="${cx - nx}" cy="${g.ojoY + g.narizL + 8}" rx="${nx * 0.45}" ry="4" fill="#7d5842" opacity="0.75"/>
  <ellipse cx="${cx + nx}" cy="${g.ojoY + g.narizL + 8}" rx="${nx * 0.45}" ry="4" fill="#7d5842" opacity="0.75"/>
  <path d="M ${cx - g.bocaW} ${g.bocaY} q ${g.bocaW} -18 ${2 * g.bocaW} 0 q -${g.bocaW} ${g.bocaGrosor} -${2 * g.bocaW} 0 z" fill="${g.labios}"/>
  <path d="M ${cx - g.bocaW} ${g.bocaY} q ${g.bocaW} 12 ${2 * g.bocaW} 0" stroke="#7c3f39" stroke-width="3" fill="none"/>
</svg>`;
}

/**
 * Una TOMA de esa persona. `variante 0` es el original (el del carnet); las demás pasan por lo que
 * le pasa a una cara entre el estudio del documento y la cámara de un móvil: giro pequeño, otra luz
 * y compresión con pérdida. Sin esto documento y selfie serían el mismo píxel y el parecido 1,000.
 */
export async function retrato(semilla, variante = 0, ancho = 512) {
  const conGrano = sharp(Buffer.from(svgRostro(rasgos(semilla))))
    .resize(ancho)
    .composite([{ ...grano(ancho, semilla, variante), blend: "overlay" }]);

  if (variante === 0) return conGrano.png().toBuffer();
  const r = aleatorio(semilla * 7919 + variante * 104729);
  return sharp(await conGrano.png().toBuffer())
    .rotate(entre(r, -5, 5), { background: "#9aa1a8" })
    .modulate({
      brightness: entre(r, 0.9, 1.12),
      saturation: entre(r, 0.88, 1.08),
    })
    .jpeg({ quality: Math.round(entre(r, 72, 92)) })
    .toBuffer();
}

/**
 * Textura fina: sin ella el medidor de calidad del Motor lee el dibujo como desenfocado y rechaza
 * la selfie antes de compararla. Cambia con la TOMA, no sólo con la persona: si fuera la misma en
 * todas sería una marca de identidad escondida en los píxeles.
 */
function grano(ancho, semilla, variante) {
  const r = aleatorio(semilla * 2246822519 + variante * 3266489917 + 1);
  const pixeles = Buffer.allocUnsafe(ancho * ancho * 4);
  for (let i = 0; i < ancho * ancho; i += 1) {
    // Centrado en 128: en `overlay` ese valor deja el píxel como estaba.
    const v = 128 + Math.round((r() - 0.5) * 74);
    pixeles[i * 4] = v;
    pixeles[i * 4 + 1] = v;
    pixeles[i * 4 + 2] = v;
    pixeles[i * 4 + 3] = 255;
  }
  // En crudo y no como PNG (el Motor lo pasa por PNG): mismos píxeles —PNG no pierde nada— sin
  // pagar la compresión de 900×900 de ruido, que era medio segundo por retrato.
  return { input: pixeles, raw: { width: ancho, height: ancho, channels: 4 } };
}
