import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/ratelimit.js';

test('bloqueia apos o maximo de falhas e libera depois da janela', () => {
  const l = createLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) l.fail('1.1.1.1', 0);
  assert.equal(l.blocked('1.1.1.1', 500), true);
  assert.equal(l.blocked('2.2.2.2', 500), false);
  assert.equal(l.blocked('1.1.1.1', 1500), false);
});

test('login correto zera o contador', () => {
  const l = createLimiter({ max: 2, windowMs: 1000 });
  l.fail('a', 0); l.reset('a'); l.fail('a', 1);
  assert.equal(l.blocked('a', 2), false);
});
