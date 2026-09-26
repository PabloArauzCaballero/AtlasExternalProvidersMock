/**
 * Datos de referencia de Bolivia con los que se arman los fakers. Son listas, no personas: ningún
 * nombre, carnet o teléfono generado corresponde a alguien concreto.
 *
 * Sobre los teléfonos: se generan en la serie móvil `6999xxxx`/`7999xxxx`. No existe en Bolivia un
 * rango reservado para ficción, así que se usa uno estrecho y poco asignado, y además los entornos
 * QA entregan las notificaciones al buzón del emulador (`/mock/inbox`), no a un operador real.
 */

export const DEPARTMENTS = [
  { code: "LP", name: "La Paz", city: "La Paz", lat: -16.5, lon: -68.15 },
  {
    code: "CB",
    name: "Cochabamba",
    city: "Cochabamba",
    lat: -17.3935,
    lon: -66.157,
  },
  {
    code: "SC",
    name: "Santa Cruz",
    city: "Santa Cruz de la Sierra",
    lat: -17.7833,
    lon: -63.1821,
  },
  { code: "OR", name: "Oruro", city: "Oruro", lat: -17.9667, lon: -67.1167 },
  { code: "PT", name: "Potosí", city: "Potosí", lat: -19.5836, lon: -65.7531 },
  {
    code: "CH",
    name: "Chuquisaca",
    city: "Sucre",
    lat: -19.0333,
    lon: -65.2627,
  },
  { code: "TJ", name: "Tarija", city: "Tarija", lat: -21.5355, lon: -64.7296 },
  { code: "BE", name: "Beni", city: "Trinidad", lat: -14.8333, lon: -64.9 },
  { code: "PD", name: "Pando", city: "Cobija", lat: -11.0267, lon: -68.7692 },
];

export const FEMALE_NAMES = [
  "María",
  "Ana",
  "Lucía",
  "Carla",
  "Gabriela",
  "Daniela",
  "Fernanda",
  "Valeria",
  "Paola",
  "Andrea",
  "Rocío",
  "Mariela",
  "Silvia",
  "Patricia",
  "Claudia",
  "Verónica",
  "Jimena",
  "Natalia",
  "Ximena",
  "Camila",
  "Sofía",
  "Isabel",
  "Rosario",
  "Beatriz",
  "Wendy",
  "Noemí",
  "Judith",
  "Mónica",
  "Elizabeth",
  "Tatiana",
];

export const MALE_NAMES = [
  "Juan",
  "Carlos",
  "Luis",
  "Jorge",
  "Marco",
  "Diego",
  "Fernando",
  "Álvaro",
  "Rodrigo",
  "Sergio",
  "Miguel",
  "José",
  "Mauricio",
  "Gonzalo",
  "Óscar",
  "Ramiro",
  "Wilson",
  "Edwin",
  "Freddy",
  "Rubén",
  "Pablo",
  "Andrés",
  "Ricardo",
  "Hugo",
  "Víctor",
  "Javier",
  "Daniel",
  "Raúl",
  "Ernesto",
  "Iván",
];

export const LAST_NAMES = [
  "Mamani",
  "Quispe",
  "Flores",
  "Choque",
  "Condori",
  "Vargas",
  "Rojas",
  "Gutiérrez",
  "Fernández",
  "López",
  "García",
  "Rodríguez",
  "Pérez",
  "Torrez",
  "Mendoza",
  "Chávez",
  "Guzmán",
  "Suárez",
  "Céspedes",
  "Justiniano",
  "Arce",
  "Paz",
  "Soliz",
  "Aguilar",
  "Ticona",
  "Huanca",
  "Villarroel",
  "Salazar",
  "Montaño",
  "Ribera",
  "Zambrana",
  "Camacho",
  "Alanoca",
  "Cruz",
  "Limachi",
  "Mercado",
  "Terrazas",
  "Saavedra",
  "Antelo",
  "Moreno",
];

