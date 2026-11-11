import test from 'node:test';
import assert from 'node:assert/strict';
import { b64url, encryptPayload, vapidAuthorization, generateVapidKeys, sendPush } from '../src/core/webpush.js';

// Example from RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

function ecJwk(publicB64, privateB64) {
  const pub = b64url.decode(publicB64);
  return { kty: 'EC', crv: 'P-256', d: privateB64, x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)) };
}

async function ecdhPair(publicB64, privateB64) {
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    privateKey: await crypto.subtle.importKey('jwk', ecJwk(publicB64, privateB64), alg, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', b64url.decode(publicB64), alg, true, []),
  };
}

// Receiver side of RFC 8291, used only to prove that what we encrypt can be decrypted.
async function decrypt(body, uaPublicB64, uaPrivateB64, authB64) {
  const salt = body.subarray(0, 16);
  const keyLen = body[20];
  const asPublic = body.subarray(21, 21 + keyLen);
  const ua = await ecdhPair(uaPublicB64, uaPrivateB64);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const enc = new TextEncoder();
  const hkdf = async (s, ikm, info, len) => {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, k, len * 8));
  };
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...b64url.decode(uaPublicB64), ...asPublic]);
  const ikm = await hkdf(b64url.decode(authB64), shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.subarray(21 + keyLen)));
  assert.equal(plain.at(-1), 2, 'last-record delimiter');
  return new TextDecoder().decode(plain.subarray(0, -1));
}

test('encryptPayload reproduces the RFC 8291 Appendix A example byte for byte', async () => {
  const body = await encryptPayload(new TextEncoder().encode(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
    salt: b64url.decode(RFC.salt),
    localKeys: await ecdhPair(RFC.asPublic, RFC.asPrivate),
  });
  assert.equal(b64url.encode(body), RFC.body);
});

test('a message encrypted with random salt and ephemeral key decrypts on the receiver side', async () => {
  const text = JSON.stringify({ title: 'Sprzątanie', body: 'zażółć gęślą jaźń 🧹' });
  const body = await encryptPayload(new TextEncoder().encode(text), { p256dh: RFC.uaPublic, auth: RFC.auth });
  assert.equal(await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.auth), text);
});

test('vapidAuthorization produces a verifiable ES256 JWT with the right claims', async () => {
  const keys = await generateVapidKeys();
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://example.org' }, 1_800_000_000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(m, 'header shape');
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64url.decode(m[1]))), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64url.decode(m[2]))), {
    aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://example.org',
  });
  const pub = await crypto.subtle.importKey('raw', b64url.decode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64url.decode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(valid, 'signature verifies');
  assert.equal(b64url.decode(m[3]).length, 64, 'raw r||s signature');
});

test('sendPush posts an aes128gcm body with VAPID headers and reports gone subscriptions', async () => {
  const vapid = { ...(await generateVapidKeys()), subject: 'https://example.org' };
  const subscription = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };
  const calls = [];
  const fakeFetch = (status) => async (url, init) => { calls.push({ url, init }); return new Response(null, { status }); };

  const ok = await sendPush(subscription, { title: 'x' }, { vapid, topic: 'week-2026-11-09', urgency: 'high', fetch: fakeFetch(201) });
  assert.deepEqual(ok, { ok: true, status: 201, gone: false });
  const { url, init } = calls[0];
  assert.equal(url, subscription.endpoint);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-encoding'], 'aes128gcm');
  assert.equal(init.headers.ttl, String(12 * 3600));
  assert.equal(init.headers.urgency, 'high');
  assert.equal(init.headers.topic, 'week-2026-11-09');
  assert.match(init.headers.authorization, /^vapid t=/);
  assert.equal(await decrypt(init.body, RFC.uaPublic, RFC.uaPrivate, RFC.auth), '{"title":"x"}');

  assert.equal((await sendPush(subscription, {}, { vapid, fetch: fakeFetch(410) })).gone, true);
  assert.equal((await sendPush(subscription, {}, { vapid, fetch: fakeFetch(404) })).gone, true);
  assert.deepEqual(await sendPush(subscription, {}, { vapid, fetch: fakeFetch(429) }), { ok: false, status: 429, gone: false });
});
