// Usage: node scripts/gen-vapid.js
// Prints a fresh VAPID key pair. The public key is not secret; store the private key
// only as a Worker secret (wrangler secret put VAPID_PRIVATE_KEY), never in git.
import { generateVapidKeys } from '../src/core/webpush.js';

const { publicKey, privateKey } = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