export const STREETS = [
  "Av. 6 de Agosto",
  "Calle Comercio",
  "Av. Ballivián",
  "Av. América",
  "Calle Sucre",
  "Av. Banzer",
  "Av. Busch",
  "Calle Junín",
  "Av. Heroínas",
  "Calle Bolívar",
  "Av. Blanco Galindo",
  "Av. Monseñor Rivero",
  "Calle Potosí",
  "Av. Arce",
  "Calle Ayacucho",
  "Av. Beni",
  "Av. Cristo Redentor",
  "Calle Ingavi",
];

export const ZONES = [
  "Centro",
  "Sopocachi",
  "Miraflores",
  "Calacoto",
  "Equipetrol",
  "Villa Fátima",
  "Queru Queru",
  "Plan 3000",
  "Alto Obrajes",
  "Villa 1ro de Mayo",
  "Cala Cala",
  "Zona Norte",
  "Zona Sur",
  "El Tejar",
];

export const OPERATORS = [
  { name: "Entel", prefix: "6999" },
  { name: "Tigo", prefix: "7999" },
  { name: "Viva", prefix: "7998" },
];

export const BANKS = [
  { code: "BNB", name: "Banco Nacional de Bolivia" },
  { code: "BME", name: "Banco Mercantil Santa Cruz" },
  { code: "BUN", name: "Banco Unión" },
  { code: "BCP", name: "Banco de Crédito de Bolivia" },
  { code: "BIS", name: "Banco BISA" },
  { code: "BGA", name: "Banco Ganadero" },
  { code: "BEC", name: "Banco Económico" },
  { code: "BSO", name: "BancoSol" },
];

export const EMPLOYERS = [
  "Distribuidora El Sol S.R.L.",
  "Comercial Andina S.A.",
  "Transportes Illimani",
  "Constructora Chiquitana",
  "Farmacias Bienestar",
  "Industrias del Valle",
  "Servicios Educativos Horizonte",
  "Agroexport Oriente",
];

export const MERCHANT_CATEGORIES = [
  { code: "5411", label: "Supermercado y abarrotes" },
  { code: "5812", label: "Restaurante" },
  { code: "5912", label: "Farmacia" },
  { code: "5651", label: "Ropa y calzado" },
  { code: "5732", label: "Electrónica y celulares" },
  { code: "5251", label: "Ferretería" },
  { code: "7230", label: "Peluquería y estética" },
  { code: "5499", label: "Tienda de barrio" },
];

export const MERCHANT_NAME_PARTS = {
  first: [
    "Comercial",
    "Distribuidora",
    "Tienda",
    "Farmacia",
    "Ferretería",
    "Minimarket",
    "Boutique",
    "Importadora",
  ],
  second: [
    "San Miguel",
    "El Progreso",
    "La Esperanza",
    "Los Andes",
    "Illimani",
    "El Cruceño",
    "Santa Rosa",
    "La Estrella",
  ],
};

export const DEVICES = {
  android: [
    { brand: "Samsung", model: "Galaxy A54", versions: ["13", "14"] },
    { brand: "Samsung", model: "Galaxy A15", versions: ["14"] },
    { brand: "Xiaomi", model: "Redmi Note 13", versions: ["13", "14"] },
    { brand: "Motorola", model: "Moto G84", versions: ["13", "14"] },
    { brand: "Huawei", model: "Nova 11i", versions: ["12"] },
  ],
  ios: [
    { brand: "Apple", model: "iPhone 12", versions: ["17.6", "18.1"] },
    { brand: "Apple", model: "iPhone 13", versions: ["18.1", "18.4"] },
    { brand: "Apple", model: "iPhone 15", versions: ["18.4", "18.6"] },
  ],
};

/** Quita tildes y espacios: la parte local de un correo no debería depender de la codificación. */
export function asciiSlug(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
