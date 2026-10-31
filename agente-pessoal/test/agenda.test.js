import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/Sao_Paulo';
process.env.NTFY_TOPIC = '';
const { openDb, store } = await import('../src/db.js');
const { tick } = await import('../src/scheduler.js');
const { buildPlan, freeSlots } = await import('../src/planner.js');

const mem = () => store(openDb(':memory:'));

test('lembrete dispara uma unica vez na janela certa', async () => {
  const s = mem();
  const start = new Date('2026-11-02T13:00:00Z'); // 10:00 BRT
  s.create({ title: 'Dentista', start_at: start.toISOString(), remind_min: 15 });
  assert.equal(s.dueReminders(new Date('2026-11-02T12:40:00Z').toISOString()).length, 0);
  assert.equal(s.dueReminders(new Date('2026-11-02T12:50:00Z').toISOString()).length, 1);
  await tick(s, new Date('2026-11-02T12:50:00Z'));
  assert.equal(s.dueReminders(new Date('2026-11-02T12:51:00Z').toISOString()).length, 0);
});

test('nao avisa compromisso que ja terminou', () => {
  const s = mem();
  s.create({ title: 'Passado', start_at: '2026-11-02T13:00:00Z', duration_min: 30 });
  assert.equal(s.dueReminders('2026-11-02T14:00:00Z').length, 0);
});

test('mudar o horario rearma o lembrete', async () => {
  const s = mem();
  const i = s.create({ title: 'X', start_at: '2026-11-02T13:00:00Z' });
  await tick(s, new Date('2026-11-02T12:50:00Z'));
  s.update(i.id, { start_at: '2026-11-02T15:00:00Z' });
  assert.equal(s.get(i.id).reminded, 0);
});

test('resumo diario sai uma vez por dia', async () => {
  const s = mem();
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (...a) => { sent.push(a); return { ok: true }; };
  process.env.NTFY_TOPIC = 'x';
  try {
    const { config } = await import('../src/config.js');
    config.ntfy.topic = 'x';
    const t = new Date('2026-11-02T11:00:00Z'); // 08:00 BRT, apos 07:30
    await tick(s, t);
    await tick(s, new Date(t.getTime() + 60_000));
    assert.equal(sent.length, 1);
    await tick(s, new Date('2026-11-03T11:00:00Z'));
    assert.equal(sent.length, 2);
  } finally { globalThis.fetch = orig; }
});

test('plano lista compromissos, tarefas por prioridade e horarios livres', () => {
  const s = mem();
  s.create({ title: 'Reuniao', start_at: '2026-11-02T13:00:00Z', duration_min: 60 }); // 10-11 BRT
  s.create({ title: 'Baixa', priority: 3 });
  s.create({ title: 'Alta', priority: 1 });
  const p = buildPlan(s.list(), new Date('2026-11-02T10:00:00Z'));
  assert.match(p.text, /10:00 Reuniao/);
  assert.ok(p.text.indexOf('Alta') < p.text.indexOf('Baixa'));
  assert.match(p.text, /08:00 as 10:00/);
  assert.match(p.text, /11:00 as 18:00/);
});

test('freeSlots sem compromissos retorna o dia todo', () => {
  const [[a, b]] = freeSlots([], '2026-11-02');
  assert.equal((b - a) / 3_600_000, 10);
});
