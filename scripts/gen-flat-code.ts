/**
 * @fileoverview Prints a random flat code: 16 characters from a 31-letter
 * alphabet without look-alikes (about 79 bits), grouped for easy typing.
 * Usage: npm run gen:code
 */

import {randomInt} from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_LENGTH = 4;

const groups: string[] = [];
for (let group = 0; group < GROUPS; group++) {
  let text = '';
  for (let i = 0; i < GROUP_LENGTH; i++) {
    text += ALPHABET[randomInt(ALPHABET.length)];
  }
  groups.push(text);
}
console.log(groups.join('-'));
