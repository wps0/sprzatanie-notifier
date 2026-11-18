/**
 * @fileoverview Minimal XLSX reader without dependencies.
 *
 * Uses only Web-standard APIs (DataView, TextDecoder, DecompressionStream,
 * Blob, Response), so it runs unchanged in Cloudflare Workers and in Node.
 * It reads cell values of the first worksheet and nothing else: styles,
 * images and formulas are ignored on purpose. Formula cells are read through
 * the value Excel caches next to the formula.
 */

/** A cell's value. Empty and error cells (`#VALUE!` …) are left out. */
export type CellValue = string | number | boolean;

/** One worksheet row: its 1-based number and values by 0-based column. */
export interface SheetRow {
  readonly r: number;
  readonly cells: ReadonlyMap<number, CellValue>;
}

export interface Sheet {
  readonly name: string;
  readonly rows: readonly SheetRow[];
}

/** Location of one file inside a ZIP archive. */
export interface ZipEntry {
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const SIGNATURE_END_OF_DIRECTORY = 0x06054b50;
const SIGNATURE_DIRECTORY_ENTRY = 0x02014b50;
const SIGNATURE_LOCAL_HEADER = 0x04034b50;
const END_OF_DIRECTORY_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Lists the entries of a ZIP archive from its central directory (no ZIP64). */
export function listZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = viewOf(bytes);
  const last = bytes.length - END_OF_DIRECTORY_SIZE;
  let end = -1;
  for (let i = last; i >= Math.max(0, last - MAX_COMMENT_SIZE); i--) {
    if (view.getUint32(i, true) === SIGNATURE_END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('xlsx: not a ZIP archive');
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(position, true) !== SIGNATURE_DIRECTORY_ENTRY) {
      throw new Error('xlsx: corrupt ZIP central directory');
    }
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const nameStart = position + 46;
    entries.set(
      decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      {
        method: view.getUint16(position + 10, true),
        compressedSize: view.getUint32(position + 20, true),
        size: view.getUint32(position + 24, true),
        offset: view.getUint32(position + 42, true),
      },
    );
    position = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Reads one entry as text. Supports "stored" and "deflate" entries only. */
export async function readZipText(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<string> {
  if (entry.size > MAX_ENTRY_BYTES) throw new Error('xlsx: entry too large');
  const view = viewOf(bytes);
  if (view.getUint32(entry.offset, true) !== SIGNATURE_LOCAL_HEADER) {
    throw new Error('xlsx: corrupt ZIP local header');
  }
  const start =
    entry.offset +
    30 +
    view.getUint16(entry.offset + 26, true) +
    view.getUint16(entry.offset + 28, true);
  // Copied so that the Blob gets a plain ArrayBuffer-backed view.
  const raw = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === METHOD_STORED) return new TextDecoder().decode(raw);
  if (entry.method !== METHOD_DEFLATE) {
    throw new Error(`xlsx: unsupported ZIP compression method ${entry.method}`);
  }
  const inflated = new Blob([raw])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(inflated).text();
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decodes XML character and entity references; unknown ones stay as is. */
export function decodeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g,
    (whole, reference: string) => {
      if (reference[0] !== '#') return ENTITIES[reference] ?? whole;
      const codePoint =
        reference[1] === 'x'
          ? parseInt(reference.slice(2), 16)
          : parseInt(reference.slice(1), 10);
      return String.fromCodePoint(codePoint);
    },
  );
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

/** Concatenated `<t>` runs, without phonetic hints (`<rPh>`). */
function textRuns(xml: string): string {
  let text = '';
  const withoutHints = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  for (const run of withoutHints.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    text += decodeXml(run[1]);
  }
  return text;
}

export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(
    /<si\s*\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g,
  )) {
    strings.push(textRuns(match[1] ?? ''));
  }
  return strings;
}

/** Column letters to a 0-based index: "A" → 0, "Z" → 25, "AA" → 26. */
export function colIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function cellValue(
  type: string | undefined,
  body: string,
  sharedStrings: readonly string[],
): CellValue | undefined {
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
  switch (type) {
    case 's':
      return raw === undefined ? undefined : sharedStrings[Number(raw)];
    case 'inlineStr':
      return textRuns(body);
    case 'str':
    case 'd':
      return raw === undefined ? undefined : decodeXml(raw);
    case 'b':
      return raw === undefined ? undefined : raw === '1';
    case 'e':
      return undefined;
    default:
      return raw === undefined || raw === '' ? undefined : Number(raw);
  }
}

/** Parses worksheet XML into rows of cell values. */
export function parseSheetXml(
  xml: string,
  sharedStrings: readonly string[],
): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = new Map<number, CellValue>();
    for (const cell of (row[2] ?? '').matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attributes = parseAttributes(cell[1]);
      const reference = /^([A-Z]+)(\d+)$/.exec(attributes['r'] ?? '');
      if (!reference) continue;
      const value = cellValue(attributes['t'], cell[2] ?? '', sharedStrings);
      if (
        value === undefined ||
        value === '' ||
        (typeof value === 'number' && Number.isNaN(value))
      ) {
        continue;
      }
      cells.set(colIndex(reference[1]), value);
    }
    rows.push({r: Number(parseAttributes(row[1])['r']), cells});
  }
  return rows;
}

/** Reads the first worksheet (the first tab) of an XLSX file. */
export async function readFirstSheet(bytes: Uint8Array): Promise<Sheet> {
  const zip = listZip(bytes);
  const read = async (name: string): Promise<string | null> => {
    const entry = zip.get(name);
    return entry ? readZipText(bytes, entry) : null;
  };
  const workbook = await read('xl/workbook.xml');
  const relationships = await read('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) {
    throw new Error('xlsx: workbook.xml missing — not an Excel file?');
  }
  const sheet = parseAttributes(/<sheet\b([^>]*)>/.exec(workbook)?.[1] ?? '');
  let target: string | null = null;
  for (const match of relationships.matchAll(/<Relationship\b([^>]*)>/g)) {
    const relationship = parseAttributes(match[1]);
    if (relationship['Id'] === sheet['r:id']) {
      target = relationship['Target'] ?? null;
    }
  }
  if (!target) throw new Error('xlsx: cannot locate the first worksheet');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetXml = await read(path);
  if (!sheetXml) throw new Error(`xlsx: ${path} missing`);
  const shared = parseSharedStrings((await read('xl/sharedStrings.xml')) ?? '');
  return {name: sheet['name'] ?? '', rows: parseSheetXml(sheetXml, shared)};
}
