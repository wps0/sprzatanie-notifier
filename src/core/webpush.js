// Web Push without dependencies: message encryption (RFC 8291, "aes128gcm" coding
// from RFC 8188) and VAPID authentication (RFC 8292), built on WebCrypto only.
// Runs unchanged in Cloudflare Workers and Node >= 20.

const encoder = new TextEncoder();

export const b64url = {
  encode(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Private JWK for a P-256 key given as base64url scalar `d` plus the base64url uncompressed public point. */
function privateJwk(publicKeyB64, privateKeyB64) {
  const pub = b64url.decode(publicKeyB64);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('webpush: public key must be a 65-byte uncompressed P-256 point');
  return { kty: 'EC', crv: 'P-256', d: privateKeyB64, x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)), ext: true };
}

/**
 * Encrypt a push message body for one subscription (RFC 8291).
 * `opts.salt` / `opts.localKeys` exist only so tests can reproduce the RFC example; never pass them in production.
 * @param {Uint8Array} plaintext  at most ~3990 bytes
 * @param {{ p256dh: string, auth: string }} keys  as returned by PushSubscription.toJSON().keys
 * @returns {Promise<Uint8Array>} request body, to be sent with "Content-Encoding: aes128gcm"
 */
export async function encryptPayload(plaintext, keys, opts = {}) {
  const uaPublic = b64url.decode(keys.p256dh);
  const authSecret = b64url.decode(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('webpush: malformed subscription keys');
  if (plaintext.length > 3990) throw new Error('webpush: payload too large');

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const local = opts.localKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, localPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // A single record: plaintext followed by the 0x02 "last record" delimiter.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, Uint8Array.of(2))));

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096); // record size
  header[20] = localPublic.length;                 // key id length (65)
  return concat(header, localPublic, record);
}

/**
 * Build the VAPID "Authorization" header value for a push endpoint (RFC 8292).
 * @param {string} endpoint  subscription endpoint URL
 * @param {{ publicKey: string, privateKey: string, subject: string }} vapid  base64url keys; subject is "mailto:..." or "https://..."
 * @param {number} [nowSeconds]
 */
export async function vapidAuthorization(endpoint, vapid, nowSeconds = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('jwk', privateJwk(vapid.publicKey, vapid.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (obj) => b64url.encode(encoder.encode(JSON.stringify(obj)));
  // exp must be < 24h ahead; Apple rejects anything longer.
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: vapid.subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url.encode(signature)}, k=${vapid.publicKey}`;
}

/**
 * Send one push message.
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
 * @param {object} message  JSON-serialisable payload handed to the service worker's "push" event
 * @param {{ vapid: object, ttl?: number, urgency?: 'very-low'|'low'|'normal'|'high', topic?: string, fetch?: typeof fetch }} options
 * @returns {Promise<{ ok: boolean, status: number, gone: boolean }>}  gone=true -> delete the subscription
 */
export async function sendPush(subscription, message, { vapid, ttl = 12 * 3600, urgency = 'normal', topic, fetch: doFetch = fetch }) {
  const body = await encryptPayload(encoder.encode(JSON.stringify(message)), subscription.keys);
  const headers = {
    authorization: await vapidAuthorization(subscription.endpoint, vapid),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: String(ttl),
    urgency,
  };
  if (topic) headers.topic = topic;
  const res = await doFetch(subscription.endpoint, { method: 'POST', headers, body });
  await res.body?.cancel();
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

/** Generate a VAPID key pair as base64url strings (run once; see scripts/gen-vapid.js). */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey: d };
}
