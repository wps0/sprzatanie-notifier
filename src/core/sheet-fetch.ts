/**
 * @fileoverview Downloads the workbook behind a public share link.
 *
 * SharePoint/OneDrive "anyone with the link" URLs answer the first request
 * with a redirect and `Set-Cookie: FedAuth=…`, and serve the file only when
 * that cookie comes back (otherwise 403). Browsers cannot do this
 * cross-origin (no CORS headers), so the download happens on the server and
 * redirects are followed by hand, carrying cookies per host. Plain direct
 * links go through the same loop and simply never set cookies.
 */

/** The part of `fetch` this module uses; tests pass a fake. */
export type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;

export interface DownloadOptions {
  readonly fetch?: Fetcher;
  readonly userAgent?: string;
}

export interface DownloadedWorkbook {
  readonly bytes: Uint8Array;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 6;
/** Every XLSX file is a ZIP archive and starts with "PK". */
const ZIP_MAGIC = [0x50, 0x4b];

/** Remembers cookies per host, the way a browser would for this flow. */
class CookieJar {
  private readonly byHost = new Map<string, Map<string, string>>();

  store(host: string, setCookieHeaders: readonly string[]): void {
    for (const header of setCookieHeaders) {
      const pair = header.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      let cookies = this.byHost.get(host);
      if (!cookies) {
        cookies = new Map();
        this.byHost.set(host, cookies);
      }
      cookies.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1).trim(),
      );
    }
  }

  header(host: string): string | null {
    const cookies = this.byHost.get(host);
    if (!cookies?.size) return null;
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export async function downloadWorkbook(
  sheetUrl: string,
  {
    fetch: doFetch = fetch,
    userAgent = 'schedule-fetcher/1.0',
  }: DownloadOptions = {},
): Promise<DownloadedWorkbook> {
  let url = new URL(sheetUrl);
  if (/(^|\.)sharepoint\.com$/.test(url.hostname)) {
    url.searchParams.set('download', '1');
  }
  const jar = new CookieJar();
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:') {
      throw new Error('sheet: refusing non-HTTPS URL');
    }
    const headers: Record<string, string> = {
      accept: '*/*',
      'user-agent': userAgent,
    };
    const cookie = jar.header(url.host);
    if (cookie) headers['cookie'] = cookie;
    const response = await doFetch(url, {redirect: 'manual', headers});
    jar.store(url.host, response.headers.getSetCookie?.() ?? []);

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      throw new Error(`sheet: HTTP ${response.status} from ${url.host}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('sheet: file too large');
    if (bytes[0] !== ZIP_MAGIC[0] || bytes[1] !== ZIP_MAGIC[1]) {
      throw new Error(
        'sheet: response is not an XLSX file (is the share link still public?)',
      );
    }
    return {
      bytes,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  }
  throw new Error('sheet: too many redirects');
}
