/**
 * Estado, reloj y mensajes del emulador SIAT.
 *
 * El estado vive en el namespace de la corrida (`ctx.get/ctx.set`), con una clave por NIT: CUIS,
 * CUFD, facturas recibidas, números usados, eventos y paquetes. Nada queda en una variable del
 * módulo, así que dos corridas en paralelo no se ven y el reset por corrida lo limpia entero.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const MENSAJES = JSON.parse(
  readFileSync(new URL("./data/siat-mensajes.json", import.meta.url), "utf8"),
).mensajes;

export const CATALOGOS = JSON.parse(
  readFileSync(new URL("./data/siat-catalogos.json", import.meta.url), "utf8"),
);

/** Mensaje con el texto oficial del SIN. */
export function mensaje(codigo, extra = {}) {
  return {
    codigo,
    descripcion: MENSAJES[String(codigo)] ?? `Código ${codigo}`,
    ...extra,
  };
}

export function listaMensajes() {
  return Object.entries(MENSAJES).map(([codigo, descripcion]) => ({
    codigoClasificador: Number(codigo),
    descripcion,
  }));
}

/* ------------------------------------------------------------------ reloj */

/** Bolivia no tiene horario de verano: UTC−4 fijo. */
const OFFSET_BOLIVIA_MS = -4 * 60 * 60 * 1000;

/** Hora local de Bolivia en el formato del SIN, sin zona: `2026-09-26T16:03:48.675`. */
export function ahoraBolivia(ms = Date.now()) {
  return new Date(ms + OFFSET_BOLIVIA_MS).toISOString().slice(0, 23);
}

/** Con zona, como lo devuelve el SIN en `fechaVigencia`: `2027-09-26T16:03:48.675-04:00`. */
export function fechaVigencia(ms) {
  return `${ahoraBolivia(ms)}-04:00`;
}

/** Instante (ms UTC) de una fecha local boliviana sin zona. `NaN` si no se entiende. */
export function instanteBolivia(fecha) {
  const texto = String(fecha ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(texto))
    return Number.NaN;
  return Date.parse(`${texto}Z`) - OFFSET_BOLIVIA_MS;
}

/* ----------------------------------------------------------------- códigos */

export function hexAleatorio(bytes) {
  return randomBytes(bytes).toString("hex").toUpperCase();
}

/** Código de CUFD con la forma de los del SIN (base64 sin relleno) y su código de control. */
export function nuevoCufd({ nit, cuis }) {
  const semilla = `${nit}|${cuis}|${Date.now()}|${hexAleatorio(8)}`;
  const hash = createHash("sha256").update(semilla).digest();
  return {
    codigo: `BQ${hash.subarray(0, 24).toString("base64").replace(/=+$/, "")}`,
    codigoControl: createHash("sha1")
      .update(hash)
      .digest("hex")
      .slice(0, 15)
      .toUpperCase(),
  };
}

export function nuevoCodigoRecepcion() {
  const hex = randomBytes(16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ------------------------------------------------------------------ estado */

function vacio() {
  return {
    cuis: {},
    cufd: {},
    facturas: {},
    numeros: {},
    eventos: {},
    paquetes: {},
    puntosVenta: {},
    siguienteEvento: 1,
  };
}

/**
 * Lee el estado del NIT, deja que `mutar` lo cambie y lo guarda. Node es de un hilo y esto no
 * tiene `await`: nadie observa el estado a medio cambiar.
 */
export function conEstado(ctx, nit, mutar) {
  const clave = `siat:${nit}`;
  const estado = ctx.get?.(clave) ?? vacio();
  const resultado = mutar(estado);
  ctx.set?.(clave, estado);
  return resultado;
}

export function claveSucursal(codigoSucursal, codigoPuntoVenta) {
  return `${Number(codigoSucursal ?? 0)}|${Number(codigoPuntoVenta ?? 0)}`;
}
