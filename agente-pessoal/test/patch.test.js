import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEdit, validatePatch } from '../src/patch.js';

const ev = { kind: 'event', start_at: '2026-11-05T17:00:00.000Z', outlook_id: 'abc' };
const task = { kind: 'task', start_at: null, outlook_id: null };
const note = { kind: 'note', start_at: null, outlook_id: null };

test('mudar o titulo de um evento sincroniza com o Outlook', () => {
  const r = planEdit(ev, { title: 'Novo' });
  assert.deepEqual([r.syncOutlook, r.removeFromOutlook], [true, false]);
});
test('tirar o horario de um evento vira tarefa e remove do Outlook', () => {
  const r = planEdit(ev, { start_at: null });
  assert.equal(r.patch.kind, 'task');
  assert.deepEqual([r.syncOutlook, r.removeFromOutlook], [false, true]);
});
test('dar horario a uma tarefa vira evento e sincroniza', () => {
  const r = planEdit(task, { start_at: '2026-11-06T12:00:00.000Z' });
  assert.equal(r.patch.kind, 'event');
  assert.equal(r.syncOutlook, true);
});
test('anotacao continua anotacao e nunca vai ao Outlook', () => {
  const r = planEdit(note, { title: 'x', start_at: null });
  assert.equal(r.patch.kind, undefined);
  assert.deepEqual([r.syncOutlook, r.removeFromOutlook], [false, false]);
});
test('marcar como feito nao mexe no Outlook', () => {
  const r = planEdit(ev, { done: 1 });
  assert.deepEqual([r.syncOutlook, r.removeFromOutlook], [false, false]);
});
test('validacao: titulo vazio e data invalida', () => {
  assert.match(validatePatch({ title: '' }), /titulo/);
  assert.match(validatePatch({ start_at: 'invalid' }), /invalida/);
  assert.equal(validatePatch({ start_at: null, title: 'ok' }), null);
});
