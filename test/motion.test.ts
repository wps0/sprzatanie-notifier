import assert from 'node:assert/strict';
import test from 'node:test';

import type {Animatable} from '../src/web/motion.ts';
import {animate, doneKey, progressOf, trigger} from '../src/web/motion.ts';

function fakeElement(): Animatable & {classes: string[]} {
  const classes: string[] = [];
  return {
    classes,
    classList: {add: (...tokens: string[]) => classes.push(...tokens)},
    style: {animationDelay: ''},
  };
}

test('progressOf reports how far an animation has run, then forgets it', () => {
  trigger('a', 1000);
  assert.equal(progressOf('a', 400, 1000), 0);
  assert.equal(progressOf('a', 400, 1100), 0.25);
  assert.equal(progressOf('a', 400, 1400), null, 'finished');
  assert.equal(progressOf('a', 400, 1100), null, 'and forgotten');
  assert.equal(progressOf('never-started', 400, 1100), null);
});

test('a re-rendered element continues the animation where it was', () => {
  trigger('pop', 5000);
  const first = fakeElement();
  animate(first, 'pop', 'motion-safe:animate-pop', 450, 5000);
  assert.deepEqual(first.classes, ['motion-safe:animate-pop']);
  assert.equal(first.style.animationDelay, '0ms');

  const second = fakeElement();
  animate(second, 'pop', 'motion-safe:animate-pop', 450, 5300);
  assert.equal(second.style.animationDelay, '-300ms', 'no restart');

  const late = fakeElement();
  animate(late, 'pop', 'motion-safe:animate-pop', 450, 5500);
  assert.deepEqual(late.classes, [], 'nothing once finished');
  assert.equal(late.style.animationDelay, '');
});

test('several classes and restarts', () => {
  trigger('toast', 0);
  const element = fakeElement();
  animate(element, 'toast', 'a b', 280, 100);
  assert.deepEqual(element.classes, ['a', 'b']);
  trigger('toast', 200);
  const again = fakeElement();
  animate(again, 'toast', 'a', 280, 210);
  assert.equal(again.style.animationDelay, '-10ms', 'trigger restarts it');
});

test('doneKey names the animation per week and task', () => {
  assert.equal(doneKey('2026-11-09', 'lazienka'), 'done:2026-11-09|lazienka');
});
