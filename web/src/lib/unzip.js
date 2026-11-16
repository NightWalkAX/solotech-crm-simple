// Minimal .zip reader (stored + deflate) via the central directory; enough for WhatsApp chat exports.
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** → [{ name, read(): Promise<Uint8Array> }] */
export async function unzip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  let eocd = buf.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('El archivo no es un .zip válido');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({
      name,
      read: async () => {
        const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
        const data = buf.subarray(start, start + size);
        if (method === 0) return data;
        if (method === 8) return inflate(data);
        throw new Error(`Compresión no soportada en ${name}`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
