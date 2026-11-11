// Minimal dependency-free XLSX reader.
// Uses only Web-standard APIs (DataView, TextDecoder, DecompressionStream, Blob, Response),
// so the same file runs unchanged in Cloudflare Workers and in Node >= 20.
//
// Scope: read cell values of the first worksheet. Styles, images, formulas and
// everything else in the workbook are ignored on purpose (formula cells are read
// through the cached value Excel stores next to the formula).

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** @typedef {{ method: number, csize: number, usize: number, offset: number }} ZipEntry */

/** List the entries of a ZIP archive (central directory only, no ZIP64). */
export function listZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx: not a ZIP archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  /** @type {Map<string, ZipEntry>} */
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('xlsx: corrupt ZIP central directory');
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    entries.set(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)), {
      method: dv.getUint16(p + 10, true),
      csize: dv.getUint32(p + 20, true),
      usize: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read one entry as text. Only "stored" (0) and "deflate" (8) are supported. */
export async function readZipText(bytes, entry) {
  if (entry.usize > MAX_ENTRY_BYTES) throw new Error('xlsx: entry too large');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('xlsx: corrupt ZIP local header');
  const start = entry.offset + 30 + dv.getUint16(entry.offset + 26, true) + dv.getUint16(entry.offset + 28, true);
  const raw = bytes.subarray(start, start + entry.csize);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) throw new Error(`xlsx: unsupported ZIP compression method ${entry.method}`);
  const inflated = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(inflated).text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e) => {
    if (e[0] !== '#') return ENTITIES[e] ?? whole;
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

function textRuns(xml) {
  let s = '';
  for (const t of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += decodeXml(t[1]);
  return s;
}

export function parseSharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si\s*\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) out.push(textRuns(m[1] ?? ''));
  return out;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26 */
export function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Parse worksheet XML into rows of cell values.
 * Value types: string | number | boolean. Empty cells and error cells (#VALUE! etc.) are absent.
 * @returns {{ r: number, cells: Map<number, string | number | boolean> }[]}
 */
export function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = new Map();
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = parseAttrs(cm[1]);
      const body = cm[2] ?? '';
      const ref = /^([A-Z]+)(\d+)$/.exec(a.r ?? '');
      if (!ref) continue;
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value;
      switch (a.t) {
        case 's': value = v === undefined ? undefined : sharedStrings[Number(v)]; break;
        case 'inlineStr': value = textRuns(body); break;
        case 'str': case 'd': value = v === undefined ? undefined : decodeXml(v); break;
        case 'b': value = v === undefined ? undefined : v === '1'; break;
        case 'e': value = undefined; break;
        default: value = v === undefined || v === '' ? undefined : Number(v);
      }
      if (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value))) continue;
      cells.set(colIndex(ref[1]), value);
    }
    rows.push({ r: Number(parseAttrs(rm[1]).r), cells });
  }
  return rows;
}

/** Read the first worksheet (first tab) of an XLSX file. */
export async function readFirstSheet(bytes) {
  const zip = listZip(bytes);
  const text = async (name) => {
    const entry = zip.get(name);
    return entry ? await readZipText(bytes, entry) : null;
  };
  const workbook = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('xlsx: workbook.xml missing — not an Excel file?');
  const sheet = parseAttrs(/<sheet\b([^>]*)>/.exec(workbook)?.[1] ?? '');
  let target = null;
  for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
    const a = parseAttrs(m[1]);
    if (a.Id === sheet['r:id']) target = a.Target;
  }
  if (!target) throw new Error('xlsx: cannot locate the first worksheet');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetXml = await text(path);
  if (!sheetXml) throw new Error(`xlsx: ${path} missing`);
  const shared = parseSharedStrings((await text('xl/sharedStrings.xml')) ?? '');
  return { name: sheet.name ?? '', rows: parseSheetXml(sheetXml, shared) };
}
