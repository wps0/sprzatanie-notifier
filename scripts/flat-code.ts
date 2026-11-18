/** @fileoverview Random flat codes. */

import {randomInt} from 'node:crypto';

/** 31 characters without look-alikes (no i, l, o, 0, 1). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** 16 random characters (about 79 bits) in groups: `w9bs-u4qh-zaxk-s4aa`. */
export function generateFlatCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group++) {
    let text = '';
    for (let i = 0; i < GROUP_LENGTH; i++) {
      text += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(text);
  }
  return groups.join('-');
}
