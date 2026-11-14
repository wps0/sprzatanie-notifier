// Cross-checks src/core/webpush.js against independent implementations:
// - http_ece: the reference implementation of the aes128gcm content coding, written by the
//   author of RFC 8188 / RFC 8291. It is the encryption engine inside the `web-push` package.
// - Node's native crypto (OpenSSL) for the VAPID signature, instead of WebCrypto.
// Both are test-only; nothing here ships to the Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import ece from 'http_ece';
import { b64url, encryptPayload, vapidAuthorization, generateVapidKeys } from '../src/core/webpush.js';

const encoder = new TextEncoder();

function newReceiver() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

/** The same P-256 key pair as a Node ECDH object and as a WebCrypto key pair. */
async function newSender() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', d: ecdh.getPrivateKey().toString('base64url'), x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') };
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    ecdh,
    webcrypto: {
      privateKey: await crypto.subtle.importKey('jwk', jwk, alg, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', pub, alg, true, []),
    },
  };
}

const samples = ['', 'x', JSON.stringify({ title: 'Twój dyżur: łazienka', body: 'zażółć gęślą jaźń 🧹' }), 'a'.repeat(3990)];

test('the reference implementation decrypts what we encrypt', async () => {
  for (const text of samples) {
    const receiver = newReceiver();
    const body = await encryptPayload(encoder.encode(text), receiver.keys);
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: receiver.ecdh, authSecret: receiver.auth });
    assert.equal(plain.toString('utf8'), text);
  }
});

test('for the same key and salt our output equals the reference implementation byte for byte', async () => {
  for (let round = 0; round < 25; round++) {
    const receiver = newReceiver();
    const sender = await newSender();
    const salt = randomBytes(16);
    const data = randomBytes(1 + Math.floor(Math.random() * 3000));
    const expected = ece.encrypt(data, { version: 'aes128gcm', privateKey: sender.ecdh, dh: receiver.ecdh.getPublicKey(), authSecret: receiver.auth, salt });
    const actual = await encryptPayload(new Uint8Array(data), receiver.keys, { salt: new Uint8Array(salt), localKeys: sender.webcrypto });
    assert.equal(Buffer.from(actual).toString('hex'), expected.toString('hex'));
  }
});

test('a tampered message is rejected by the reference implementation', async () => {
  const receiver = newReceiver();
  const body = Buffer.from(await encryptPayload(encoder.encode('hello'), receiver.keys));
  body[body.length - 1] ^= 1;
  assert.throws(() => ece.decrypt(body, { version: 'aes128gcm', privateKey: receiver.ecdh, authSecret: receiver.auth }));
});

test('the VAPID token verifies with native (non-WebCrypto) ECDSA', async () => {
  const keys = await generateVapidKeys();
  const header = await vapidAuthorization('https://web.push.apple.com/abc', { ...keys, subject: 'https://example.org' });
  const [, token] = /^vapid t=([^,]+), k=/.exec(header);
  const [head, claims, signature] = token.split('.');
  const pub = b64url.decode(keys.publicKey);
  const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)) } });
  assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(parsed.aud, 'https://web.push.apple.com');
  assert.ok(parsed.exp - Math.floor(Date.now() / 1000) <= 24 * 3600, 'expiry within the 24 h the push services accept');
});
