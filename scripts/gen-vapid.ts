/**
 * @fileoverview Prints a fresh VAPID key pair. The public key is not secret;
 * keep the private key only as a Worker secret
 * (`npx wrangler secret put VAPID_PRIVATE_KEY`), never in git.
 * Usage: npm run gen:vapid
 */

import {generateVapidKeys} from '../src/core/webpush.ts';

const {publicKey, privateKey} = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
