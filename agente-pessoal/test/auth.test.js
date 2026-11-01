import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionValue, safeEqual, readCookie, sessionCookie } from '../src/auth.js';

test('sessao depende da senha: trocar a senha invalida cookies antigos', () => {
  assert.notEqual(sessionValue('senha-um'), sessionValue('senha-dois'));
  assert.equal(sessionValue('x'), sessionValue('x'));
});
test('safeEqual rejeita vazio e tamanhos diferentes', () => {
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('abc', 'abc'), true);
});
test('readCookie acha o cookie entre varios', () => {
  assert.equal(readCookie('a=1; agenda_session=xyz; b=2', 'agenda_session'), 'xyz');
  assert.equal(readCookie('', 'agenda_session'), '');
});
test('cookie e HttpOnly, dura 1 ano e so recebe Secure em https', () => {
  assert.match(sessionCookie('s', false), /HttpOnly.*SameSite=Lax$/);
  assert.match(sessionCookie('s', false), /Max-Age=31536000/);
  assert.match(sessionCookie('s', true), /; Secure$/);
});
