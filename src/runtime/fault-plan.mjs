/**
 * Plan de fallos: qué escenario se aplica a esta llamada, y por qué.
 *
 * El emulador tenía UN escenario activo global. Eso alcanza para una demo y para nada más: una
 * corrida que quiere "SEGIP se cae en el segundo intento de esta persona, el resto normal" no se
 * puede expresar, y la alternativa —cambiar el global entre llamadas— es una carrera garantizada en
 * cuanto hay dos personas en paralelo.
 *
 * Precedencia, de más fuerte a más débil (la del paquete QA):
 *
 *   1. regla explícita del plan de fallos, la MÁS ESPECÍFICA que coincida;
 *   2. escenario pedido explícitamente en la llamada (cabecera o cuerpo);
 *   3. perfil de la corrida (`scenarioProfile` del namespace);
 *   4. default declarado del servidor.
 *
 * Que gane la más específica y no la primera declarada es deliberado: con orden de declaración, una
 * regla amplia escrita arriba tapa en silencio a la fina de abajo y el operador no tiene forma de
 * notarlo. Aquí, si dos reglas empatan en especificidad, es un error de validación del plan.
 *
 * Una selección inválida SIEMPRE es un error. No hay fallback silencioso a `happy_path`: ese es
 * justamente el fallo que este archivo existe para impedir.
 */
import { isKnownScenario } from "../capabilities.mjs";

const MATCH_FIELDS = ["provider", "operation", "personaKey", "logicalOperationId"];

/**
 * Valida el plan entero antes de guardarlo. Un plan con un escenario que no existe tiene que
 * romperse al plantarlo, no a mitad de una corrida de dos horas.
 */
export function validateFaultPlan(plan) {
  const errors = [];
  if (plan === null || typeof plan !== "object") return { ok: false, errors: ["El plan tiene que ser un objeto."] };
  const rules = plan.rules;
  if (!Array.isArray(rules)) return { ok: false, errors: ["`rules` tiene que ser un arreglo."] };
  if (rules.length > 200) return { ok: false, errors: ["Un plan de fallos no puede tener más de 200 reglas."] };

  const seen = new Map();
  const normalized = [];
  rules.forEach((rule, index) => {
    const where = `rules[${index}]`;
    if (rule === null || typeof rule !== "object") return errors.push(`${where} tiene que ser un objeto.`);
    if (!isKnownScenario(rule.scenario)) return errors.push(`${where}.scenario "${rule.scenario}" no es un escenario conocido.`);
    const match = rule.match ?? {};
    if (match === null || typeof match !== "object") return errors.push(`${where}.match tiene que ser un objeto.`);
    for (const field of Object.keys(match)) {
      if (!MATCH_FIELDS.includes(field)) errors.push(`${where}.match.${field} no es un criterio válido (${MATCH_FIELDS.join(", ")}).`);
    }
    const applyTo = normalizeApplyTo(rule.applyTo, where, errors);
    const signature = MATCH_FIELDS.map((field) => match[field] ?? "*").join("|");
    if (seen.has(signature)) errors.push(`${where} coincide exactamente con ${seen.get(signature)}: ambigüedad, no precedencia.`);
    seen.set(signature, where);
    normalized.push({ id: rule.id ?? `rule-${index}`, match, scenario: rule.scenario, applyTo, specificity: Object.keys(match).length });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan: { version: plan.version ?? 1, rules: normalized } };
}

function normalizeApplyTo(applyTo, where, errors) {
  if (applyTo === undefined || applyTo === null) return { kind: "always" };
  if (typeof applyTo !== "object") {
    errors.push(`${where}.applyTo tiene que ser un objeto.`);
    return { kind: "always" };
  }
  if (typeof applyTo.firstAttempts === "number") {
    if (!Number.isInteger(applyTo.firstAttempts) || applyTo.firstAttempts < 1) {
      errors.push(`${where}.applyTo.firstAttempts tiene que ser un entero ≥ 1.`);
    }
    return { kind: "firstAttempts", firstAttempts: applyTo.firstAttempts };
  }
  if (Array.isArray(applyTo.attempts)) {
    if (!applyTo.attempts.every((value) => Number.isInteger(value) && value >= 1)) {
      errors.push(`${where}.applyTo.attempts tiene que ser una lista de enteros ≥ 1.`);
    }
    return { kind: "attempts", attempts: applyTo.attempts };
  }
  if (typeof applyTo.timesThenRecover === "number") {
    if (!Number.isInteger(applyTo.timesThenRecover) || applyTo.timesThenRecover < 1) {
      errors.push(`${where}.applyTo.timesThenRecover tiene que ser un entero ≥ 1.`);
    }
    return { kind: "firstAttempts", firstAttempts: applyTo.timesThenRecover };
  }
  errors.push(`${where}.applyTo no declara ningún criterio conocido (firstAttempts, attempts, timesThenRecover).`);
  return { kind: "always" };
}

function matches(rule, context) {
  return MATCH_FIELDS.every((field) => rule.match[field] === undefined || rule.match[field] === context[field]);
}

function applies(rule, attempt) {
  if (rule.applyTo.kind === "always") return true;
  if (rule.applyTo.kind === "firstAttempts") return attempt <= rule.applyTo.firstAttempts;
  if (rule.applyTo.kind === "attempts") return rule.applyTo.attempts.includes(attempt);
  return false;
}

/**
 * Resuelve el escenario de UNA llamada y devuelve también de dónde salió. El `source` no es
 * decorado: es lo que permite que el informe distinga "falló porque el plan lo pidió" de "falló".
 *
 * @returns {{scenario: string, source: 'fault_plan'|'explicit_request'|'run_profile'|'server_default', ruleId?: string}}
 */
export function resolveScenario({ plan, context, attempt, explicitScenario, runProfileScenario, serverDefault }) {
  if (plan) {
    const candidates = plan.rules.filter((rule) => matches(rule, context) && applies(rule, attempt));
    if (candidates.length > 0) {
      const top = candidates.reduce((best, rule) => (rule.specificity > best.specificity ? rule : best));
      return { scenario: top.scenario, source: "fault_plan", ruleId: top.id };
    }
  }
  if (explicitScenario) return { scenario: explicitScenario, source: "explicit_request" };
  if (runProfileScenario) return { scenario: runProfileScenario, source: "run_profile" };
  return { scenario: serverDefault, source: "server_default" };
}
