/**
 * Los tipos de faker: qué genera cada uno, qué parámetros acepta y cómo se ve su frontera y su
 * versión inválida.
 *
 * Cada tipo declara sus parámetros como DATOS (`params`), no sólo como código: el catálogo
 * (`GET /mock/fakers`) los publica con etiqueta, ayuda, mínimo, máximo y opciones, y los portales
 * pintan el formulario a partir de ahí. Añadir un parámetro aquí lo hace aparecer en el QA Lab sin
 * tocar el portal.
 *
 * Los nombres de CAMPO van en inglés (`firstName`, `documentNumber`, `birthDate`) porque son los
 * mismos que esperan los contratos de AtlasBackend: `{{faker.persona.email}}` en una plantilla se
 * pega tal cual en el cuerpo de la petición. Las etiquetas, en español, son para quien opera.
 *
 * Tres variantes:
 * - `valido`: pasa las reglas del contrato.
 * - `frontera`: pasa, pero pegado al borde (edad mínima exacta, monto máximo, carnet más corto).
 * - `invalido`: rompe UNA regla, y dice cuál en `_invalid` para que el informe sepa qué esperar.
 */
import {
  DEPARTMENTS,
  FEMALE_NAMES,
  MALE_NAMES,
  LAST_NAMES,
  STREETS,
  ZONES,
  OPERATORS,
  BANKS,
  EMPLOYERS,
  MERCHANT_CATEGORIES,
  MERCHANT_NAME_PARTS,
  DEVICES,
  asciiSlug,
} from "./bolivia.mjs";

/**
 * Fecha de referencia FIJA para calcular edades. Con "hoy" la misma semilla daría otra fecha de
 * nacimiento cada día y el lote dejaría de ser reproducible. Una persona que tenía 18 años en esta
 * fecha sigue siendo mayor de edad después, así que la validez no caduca.
 */
export const REFERENCE_DATE = "2026-01-01";

const DEPARTMENT_OPTIONS = [
  { value: "cualquiera", label: "Cualquiera" },
  ...DEPARTMENTS.map((department) => ({
    value: department.code,
    label: department.name,
  })),
];

const EMAIL_DOMAIN_PARAM = {
  name: "dominioCorreo",
  label: "Dominio del correo",
  kind: "string",
  default: "qa.atlas.test",
  maxLength: 60,
  pattern: "^[a-z0-9.-]+\\.[a-z]{2,}$",
  help: "Por defecto un dominio .test, que no existe en internet: ningún correo sale a una persona real.",
};

/* ------------------------------------------------------------ piezas sueltas */

