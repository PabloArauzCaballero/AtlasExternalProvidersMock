/**
 * Azar con semilla para los fakers.
 *
 * La promesa de un faker de QA es una sola: **la misma semilla da exactamente los mismos datos**,
 * hoy y dentro de un mes, en esta máquina y en otra. Sin eso una corrida que falló no se puede
 * repetir y dos despliegues no se pueden comparar. Por eso aquí no hay `Math.random` ni reloj:
 * todo sale de `mulberry32`, sembrado con el hash de `semilla|tipo|índice`.
 *
 * Sembrar por índice (y no avanzar un único generador para todo el lote) tiene una consecuencia
 * útil: pedir 5 o 50 elementos con la misma semilla da los mismos 5 primeros. Ampliar un lote no
 * reescribe lo que ya se había probado.
 */

export function fnv1a(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generador para UN elemento de UN lote. `key` distingue sub-partes de un mismo caso. */
export function createRng(seed, type, index) {
  const next = mulberry32(fnv1a(`${seed}|${type}|${index}`));
  const rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max, decimals = 2) {
      return Number((min + next() * (max - min)).toFixed(decimals));
    },
    pick(options) {
      return options[Math.floor(next() * options.length)];
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
    digits(length) {
      let out = "";
      for (let i = 0; i < length; i += 1)
        out += String(Math.floor(next() * 10));
      return out;
    },
    hex(length) {
      let out = "";
      for (let i = 0; i < length; i += 1)
        out += Math.floor(next() * 16).toString(16);
      return out;
    },
    /** Sub-generador independiente: la dirección de un caso no cambia si cambia su dispositivo. */
    fork(part) {
      return createRng(seed, `${type}/${part}`, index);
    },
  };
  return rng;
}
