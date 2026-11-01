import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/Sao_Paulo';
delete process.env.ANTHROPIC_API_KEY;
const { parseSimple, toItems, interpret, parseWithClaude } = await import('../src/nlp.js');

// quarta-feira, 04/11/2026 10:00 em Sao Paulo
const NOW = new Date('2026-11-04T13:00:00Z');
const one = (text) => parseSimple(text, NOW)[0];

test('simples: amanha com horario vira compromisso', () => {
  const e = one('Dentista amanhã às 14h');
  assert.deepEqual([e.kind, e.title, e.date, e.time], ['event', 'Dentista', '2026-11-05', '14:00']);
});

test('simples: dia da semana, horario com minutos e tarde', () => {
  assert.deepEqual([one('reunião sexta 9h30').date, one('reunião sexta 9h30').time], ['2026-11-06', '09:30']);
  assert.equal(one('jantar hoje às 8 da noite').time, '20:00');
});

test('simples: mesmo dia da semana vai para a proxima semana', () => {
  assert.equal(one('aula quarta 18h').date, '2026-11-11');
});

test('simples: data dd/mm e dia N', () => {
  assert.equal(one('prova 20/11 às 8h').date, '2026-11-20');
  assert.equal(one('pagar boleto dia 25').date, '2026-11-25');
});

test('simples: sem horario e tarefa; prioridade; anotacao', () => {
  const t = one('pagar conta de luz amanhã urgente');
  assert.deepEqual([t.kind, t.title, t.date, t.time, t.priority], ['task', 'Pagar conta de luz', '2026-11-05', null, 1]);
  const n = one('anotar ideia de post sobre vacinas');
  assert.equal(n.kind, 'note');
  assert.equal(n.title, 'Ideia de post sobre vacinas');
});

test('toItems: converte horario local para UTC e rebaixa evento sem horario para tarefa', () => {
  const [ev, tk, nt] = toItems([
    { kind: 'event', title: 'Dentista', date: '2026-11-05', time: '14:00', duration_min: 60, priority: 2, remind_min: null, details: null },
    { kind: 'event', title: 'Sem hora', date: '2026-11-05', time: null, duration_min: null, priority: null, remind_min: null, details: null },
    { kind: 'note', title: 'Ideia', date: null, time: null, duration_min: null, priority: 9, remind_min: null, details: 'x' },
  ]);
  assert.equal(ev.start_at, '2026-11-05T17:00:00.000Z');
  assert.equal(ev.duration_min, 60);
  assert.deepEqual([tk.kind, tk.due_date], ['task', '2026-11-05']);
  assert.deepEqual([nt.kind, nt.priority], ['note', 2]);
});

test('toItems: ignora entradas sem titulo e datas invalidas', () => {
  const r = toItems([{ kind: 'event', title: ' ', date: null, time: null }, { kind: 'event', title: 'X', date: '05/11', time: '25:99' }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'task');
  assert.equal(r[0].due_date, null);
});

test('claude: usa saida estruturada com o modelo e esforco baixo', async () => {
  let call;
  const fake = { messages: { parse: async (req) => { call = req;
    return { stop_reason: 'end_turn', parsed_output: { items: [{ kind: 'task', title: 'Ligar', date: null, time: null,
      duration_min: null, priority: null, remind_min: null, details: null }] } }; } } };
  const items = await parseWithClaude('ligar pro veterinario', NOW, fake);
  assert.equal(items[0].title, 'Ligar');
  assert.equal(call.model, 'claude-opus-5-5');
  assert.equal(call.output_config.effort, 'low');
  assert.match(call.messages[0].content, /2026-11-04/);
  assert.equal(call.tool_choice, undefined);
});

test('claude: recusa ou falha cai no interpretador simples', async () => {
  const bad = { messages: { parse: async () => ({ stop_reason: 'refusal', parsed_output: null }) } };
  const r = await interpret('dentista amanhã 14h', NOW, bad);
  assert.equal(r.ai, false);
  assert.equal(r.entries[0].kind, 'event');
});
