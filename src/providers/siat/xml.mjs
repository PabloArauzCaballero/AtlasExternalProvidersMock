/**
 * Lector de XML plano para las facturas del SIN, sin dependencias.
 *
 * No es un parser general: las facturas de compra-venta son árboles de elementos sin atributos
 * con significado (salvo `xsi:nil`), sin CDATA ni espacios de nombres en los hijos. Lo que no
 * encaja en esa forma se rechaza con un error, que el emulador traduce a 939 (XML inválido), en
 * vez de adivinar.
 */

const ENTIDADES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodificar(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, cuerpo) => {
    if (cuerpo[0] === "#") {
      const codigo =
        cuerpo[1].toLowerCase() === "x"
          ? parseInt(cuerpo.slice(2), 16)
          : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : entera;
    }
    return ENTIDADES[cuerpo] ?? entera;
  });
}

/**
 * @returns {{nombre:string, nil:boolean, texto:string, hijos:Array}} el elemento raíz.
 * @throws {Error} si el documento no está bien formado.
 */
export function parsearXml(fuente) {
  const xml = String(fuente)
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  if (/<!\[CDATA\[|<!DOCTYPE/i.test(xml))
    throw new Error("CDATA y DOCTYPE no están admitidos");

  const etiqueta =
    /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  const pila = [];
  let raiz = null;
  let cursor = 0;
  let match;
  while ((match = etiqueta.exec(xml)) !== null) {
    const entre = xml.slice(cursor, match.index);
    if (/[<>]/.test(entre)) throw new Error("etiqueta mal formada");
    if (pila.length > 0) pila[pila.length - 1].texto += entre;
    else if (entre.trim() !== "")
      throw new Error("texto fuera del elemento raíz");
    cursor = etiqueta.lastIndex;

    const [, cierre, nombre, atributos, autocierre] = match;
    if (cierre) {
      const abierto = pila.pop();
      if (!abierto || abierto.nombre !== nombre)
        throw new Error(`cierre inesperado de <${nombre}>`);
      abierto.texto = decodificar(abierto.texto).trim();
      continue;
    }
    const nodo = {
      nombre,
      nil: /\bxsi:nil\s*=\s*"true"/.test(atributos),
      texto: "",
      hijos: [],
    };
    if (pila.length > 0) pila[pila.length - 1].hijos.push(nodo);
    else if (raiz) throw new Error("más de un elemento raíz");
    else raiz = nodo;
    if (!autocierre) pila.push(nodo);
  }
  if (xml.slice(cursor).trim() !== "") throw new Error("texto tras el cierre");
  if (pila.length > 0)
    throw new Error(`<${pila[pila.length - 1].nombre}> sin cerrar`);
  if (!raiz) throw new Error("documento vacío");
  return raiz;
}

/** Hijos de un elemento como objeto `{campo: valor|null}` (null = `xsi:nil` o vacío). */
export function camposDe(nodo) {
  const campos = {};
  for (const hijo of nodo.hijos) {
    if (hijo.hijos.length > 0) continue;
    campos[hijo.nombre] = hijo.nil || hijo.texto === "" ? null : hijo.texto;
  }
  return campos;
}

/**
 * Factura de compra-venta como `{ raiz, cabecera, detalle[] }`. Lanza si la forma no es la del
 * XSD (una cabecera, al menos un detalle).
 */
export function leerFactura(fuente) {
  const raiz = parsearXml(fuente);
  const cabeceras = raiz.hijos.filter((hijo) => hijo.nombre === "cabecera");
  const detalles = raiz.hijos.filter((hijo) => hijo.nombre === "detalle");
  if (cabeceras.length !== 1)
    throw new Error("la factura necesita una <cabecera>");
  if (detalles.length === 0)
    throw new Error("la factura necesita al menos un <detalle>");
  return {
    raiz: raiz.nombre,
    cabecera: camposDe(cabeceras[0]),
    detalle: detalles.map(camposDe),
  };
}
