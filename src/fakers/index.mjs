/**
 * Fakers de QA: generadores de datos de prueba con semilla y parámetros.
 *
 * Existen para que ningún portal tenga datos de prueba escritos a mano. Antes el QA Lab del portal
 * traía `cliente.demo@atlas.test` y `+59171234567` como texto fijo: la segunda corrida chocaba con
 * la primera («ya existe») y la «semilla» del formulario no cambiaba ni un campo. Aquí la semilla
 * decide el lote entero y los parámetros acotan qué se genera.
 *
 *   GET  /mock/fakers              catálogo: tipos, campos, parámetros con etiqueta y límites
 *   POST /mock/fakers/:tipo        { seed, count, variant, params } → { items: [...] }
 *   GET  /mock/fakers/:tipo?seed=…&count=…&variant=…&<param>=…   lo mismo, para enlazar
 *
 * No cambian ningún estado del emulador ni leen nada de las corridas, así que no piden token.
 */
import { createRng } from "./prng.mjs";
import {
  FAKER_TYPES,
  CROSS_PARAM_RULES,
  REFERENCE_DATE,
  findFakerType,
} from "./generators.mjs";

export const FAKER_LIMITS = Object.freeze({ maxCount: 200, maxSeedLength: 80 });

export const VARIANTS = [
  {
    value: "valido",
    label: "Válido",
    help: "Datos que cumplen las reglas del formulario.",
  },
  {
    value: "frontera",
    label: "Frontera",
    help: "Válidos pero en el borde: edad mínima exacta, monto máximo, carnet corto.",
  },
  {
    value: "invalido",
    label: "Inválido",
    help: "Cada elemento rompe UNA regla y dice cuál en «_invalid». Sirve para comprobar que el sistema rechaza.",
  },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function fakerCatalog() {
  return {
    referenceDate: REFERENCE_DATE,
    limits: FAKER_LIMITS,
    variants: VARIANTS,
    placeholder: "{{faker.<tipo>.<campo>}}",
    types: FAKER_TYPES.map(({ generate: _generate, ...entry }) => entry),
  };
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Convierte un valor crudo (JSON o query string) al tipo del parámetro, o dice por qué no. */
function coerce(param, raw) {
  if (param.kind === "int" || param.kind === "number") {
    const value = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (String(raw).trim() === "" || !Number.isFinite(value))
      return { error: `«${param.label}» tiene que ser un número.` };
    if (param.kind === "int" && !Number.isInteger(value))
      return { error: `«${param.label}» tiene que ser un número entero.` };
    if (param.min !== undefined && value < param.min)
      return { error: `«${param.label}» no puede ser menor que ${param.min}.` };
    if (param.max !== undefined && value > param.max)
      return { error: `«${param.label}» no puede ser mayor que ${param.max}.` };
    return { value };
  }
  const text = String(raw).trim();
  if (param.kind === "enum") {
    if (!param.options.some((option) => option.value === text)) {
      return {
        error: `«${param.label}» no admite «${text}». Opciones: ${param.options.map((option) => option.value).join(", ")}.`,
      };
    }
    return { value: text };
  }
  if (param.kind === "date") {
    if (!validDate(text))
      return { error: `«${param.label}» tiene que ser una fecha AAAA-MM-DD.` };
    return { value: text };
  }
  if (param.maxLength !== undefined && text.length > param.maxLength)
    return {
      error: `«${param.label}» admite hasta ${param.maxLength} caracteres.`,
    };
  if (param.pattern && !new RegExp(param.pattern).test(text))
    return { error: `«${param.label}» no tiene un formato válido.` };
  return { value: text };
}

/**
 * Valida la petición completa. Devuelve `{ ok: true, request }` o `{ ok: false, errors }` con TODOS
 * los errores a la vez: quien llena un formulario no debería corregir de uno en uno.
 */
export function resolveFakerRequest(type, raw = {}) {
  const entry = findFakerType(type);
  if (!entry)
    return {
      ok: false,
      status: 404,
      code: "UNKNOWN_FAKER",
      errors: [
        {
          param: "tipo",
          detail: `No hay faker «${type}». Tipos: ${FAKER_TYPES.map((t) => t.type).join(", ")}.`,
        },
      ],
    };

  const errors = [];
  const seed =
    raw.seed === undefined ||
    raw.seed === null ||
    String(raw.seed).trim() === ""
      ? "qa-base"
      : String(raw.seed).trim();
  if (seed.length > FAKER_LIMITS.maxSeedLength)
    errors.push({
      param: "seed",
      detail: `La semilla admite hasta ${FAKER_LIMITS.maxSeedLength} caracteres.`,
    });

  let count = 1;
  if (
    raw.count !== undefined &&
    raw.count !== null &&
    String(raw.count).trim() !== ""
  ) {
    count = Number(raw.count);
    if (!Number.isInteger(count) || count < 1 || count > FAKER_LIMITS.maxCount)
      errors.push({
        param: "count",
        detail: `La cantidad tiene que ser un entero entre 1 y ${FAKER_LIMITS.maxCount}.`,
      });
  }

  const variant =
    raw.variant === undefined || raw.variant === null || raw.variant === ""
      ? "valido"
      : String(raw.variant);
  if (!VARIANTS.some((option) => option.value === variant))
    errors.push({
      param: "variant",
      detail: `Variante desconocida «${variant}». Opciones: ${VARIANTS.map((v) => v.value).join(", ")}.`,
    });

  const rawParams =
    raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)
      ? raw.params
      : {};
  const known = new Set(entry.params.map((param) => param.name));
  for (const name of Object.keys(rawParams)) {
    if (!known.has(name))
      errors.push({
        param: name,
        detail: `«${entry.label}» no tiene el parámetro «${name}».`,
      });
  }
  const params = {};
  for (const param of entry.params) {
    const value = rawParams[param.name];
    if (value === undefined || value === null || value === "") {
      params[param.name] = param.default;
      continue;
    }
    const result = coerce(param, value);
    if (result.error) errors.push({ param: param.name, detail: result.error });
    else params[param.name] = result.value;
  }
  for (const rule of CROSS_PARAM_RULES) {
    if (
      params[rule.a] !== undefined &&
      params[rule.b] !== undefined &&
      params[rule.a] > params[rule.b]
    )
      errors.push({ param: rule.b, detail: rule.detail });
  }

  if (errors.length > 0)
    return { ok: false, status: 422, code: "INVALID_FAKER_PARAMS", errors };
  return { ok: true, request: { entry, seed, count, variant, params } };
}

export function generateFakerBatch({ entry, seed, count, variant, params }) {
  const items = [];
  for (let index = 0; index < count; index += 1) {
    items.push(
      entry.generate(
        createRng(seed, entry.type, index),
        params,
        variant,
        index,
      ),
    );
  }
  return {
    type: entry.type,
    label: entry.label,
    seed,
    count,
    variant,
    params,
    referenceDate: REFERENCE_DATE,
    items,
  };
}

/** Lee `?seed=&count=&variant=&<param>=` como la misma petición que el cuerpo del POST. */
export function fakerRequestFromQuery(searchParams) {
  const raw = { params: {} };
  for (const [key, value] of searchParams.entries()) {
    if (key === "seed" || key === "count" || key === "variant")
      raw[key] = value;
    else raw.params[key] = value;
  }
  return raw;
}
