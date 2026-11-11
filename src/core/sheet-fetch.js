// Downloads the workbook behind a public share link.
//
// SharePoint / OneDrive "anyone with the link" URLs answer the first request with
// "302 + Set-Cookie: FedAuth=..." and only serve the file when that cookie is sent
// back (without it: 403). A browser cannot do this cross-origin (no CORS headers),
// which is why the download happens server-side. Redirects are therefore followed
// by hand, carrying cookies per host. Plain direct links (e.g. a Google Sheets
// ".../export?format=xlsx" URL) go through the same loop and simply never set cookies.

const MAX_BYTES = 5 * 1024 * 1024;

export async function downloadWorkbook(sheetUrl, { fetch: doFetch = fetch, userAgent = 'schedule-fetcher/1.0' } = {}) {
  let url = new URL(sheetUrl);
  if (/(^|\.)sharepoint\.com$/.test(url.hostname)) url.searchParams.set('download', '1');
  /** @type {Map<string, Map<string, string>>} */
  const jar = new Map();
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'https:') throw new Error('sheet: refusing non-HTTPS URL');
    const headers = { accept: '*/*', 'user-agent': userAgent };
    const cookies = jar.get(url.host);
    if (cookies?.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await doFetch(url, { redirect: 'manual', headers });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const pair = line.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      if (!jar.has(url.host)) jar.set(url.host, new Map());
      jar.get(url.host).set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`sheet: HTTP ${res.status} from ${url.host}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('sheet: file too large');
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('sheet: response is not an XLSX file (is the share link still public?)');
    }
    return { bytes, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  }
  throw new Error('sheet: too many redirects');
}
