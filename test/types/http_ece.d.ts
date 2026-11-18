/**
 * @fileoverview The part of `http_ece` (the reference implementation of
 * RFC 8188 / RFC 8291, test-only) that the interoperability tests use.
 */

declare module 'http_ece' {
  import type {ECDH} from 'node:crypto';

  interface Parameters {
    version: 'aes128gcm';
    /** The local key pair: the receiver's when decrypting. */
    privateKey: ECDH;
    authSecret: Buffer;
    /** The peer's public key; needed only when encrypting. */
    dh?: Buffer;
    salt?: Buffer;
  }

  function encrypt(data: Buffer, parameters: Parameters): Buffer;
  function decrypt(data: Buffer, parameters: Parameters): Buffer;

  const ece: {encrypt: typeof encrypt; decrypt: typeof decrypt};
  export default ece;
}
