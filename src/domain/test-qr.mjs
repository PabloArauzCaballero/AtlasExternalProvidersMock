/**
 * Generación de un QR de cobro de PRUEBA.
 *
 * Es el ESPEJO de `AtlasBackend/src/modules/external-data/infrastructure/adapters/banking-generic/
 * banking-qr.util.ts`: el mismo algoritmo, determinista por input, para que la respuesta sea
 * equivalente venga de este emulador (modo `mock_server`) o se genere en proceso (`mock_local`).
 * El comentario de ese archivo ya apuntaba aquí; el archivo faltaba.
 *
 * NO es un QR EMV real escaneable — es data de prueba: un payload de texto y una imagen SVG "tipo
 * QR" (data URL) que renderiza en el navegador sin librerías.
 */

function hash32(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0xffffffff;
  };
}

const MODULES = 25;
const CELL = 8;
const QUIET = 2;

function finderModule(row, col) {
  const inBox = (r0, c0) => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
  const finderPixel = (r0, c0) => {
    const r = row - r0;
    const c = col - c0;
    const border = r === 0 || r === 6 || c === 0 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    return border || core;
  };
  if (inBox(0, 0)) return { finder: true, on: finderPixel(0, 0) };
  if (inBox(0, MODULES - 7)) return { finder: true, on: finderPixel(0, MODULES - 7) };
  if (inBox(MODULES - 7, 0)) return { finder: true, on: finderPixel(MODULES - 7, 0) };
  return { finder: false, on: false };
}

function buildQrSvg(payload) {
  const random = makeRandom(hash32(payload));
  const size = (MODULES + QUIET * 2) * CELL;
  let rects = "";
  for (let row = 0; row < MODULES; row += 1) {
    for (let col = 0; col < MODULES; col += 1) {
      const finder = finderModule(row, col);
      const on = finder.finder ? finder.on : random() > 0.5;
      if (on) {
        const x = (col + QUIET) * CELL;
        const y = (row + QUIET) * CELL;
        rects += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/><g fill="#000000">${rects}</g></svg>`
  );
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Determinista: mismo input ⇒ mismo QR. `expired` sale del escenario, no del input, para que un
 * operador pueda pedir un QR vencido sin cambiar los datos de la cobranza.
 */
export function buildTestBankQr(input = {}) {
  const amount = typeof input.amount === "number" && input.amount > 0 ? input.amount : 100;
  const currency = typeof input.currency === "string" && input.currency ? input.currency : "BOB";
  const reference = typeof input.reference === "string" && input.reference ? input.reference : "MOCK-REF";
  const expired = input.scenario === "expired" || input.scenario === "expired_token";
  const payload = `ATLAS-MOCK-QR|amount=${amount}|currency=${currency}|ref=${reference}`;
  const seed = hash32(payload).toString(16).toUpperCase().padStart(8, "0");
  return {
    status: expired ? "QR_EXPIRED" : "QR_GENERATED",
    qrId: `QR-BANK-MOCK-${seed}`,
    qrPayload: payload,
    qrImageSvgDataUrl: svgToDataUrl(buildQrSvg(payload)),
    amount,
    currency,
    reference,
    expiresAt: expired ? "2026-01-01T00:00:00Z" : "2026-12-31T23:59:59Z",
    providerReference: "BANK-QR-MOCK-001",
  };
}
