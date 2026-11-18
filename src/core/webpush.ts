/**
 * @fileoverview Web Push without dependencies: message encryption (RFC 8291,
 * the "aes128gcm" content coding of RFC 8188) and VAPID authentication
 * (RFC 8292), built on WebCrypto only. Runs unchanged in Cloudflare Workers
 * and in Node.
 *
 * No cryptographic algorithm is implemented here; the module only combines
 * WebCrypto primitives in the order the RFCs describe. The tests check it
 * against the RFC 8291 example and, byte for byte, against `http_ece`.
 */

/** Bytes backed by a plain ArrayBuffer, as WebCrypto expects. */
type Bytes = Uint8Array<ArrayBuffer>;

/** The keys of a browser push subscription, base64url-encoded. */
export interface SubscriptionKeys {
  readonly p256dh: string;
  readonly auth: string;
}

export interface PushTarget {
  readonly endpoint: string;
  readonly keys: SubscriptionKeys;
}

/** The application server's identity, base64url-encoded. */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

export interface VapidConfig extends VapidKeys {
  /** `mailto:…` or `https://…`: how push services can reach the sender. */
  readonly subject: string;
}

export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

/** The part of `fetch` this module uses; tests pass a fake. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface SendOptions {
  readonly vapid: VapidConfig;
  /** Seconds the push service keeps an undelivered message. */
  readonly ttl?: number;
  readonly urgency?: Urgency;
  /** Replaces an undelivered message with the same topic. */
  readonly topic?: string;
  readonly fetch?: Fetcher;
}

export interface SendResult {
  readonly ok: boolean;
  readonly status: number;
  /** The subscription no longer exists and should be deleted. */
  readonly gone: boolean;
}

/** Fixed inputs for tests that reproduce known vectors. Never in production. */
export interface EncryptTestOptions {
  readonly salt?: Bytes;
  readonly localKeys?: CryptoKeyPair;
}

const encoder = new TextEncoder();

const P256_PUBLIC_KEY_LENGTH = 65;
const AUTH_SECRET_LENGTH = 16;
const SALT_LENGTH = 16;
const RECORD_SIZE = 4096;
/** Largest plaintext that fits one 4096-byte record with overhead. */
const MAX_PLAINTEXT = 3990;
/** Push services reject tokens valid for more than 24 hours. */
const VAPID_TOKEN_SECONDS = 12 * 60 * 60;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

/** base64url without padding (RFC 4648 §5). */
export const b64url = {
  encode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  },

  decode(text: string): Bytes {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
};

function concat(...parts: readonly Uint8Array[]): Bytes {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hkdf(
  salt: Bytes,
  inputKey: Bytes,
  info: Bytes,
  length: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', inputKey, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {name: 'HKDF', hash: 'SHA-256', salt, info},
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** A private P-256 JWK from the base64url scalar and public point. */
function privateJwk(publicKey: string, privateKey: string): JsonWebKey {
  const point = b64url.decode(publicKey);
  if (point.length !== P256_PUBLIC_KEY_LENGTH || point[0] !== 4) {
    throw new Error(
      'webpush: public key must be a 65-byte uncompressed P-256 point',
    );
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: b64url.encode(point.subarray(1, 33)),
    y: b64url.encode(point.subarray(33, 65)),
    ext: true,
  };
}

/**
 * Encrypts a push message for one subscription (RFC 8291). Returns the
 * request body, to be sent with `Content-Encoding: aes128gcm`.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  keys: SubscriptionKeys,
  testOptions: EncryptTestOptions = {},
): Promise<Bytes> {
  const receiverPublic = b64url.decode(keys.p256dh);
  const authSecret = b64url.decode(keys.auth);
  if (
    receiverPublic.length !== P256_PUBLIC_KEY_LENGTH ||
    authSecret.length !== AUTH_SECRET_LENGTH
  ) {
    throw new Error('webpush: malformed subscription keys');
  }
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new Error('webpush: payload too large');
  }

  const salt =
    testOptions.salt ?? crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const local =
    testOptions.localKeys ??
    (await crypto.subtle.generateKey(
      {name: 'ECDH', namedCurve: 'P-256'},
      true,
      ['deriveBits'],
    ));
  const localPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', local.publicKey),
  );
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublic,
    {name: 'ECDH', namedCurve: 'P-256'},
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      {name: 'ECDH', public: receiverKey},
      local.privateKey,
      256,
    ),
  );

  const keyInfo = concat(
    encoder.encode('WebPush: info\0'),
    receiverPublic,
    localPublic,
  );
  const inputKey = await hkdf(authSecret, shared, keyInfo, 32);
  const contentKey = await hkdf(
    salt,
    inputKey,
    encoder.encode('Content-Encoding: aes128gcm\0'),
    16,
  );
  const nonce = await hkdf(
    salt,
    inputKey,
    encoder.encode('Content-Encoding: nonce\0'),
    12,
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    contentKey,
    'AES-GCM',
    false,
    ['encrypt'],
  );
  // One record: the plaintext followed by the 0x02 "last record" delimiter.
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      {name: 'AES-GCM', iv: nonce},
      aesKey,
      concat(plaintext, Uint8Array.of(2)),
    ),
  );

  const header = new Uint8Array(SALT_LENGTH + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(SALT_LENGTH, RECORD_SIZE);
  header[SALT_LENGTH + 4] = localPublic.length;
  return concat(header, localPublic, record);
}

/** The VAPID `Authorization` header value for a push endpoint (RFC 8292). */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(vapid.publicKey, vapid.privateKey),
    {name: 'ECDSA', namedCurve: 'P-256'},
    false,
    ['sign'],
  );
  const encodeJson = (value: object) =>
    b64url.encode(encoder.encode(JSON.stringify(value)));
  const claims = {
    aud: new URL(endpoint).origin,
    exp: nowSeconds + VAPID_TOKEN_SECONDS,
    sub: vapid.subject,
  };
  const unsigned = `${encodeJson({typ: 'JWT', alg: 'ES256'})}.${encodeJson(claims)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      {name: 'ECDSA', hash: 'SHA-256'},
      key,
      encoder.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${b64url.encode(signature)}, k=${vapid.publicKey}`;
}

/** Sends one push message; `message` reaches the service worker as JSON. */
export async function sendPush(
  subscription: PushTarget,
  message: unknown,
  {
    vapid,
    ttl = DEFAULT_TTL_SECONDS,
    urgency = 'normal',
    topic,
    fetch: doFetch = fetch,
  }: SendOptions,
): Promise<SendResult> {
  const body = await encryptPayload(
    encoder.encode(JSON.stringify(message)),
    subscription.keys,
  );
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(subscription.endpoint, vapid),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: String(ttl),
    urgency,
  };
  if (topic) headers['topic'] = topic;
  const response = await doFetch(subscription.endpoint, {
    method: 'POST',
    headers,
    body,
  });
  await response.body?.cancel();
  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
  };
}

/** A fresh VAPID key pair (run once; see `npm run gen:vapid`). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey(
    {name: 'ECDSA', namedCurve: 'P-256'},
    true,
    ['sign', 'verify'],
  );
  const publicKey = b64url.encode(
    new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  );
  const {d} = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!d) throw new Error('webpush: the runtime did not export the key');
  return {publicKey, privateKey: d};
}
