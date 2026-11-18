/** @fileoverview Build-time edits of the page for a given API location. */

const API_META = '<meta name="api-base-url" content="" />';
const CONNECT_SRC = "connect-src 'self'";

/**
 * Normalises `API_BASE_URL`: empty means "same origin"; anything else must be
 * an HTTPS URL (http://localhost is allowed for development).
 */
export function normalizeApiBaseUrl(raw: string | undefined): string {
  const text = (raw ?? '').trim().replace(/\/+$/, '');
  if (!text) return '';
  const url = new URL(text);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`API_BASE_URL must use HTTPS: ${text}`);
  }
  if (url.search || url.hash) {
    throw new Error(`API_BASE_URL must not have a query or hash: ${text}`);
  }
  return text;
}

/**
 * Points the page at the API and allows that origin in the Content Security
 * Policy. With an empty base URL the page is returned unchanged.
 */
export function prepareIndexHtml(html: string, apiBaseUrl: string): string {
  if (!html.includes(API_META) || !html.includes(CONNECT_SRC)) {
    throw new Error('index.html: api-base-url meta or CSP connect-src missing');
  }
  if (!apiBaseUrl) return html;
  const origin = new URL(apiBaseUrl).origin;
  return html
    .replace(API_META, `<meta name="api-base-url" content="${apiBaseUrl}" />`)
    .replace(CONNECT_SRC, `${CONNECT_SRC} ${origin}`);
}
