/**
 * TAR ustar mínimo, sin dependencias: lo justo para los paquetes de contingencia del SIN.
 *
 * El paquete es un `.tar.gz` con UN XML por factura (de ahí `numeroArchivo` en los mensajes y el
 * 985 «cantidad de facturas diferente a la declarada»). El emulador lo lee para contar y validar
 * cada factura; el escritor existe para las pruebas y el humo, y como referencia del formato que
 * tiene que producir el ERP.
 */

const BLOQUE = 512;

function octal(buffer, inicio, largo) {
  const texto = buffer
    .subarray(inicio, inicio + largo)
    .toString("latin1")
    .replace(/\0.*$/s, "")
    .trim();
  if (texto === "") return 0;
  if (!/^[0-7]+$/.test(texto))
    throw new Error("campo octal inválido en la cabecera tar");
  return parseInt(texto, 8);
}

function cadena(buffer, inicio, largo) {
  return buffer
    .subarray(inicio, inicio + largo)
    .toString("utf8")
    .replace(/\0.*$/s, "");
}

function sumaDeControl(cabecera) {
  let suma = 0;
  for (let i = 0; i < BLOQUE; i += 1)
    suma += i >= 148 && i < 156 ? 0x20 : cabecera[i];
  return suma;
}

/**
 * @returns {Array<{nombre:string, contenido:Buffer}>} los archivos regulares, en orden.
 * @throws {Error} si no es un tar válido (sumas de control, tamaños, final).
 */
export function leerTar(buffer) {
  const archivos = [];
  let posicion = 0;
  while (posicion + BLOQUE <= buffer.length) {
    const cabecera = buffer.subarray(posicion, posicion + BLOQUE);
    if (cabecera.every((byte) => byte === 0)) return archivos;
    if (octal(cabecera, 148, 8) !== sumaDeControl(cabecera))
      throw new Error("suma de control tar incorrecta");
    const tamano = octal(cabecera, 124, 12);
    const tipo = String.fromCharCode(cabecera[156] || 0x30);
    const prefijo = cadena(cabecera, 345, 155);
    const nombre = (prefijo ? `${prefijo}/` : "") + cadena(cabecera, 0, 100);
    const inicio = posicion + BLOQUE;
    if (inicio + tamano > buffer.length)
      throw new Error("archivo tar truncado");
    if (tipo === "0") {
      archivos.push({
        nombre,
        contenido: Buffer.from(buffer.subarray(inicio, inicio + tamano)),
      });
    }
    posicion = inicio + Math.ceil(tamano / BLOQUE) * BLOQUE;
  }
  throw new Error("tar sin bloques de cierre");
}

function escribirOctal(cabecera, inicio, largo, valor) {
  cabecera.write(
    valor.toString(8).padStart(largo - 1, "0") + "\0",
    inicio,
    largo,
    "latin1",
  );
}

/** @param {Array<{nombre:string, contenido:Buffer|string}>} archivos */
export function escribirTar(archivos) {
  const partes = [];
  for (const { nombre, contenido } of archivos) {
    const datos = Buffer.isBuffer(contenido)
      ? contenido
      : Buffer.from(contenido, "utf8");
    if (Buffer.byteLength(nombre) > 100)
      throw new Error("nombre de archivo tar demasiado largo");
    const cabecera = Buffer.alloc(BLOQUE);
    cabecera.write(nombre, 0, 100, "utf8");
    escribirOctal(cabecera, 100, 8, 0o644);
    escribirOctal(cabecera, 108, 8, 0);
    escribirOctal(cabecera, 116, 8, 0);
    escribirOctal(cabecera, 124, 12, datos.length);
    escribirOctal(cabecera, 136, 12, 0);
    cabecera.write("0", 156, 1, "latin1");
    cabecera.write("ustar\0", 257, 6, "latin1");
    cabecera.write("00", 263, 2, "latin1");
    cabecera.write(
      sumaDeControl(cabecera).toString(8).padStart(6, "0") + "\0 ",
      148,
      8,
      "latin1",
    );
    partes.push(cabecera, datos);
    const relleno = (BLOQUE - (datos.length % BLOQUE)) % BLOQUE;
    if (relleno) partes.push(Buffer.alloc(relleno));
  }
  partes.push(Buffer.alloc(BLOQUE * 2));
  return Buffer.concat(partes);
}