function departmentFor(rng, code) {
  if (code && code !== "cualquiera")
    return DEPARTMENTS.find((department) => department.code === code);
  return rng.pick(DEPARTMENTS);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function birthDateForAge(rng, age) {
  const [refYear] = REFERENCE_DATE.split("-").map(Number);
  // Nacido entre el 2 de enero de (ref - age - 1) y el 1 de enero de (ref - age): tiene `age` años
  // cumplidos en la fecha de referencia.
  const year = refYear - age - 1;
  const dayOfYear = rng.int(1, 364);
  const date = new Date(Date.UTC(year, 0, 1 + dayOfYear));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function phoneNumber(rng) {
  const operator = rng.pick(OPERATORS);
  const national = `${operator.prefix}${rng.digits(4)}`;
  return { operator: operator.name, national, e164: `+591${national}` };
}

function documentFor(
  rng,
  { departamento = "cualquiera", complemento = "a veces" } = {},
) {
  const department = departmentFor(rng, departamento);
  const number = String(rng.int(1_000_000, 13_999_999));
  const withComplement =
    complemento === "siempre" || (complemento === "a veces" && rng.bool(0.15));
  return {
    documentType: "CI",
    documentNumber: number,
    documentComplement: withComplement
      ? `${rng.int(1, 9)}${rng.pick(["A", "B", "C", "D", "E", "F", "G", "H"])}`
      : "",
    documentExtension: department.code,
  };
}

function emailFor(rng, first, last, domain) {
  return `${asciiSlug(first)}.${asciiSlug(last)}.${rng.hex(4)}@${domain}`;
}

function addressFor(rng, departamento) {
  const department = departmentFor(rng, departamento);
  return {
    street: rng.pick(STREETS),
    streetNumber: String(rng.int(1, 2999)),
    zone: rng.pick(ZONES),
    city: department.city,
    department: department.name,
    departmentCode: department.code,
    country: "BO",
    latitude: Number((department.lat + rng.float(-0.03, 0.03, 5)).toFixed(5)),
    longitude: Number((department.lon + rng.float(-0.03, 0.03, 5)).toFixed(5)),
  };
}

function personFor(rng, params, variant) {
  const gender =
    params.genero === "cualquiera" ? rng.pick(["F", "M"]) : params.genero;
  const names = gender === "F" ? FEMALE_NAMES : MALE_NAMES;
  const firstName = rng.pick(names);
  const secondName = rng.bool(0.4)
    ? rng.pick(names.filter((name) => name !== firstName))
    : "";
  const lastName = rng.pick(LAST_NAMES);
  const secondLastName = rng.pick(
    LAST_NAMES.filter((name) => name !== lastName),
  );
  let age = rng.int(params.edadMin, params.edadMax);
  if (variant === "frontera")
    age = rng.bool() ? params.edadMin : params.edadMax;
  const document = documentFor(rng.fork("documento"), params);
  if (variant === "frontera")
    document.documentNumber = document.documentNumber.slice(0, 5);
  const phone = phoneNumber(rng.fork("telefono"));
  const address = addressFor(rng.fork("direccion"), params.departamento);
  return {
    firstName,
    secondName,
    lastName,
    secondLastName,
    fullName: [firstName, secondName, lastName, secondLastName]
      .filter(Boolean)
      .join(" "),
    gender,
    birthDate: birthDateForAge(rng, age),
    age,
    ...document,
    phone: phone.e164,
    phoneOperator: phone.operator,
    email: emailFor(
      rng.fork("correo"),
      firstName,
      lastName,
      params.dominioCorreo,
    ),
    city: address.city,
    department: address.department,
    address: `${address.street} ${address.streetNumber}, ${address.zone}`,
  };
}

function deviceFor(rng, params) {
  const platform =
    params.plataforma === "cualquiera"
      ? rng.pick(["android", "ios"])
      : params.plataforma;
  const device = rng.pick(DEVICES[platform]);
  const osVersion = rng.pick(device.versions);
  const suspicious = params.riesgo === "sospechoso";
  const appVersion = `1.${rng.int(0, 4)}.${rng.int(0, 9)}`;
  return {
    deviceFingerprintHash: rng.hex(64),
    fingerprintVersion: "v1",
    channel: "mobile_app",
    userAgent: `AtlasApp/${appVersion} (${platform === "ios" ? "iOS" : "Android"} ${osVersion}; ${device.model})`,
    snapshot: {
      brand: device.brand,
      model: device.model,
      osFamily: platform === "ios" ? "iOS" : "Android",
      osVersion,
      appVersion,
      isRooted: suspicious && rng.bool(0.6),
      isEmulator: suspicious && rng.bool(0.5),
      vpnDetected: suspicious,
      timezone: "America/La_Paz",
      locale: "es-BO",
    },
  };
}

function financialFor(rng, params, variant) {
  const employmentType = rng.pick(["dependiente", "independiente", "informal"]);
  let monthlyIncome = rng.int(params.ingresoMin, params.ingresoMax);
  if (variant === "frontera")
    monthlyIncome = rng.bool() ? params.ingresoMin : params.ingresoMax;
  const expenseRatio = rng.float(0.35, 0.85);
  return {
    employmentType,
    employerName: employmentType === "dependiente" ? rng.pick(EMPLOYERS) : "",
    yearsEmployed: rng.int(0, 25),
    monthlyIncome,
    monthlyExpenses: Math.round(monthlyIncome * expenseRatio),
    currency: "BOB",
  };
}

function bankAccountFor(rng, holderName) {
  const bank = rng.pick(BANKS);
  return {
    bankCode: bank.code,
    bankName: bank.name,
    accountType: rng.pick(["caja_de_ahorro", "cuenta_corriente"]),
    accountNumber: rng.digits(rng.int(10, 14)),
    currency: rng.bool(0.85) ? "BOB" : "USD",
    holderName,
  };
}

function merchantFor(rng, params) {
  const category = rng.pick(MERCHANT_CATEGORIES);
  const tradeName = `${rng.pick(MERCHANT_NAME_PARTS.first)} ${rng.pick(MERCHANT_NAME_PARTS.second)}`;
  const representative = personFor(
    rng.fork("representante"),
    {
      ...params,
      edadMin: 25,
      edadMax: 65,
      genero: "cualquiera",
      complemento: "a veces",
    },
    "valido",
  );
  const address = addressFor(rng.fork("direccion"), params.departamento);
  return {
    legalName: `${tradeName} ${rng.pick(["S.R.L.", "S.A.", "Unipersonal"])}`,
    tradeName,
    nit: rng.digits(rng.int(9, 10)),
    businessCategory: category.label,
    mcc: category.code,
    phone: phoneNumber(rng.fork("telefono")).e164,
    email: `contacto.${asciiSlug(tradeName)}.${rng.hex(4)}@${params.dominioCorreo}`,
    address: `${address.street} ${address.streetNumber}, ${address.zone}`,
    city: address.city,
    department: address.department,
    legalRepresentative: {
      fullName: representative.fullName,
      documentNumber: representative.documentNumber,
      documentExtension: representative.documentExtension,
      phone: representative.phone,
      email: representative.email,
    },
  };
}

/* -------------------------------------------------------- versión inválida */

/**
 * Rompe UNA regla del elemento. Se elige con el mismo generador, así que la semilla también decide
 * qué regla se rompe: el mismo lote inválido falla siempre por lo mismo.
 */
function breakOne(rng, item, rules) {
  const rule = rng.pick(rules);
  rule.apply(item);
  return { ...item, _invalid: { field: rule.field, reason: rule.reason } };
}

const PERSON_BREAKS = [
  {
    field: "email",
    reason: "Correo sin @.",
    apply: (item) => (item.email = item.email.replace("@", "")),
  },
  {
    field: "phone",
    reason: "Teléfono demasiado corto (menos de 6 caracteres).",
    apply: (item) => (item.phone = "+591"),
  },
  {
    field: "documentNumber",
    reason: "Carnet de menos de 3 caracteres.",
    apply: (item) => (item.documentNumber = "12"),
  },
  {
    field: "birthDate",
    reason: "Menor de edad en la fecha de referencia.",
    apply: (item) => {
      item.birthDate = "2012-06-15";
      item.age = 13;
    },
  },
  {
    field: "firstName",
    reason: "Nombre vacío.",
    apply: (item) => (item.firstName = ""),
  },
];

/* ------------------------------------------------------------------ tipos */

export const FAKER_TYPES = [
  {
    type: "persona",
    label: "Persona",
    description:
      "Una persona boliviana ficticia completa: nombre, carnet, fecha de nacimiento, teléfono, correo y dirección.",
    params: [
      {
        name: "edadMin",
        label: "Edad mínima",
        kind: "int",
        default: 18,
        min: 0,
        max: 100,
        help: "Años cumplidos al 1 de enero de 2026.",
      },
      {
        name: "edadMax",
        label: "Edad máxima",
        kind: "int",
        default: 65,
        min: 0,
        max: 100,
        help: "Tiene que ser mayor o igual a la mínima.",
      },
      {
        name: "genero",
        label: "Género",
        kind: "enum",
        default: "cualquiera",
        options: [
          { value: "cualquiera", label: "Cualquiera" },
          { value: "F", label: "Femenino" },
          { value: "M", label: "Masculino" },
        ],
      },
      {
        name: "departamento",
        label: "Departamento",
        kind: "enum",
        default: "cualquiera",
        options: DEPARTMENT_OPTIONS,
        help: "Define la extensión del carnet y la ciudad.",
      },
      {
        name: "complemento",
        label: "Complemento del carnet",
        kind: "enum",
        default: "a veces",
        options: [
          { value: "a veces", label: "A veces (15 %)" },
          { value: "siempre", label: "Siempre" },
          { value: "nunca", label: "Nunca" },
        ],
        help: "El complemento (p. ej. 1A) distingue carnets con el mismo número.",
      },
      EMAIL_DOMAIN_PARAM,
    ],
    fields: [
      "firstName",
      "secondName",
      "lastName",
      "secondLastName",
      "fullName",
      "gender",
      "birthDate",
      "age",
      "documentType",
      "documentNumber",
      "documentComplement",
      "documentExtension",
      "phone",
      "phoneOperator",
      "email",
      "city",
      "department",
      "address",
    ],
    generate: (rng, params, variant) => {
      const person = personFor(rng, params, variant);
      return variant === "invalido"
        ? breakOne(rng.fork("invalido"), person, PERSON_BREAKS)
        : person;
    },
  },
  {
    type: "documento",
    label: "Carnet de identidad",
    description: "Número de carnet, complemento y departamento de expedición.",
    params: [
      {
        name: "departamento",
        label: "Departamento de expedición",
        kind: "enum",
        default: "cualquiera",
        options: DEPARTMENT_OPTIONS,
      },
      {
        name: "complemento",
        label: "Complemento",
        kind: "enum",
        default: "a veces",
        options: [
          { value: "a veces", label: "A veces (15 %)" },
          { value: "siempre", label: "Siempre" },
          { value: "nunca", label: "Nunca" },
        ],
      },
    ],
    fields: [
      "documentType",
      "documentNumber",
      "documentComplement",
      "documentExtension",
    ],
    generate: (rng, params, variant) => {
      const document = documentFor(rng, params);
      if (variant === "frontera")
        document.documentNumber = document.documentNumber.slice(0, 5);
      if (variant === "invalido") {
        return breakOne(rng.fork("invalido"), document, [
          {
            field: "documentNumber",
            reason: "Carnet de menos de 3 caracteres.",
            apply: (item) => (item.documentNumber = "12"),
          },
          {
            field: "documentComplement",
            reason: "Complemento de más de 10 caracteres.",
            apply: (item) => (item.documentComplement = "COMPLEMENTO-LARGO"),
          },
        ]);
      }
      return document;
    },
  },
  {
    type: "telefono",
    label: "Teléfono móvil",
    description:
      "Celular boliviano en la serie de pruebas 6999/7999/7998, con su operador.",
    params: [
      {
        name: "formato",
        label: "Formato",
        kind: "enum",
        default: "internacional",
        options: [
          { value: "internacional", label: "Internacional (+591…)" },
          { value: "nacional", label: "Nacional (8 dígitos)" },
        ],
      },
    ],
    fields: ["phone", "operator"],
    generate: (rng, params, variant) => {
      const phone = phoneNumber(rng);
      const item = {
        phone: params.formato === "nacional" ? phone.national : phone.e164,
        operator: phone.operator,
      };
      if (variant === "invalido")
        return breakOne(rng.fork("invalido"), item, [
          {
            field: "phone",
            reason: "Teléfono de 4 dígitos.",
            apply: (it) => (it.phone = rng.digits(4)),
          },
        ]);
      return item;
    },
  },
  {
    type: "correo",
    label: "Correo electrónico",
    description: "Correo único en un dominio que no existe en internet.",
    params: [EMAIL_DOMAIN_PARAM],
    fields: ["email"],
    generate: (rng, params, variant) => {
      const gender = rng.pick(["F", "M"]);
      const item = {
        email: emailFor(
          rng,
          rng.pick(gender === "F" ? FEMALE_NAMES : MALE_NAMES),
          rng.pick(LAST_NAMES),
          params.dominioCorreo,
        ),
      };
      if (variant === "invalido")
        return breakOne(rng.fork("invalido"), item, [
          {
            field: "email",
            reason: "Correo sin @.",
            apply: (it) => (it.email = it.email.replace("@", "")),
          },
        ]);
      return item;
    },
  },
  {
    type: "direccion",
    label: "Dirección",
    description:
      "Calle, número, zona, ciudad y coordenadas cerca del centro de la ciudad.",
    params: [
      {
        name: "departamento",
        label: "Departamento",
        kind: "enum",
        default: "cualquiera",
        options: DEPARTMENT_OPTIONS,
      },
    ],
    fields: [
      "street",
      "streetNumber",
      "zone",
      "city",
      "department",
      "departmentCode",
      "country",
      "latitude",
      "longitude",
    ],
    generate: (rng, params) => addressFor(rng, params.departamento),
  },
  {
    type: "dispositivo",
    label: "Dispositivo móvil",
    description:
      "Huella y ficha del celular desde el que se hace una solicitud.",
    params: [
      {
        name: "plataforma",
        label: "Plataforma",
        kind: "enum",
        default: "cualquiera",
        options: [
          { value: "cualquiera", label: "Cualquiera" },
          { value: "android", label: "Android" },
          { value: "ios", label: "iPhone" },
        ],
      },
      {
        name: "riesgo",
        label: "Riesgo",
        kind: "enum",
        default: "limpio",
        options: [
          { value: "limpio", label: "Limpio" },
          { value: "sospechoso", label: "Sospechoso (VPN, root o emulador)" },
        ],
        help: "Un dispositivo sospechoso debería disparar las reglas de fraude.",
      },
    ],
    fields: [
      "deviceFingerprintHash",
      "fingerprintVersion",
      "channel",
      "userAgent",
      "snapshot",
    ],
    generate: (rng, params) => deviceFor(rng, params),
  },
  {
    type: "perfilFinanciero",
    label: "Perfil financiero",
    description:
      "Tipo de empleo, empleador, antigüedad, ingresos y gastos mensuales en bolivianos.",
    params: [
      {
        name: "ingresoMin",
        label: "Ingreso mínimo (Bs)",
        kind: "int",
        default: 2500,
        min: 0,
        max: 1_000_000,
      },
      {
        name: "ingresoMax",
        label: "Ingreso máximo (Bs)",
        kind: "int",
        default: 15000,
        min: 0,
        max: 1_000_000,
        help: "Tiene que ser mayor o igual al mínimo.",
      },
    ],
    fields: [
      "employmentType",
      "employerName",
      "yearsEmployed",
      "monthlyIncome",
      "monthlyExpenses",
      "currency",
    ],
    generate: (rng, params, variant) => {
      const financial = financialFor(rng, params, variant);
      if (variant === "invalido")
        return breakOne(rng.fork("invalido"), financial, [
          {
            field: "monthlyIncome",
            reason: "Ingreso negativo.",
            apply: (it) => (it.monthlyIncome = -1),
          },
        ]);
      return financial;
    },
  },
  {
    type: "cuentaBancaria",
    label: "Cuenta bancaria",
    description: "Banco boliviano, tipo y número de cuenta, moneda y titular.",
    params: [],
    fields: [
      "bankCode",
      "bankName",
      "accountType",
      "accountNumber",
      "currency",
      "holderName",
    ],
    generate: (rng) => {
      const holder = personFor(
        rng.fork("titular"),
        {
          edadMin: 18,
          edadMax: 65,
          genero: "cualquiera",
          departamento: "cualquiera",
          complemento: "nunca",
          dominioCorreo: "qa.atlas.test",
        },
        "valido",
      );
      return bankAccountFor(rng, holder.fullName);
    },
  },
  {
    type: "comercio",
    label: "Comercio",
    description:
      "Un negocio ficticio: razón social, NIT, rubro (MCC), contacto, dirección y representante legal.",
    params: [
      {
        name: "departamento",
        label: "Departamento",
        kind: "enum",
        default: "cualquiera",
        options: DEPARTMENT_OPTIONS,
      },
      EMAIL_DOMAIN_PARAM,
    ],
    fields: [
      "legalName",
      "tradeName",
      "nit",
      "businessCategory",
      "mcc",
      "phone",
      "email",
      "address",
      "city",
      "department",
      "legalRepresentative",
    ],
    generate: (rng, params, variant) => {
      const merchant = merchantFor(rng, params);
      if (variant === "invalido")
        return breakOne(rng.fork("invalido"), merchant, [
          {
            field: "nit",
            reason: "NIT con letras.",
            apply: (it) => (it.nit = "NIT-INVALIDO"),
          },
        ]);
      return merchant;
    },
  },
  {
    type: "monto",
    label: "Monto",
    description: "Un importe en la moneda y el rango indicados.",
    params: [
      {
        name: "minimo",
        label: "Mínimo",
        kind: "number",
        default: 100,
        min: 0,
        max: 10_000_000,
      },
      {
        name: "maximo",
        label: "Máximo",
        kind: "number",
        default: 5000,
        min: 0,
        max: 10_000_000,
        help: "Tiene que ser mayor o igual al mínimo.",
      },
      {
        name: "moneda",
        label: "Moneda",
        kind: "enum",
        default: "BOB",
        options: [
          { value: "BOB", label: "Bolivianos (BOB)" },
          { value: "USD", label: "Dólares (USD)" },
        ],
      },
      {
        name: "decimales",
        label: "Decimales",
        kind: "int",
        default: 2,
        min: 0,
        max: 2,
      },
    ],
    fields: ["amount", "currency"],
    generate: (rng, params, variant) => {
      let amount = rng.float(params.minimo, params.maximo, params.decimales);
      if (variant === "frontera")
        amount = rng.bool() ? params.minimo : params.maximo;
      if (variant === "invalido")
        return {
          amount: -Math.abs(amount || 1),
          currency: params.moneda,
          _invalid: { field: "amount", reason: "Monto negativo." },
        };
      return { amount, currency: params.moneda };
    },
  },
  {
    type: "fecha",
    label: "Fecha",
    description: "Una fecha entre dos límites, en formato AAAA-MM-DD.",
    params: [
      { name: "desde", label: "Desde", kind: "date", default: "2025-01-01" },
      {
        name: "hasta",
        label: "Hasta",
        kind: "date",
        default: "2026-12-31",
        help: "Tiene que ser posterior o igual a «Desde».",
      },
    ],
    fields: ["date"],
    generate: (rng, params, variant) => {
      const from = Date.parse(`${params.desde}T00:00:00Z`);
      const to = Date.parse(`${params.hasta}T00:00:00Z`);
      const days = Math.round((to - from) / 86_400_000);
      let offset = rng.int(0, days);
      if (variant === "frontera") offset = rng.bool() ? 0 : days;
      if (variant === "invalido")
        return {
          date: `${params.hasta.slice(0, 4)}-13-45`,
          _invalid: {
            field: "date",
            reason: "Mes 13 y día 45: no es una fecha.",
          },
        };
      return {
        date: new Date(from + offset * 86_400_000).toISOString().slice(0, 10),
      };
    },
  },
  {
    type: "caso",
    label: "Caso completo de cliente",
    description:
      "Todo lo que necesita un alta o una solicitud de crédito, coherente entre sí: persona, dirección, dispositivo, perfil financiero y cuenta bancaria a su nombre.",
    params: [
      {
        name: "edadMin",
        label: "Edad mínima",
        kind: "int",
        default: 18,
        min: 0,
        max: 100,
        help: "Años cumplidos al 1 de enero de 2026.",
      },
      {
        name: "edadMax",
        label: "Edad máxima",
        kind: "int",
        default: 65,
        min: 0,
        max: 100,
      },
      {
        name: "departamento",
        label: "Departamento",
        kind: "enum",
        default: "cualquiera",
        options: DEPARTMENT_OPTIONS,
      },
      {
        name: "ingresoMin",
        label: "Ingreso mínimo (Bs)",
        kind: "int",
        default: 2500,
        min: 0,
        max: 1_000_000,
      },
      {
        name: "ingresoMax",
        label: "Ingreso máximo (Bs)",
        kind: "int",
        default: 15000,
        min: 0,
        max: 1_000_000,
      },
      {
        name: "riesgo",
        label: "Riesgo del dispositivo",
        kind: "enum",
        default: "limpio",
        options: [
          { value: "limpio", label: "Limpio" },
          { value: "sospechoso", label: "Sospechoso (VPN, root o emulador)" },
        ],
      },
      EMAIL_DOMAIN_PARAM,
    ],
    fields: [
      "persona",
      "direccion",
      "dispositivo",
      "perfilFinanciero",
      "cuentaBancaria",
    ],
    generate: (rng, params, variant) => {
      const personParams = {
        ...params,
        genero: "cualquiera",
        complemento: "a veces",
      };
      const persona = personFor(rng.fork("persona"), personParams, variant);
      const direccion = addressFor(rng.fork("direccion"), params.departamento);
      persona.city = direccion.city;
      persona.department = direccion.department;
      persona.address = `${direccion.street} ${direccion.streetNumber}, ${direccion.zone}`;
      const item = {
        persona:
          variant === "invalido"
            ? breakOne(rng.fork("invalido"), persona, PERSON_BREAKS)
            : persona,
        direccion,
        dispositivo: deviceFor(rng.fork("dispositivo"), {
          plataforma: "cualquiera",
          riesgo: params.riesgo,
        }),
        perfilFinanciero: financialFor(rng.fork("financiero"), params, variant),
        cuentaBancaria: bankAccountFor(rng.fork("cuenta"), persona.fullName),
      };
      if (item.persona._invalid)
        item._invalid = {
          ...item.persona._invalid,
          field: `persona.${item.persona._invalid.field}`,
        };
      return item;
    },
  },
];

/** Reglas entre parámetros que un esquema por campo no puede expresar. */
export const CROSS_PARAM_RULES = [
  {
    a: "edadMin",
    b: "edadMax",
    detail: "La edad mínima no puede ser mayor que la máxima.",
  },
  {
    a: "ingresoMin",
    b: "ingresoMax",
    detail: "El ingreso mínimo no puede ser mayor que el máximo.",
  },
  {
    a: "minimo",
    b: "maximo",
    detail: "El mínimo no puede ser mayor que el máximo.",
  },
  {
    a: "desde",
    b: "hasta",
    detail: "«Desde» no puede ser posterior a «Hasta».",
  },
];

export function findFakerType(type) {
  return FAKER_TYPES.find((entry) => entry.type === type) ?? null;
}
