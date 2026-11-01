import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/Sao_Paulo';
delete process.env.ANTHROPIC_API_KEY;
const { openDb, store } = await import('../src/db.js');
const { parseSimple, toItems, findCategoryInText, parseWithClaude } = await import('../src/nlp.js');
const { buildPlan } = await import('../src/planner.js');
const { planEdit } = await import('../src/patch.js');

const mem = () => store(openDb(':memory:'));
const NOW = new Date('2026-11-04T13:00:00Z'); // quarta, 10:00 em Sao Paulo
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

test('banco novo ja vem com PUC Campinas, UNESP e CBEVET, uma unica vez', () => {
  const s = mem();
  assert.deepEqual(s.cats().map((c) => c.name).sort(), ['CBEVET', 'PUC Campinas', 'UNESP']);
});

test('nome de categoria e unico sem diferenciar maiusculas', () => {
  const s = mem();
  assert.throws(() => s.catCreate('unesp', '#000000'));
});

test('apagar a categoria deixa os itens sem categoria, sem apagar os itens', () => {
  const s = mem();
  const c = s.cats().find((x) => x.name === 'UNESP');
  const it = s.create({ title: 'Banca', category_id: c.id });
  assert.equal(s.get(it.id).category, 'UNESP');
  s.catRemove(c.id);
  assert.equal(s.get(it.id).category, null);
  assert.equal(s.get(it.id).title, 'Banca');
});

test('lembretes e plano mostram a categoria', () => {
  const s = mem();
  const c = s.cats().find((x) => x.name === 'CBEVET');
  s.create({ title: 'Aula', start_at: '2026-11-04T17:00:00Z', duration_min: 60, category_id: c.id });
  assert.equal(s.dueReminders('2026-11-04T16:50:00Z')[0].category, 'CBEVET');
  assert.match(buildPlan(s.list(), NOW).text, /\[CBEVET\] Aula/);
});

test('frase reconhece a sigla e a categoria', () => {
  const s = mem();
  const cats = s.cats();
  const e = parseSimple('reunião PUC amanhã às 10h', NOW, cats)[0];
  assert.equal(e.category, 'PUC Campinas');
  assert.equal(e.kind, 'event');
  const [it] = toItems([e], cats);
  assert.equal(it.category_id, cats.find((c) => c.name === 'PUC Campinas').id);
});

test('categoria so casa como palavra inteira e sem acento', () => {
  const cats = mem().cats();
  assert.equal(findCategoryInText(strip('corrigir provas da unesp'), cats)?.cat.name, 'UNESP');
  assert.equal(findCategoryInText(strip('comprar cbevetinho'), cats), null);
  assert.equal(findCategoryInText(strip('aula no CBEVET sexta'), cats)?.cat.name, 'CBEVET');
});

test('frase sem categoria fica sem categoria', () => {
  const cats = mem().cats();
  assert.equal(parseSimple('pagar conta de luz', NOW, cats)[0].category, null);
});

test('claude: categorias vao na mensagem e o nome devolvido vira id (ignorando maiusculas)', async () => {
  const cats = mem().cats();
  let call;
  const fake = { messages: { parse: async (req) => { call = req;
    return { stop_reason: 'end_turn', parsed_output: { items: [{ kind: 'task', title: 'Corrigir provas', date: null, time: null,
      duration_min: null, priority: null, remind_min: null, details: null, category: 'unesp' }] } }; } } };
  const entries = await parseWithClaude('corrigir provas da unesp', NOW, fake, cats);
  assert.match(call.messages[0].content, /Categorias: CBEVET; PUC Campinas; UNESP/);
  assert.equal(toItems(entries, cats)[0].category_id, cats.find((c) => c.name === 'UNESP').id);
});

test('categoria desconhecida devolvida pelo Claude e ignorada', () => {
  const cats = mem().cats();
  const [it] = toItems([{ kind: 'task', title: 'X', category: 'Inventada' }], cats);
  assert.equal(it.category_id, null);
});

test('trocar a categoria de um compromisso sincroniza com o Outlook', () => {
  const r = planEdit({ kind: 'event', start_at: '2026-11-05T17:00:00Z', outlook_id: 'a' }, { category_id: 2 });
  assert.equal(r.syncOutlook, true);
});

test('titulo nao fica com preposicao sobrando depois de tirar a sigla', () => {
  const cats = mem().cats();
  assert.equal(parseSimple('corrigir provas da UNESP', NOW, cats)[0].title, 'Corrigir provas');
  // se so sobrasse "Reunião", a sigla fica no titulo para ele nao perder o sentido; a categoria e marcada igual
  const r = parseSimple('reunião do CBEVET sexta 9h', NOW, cats)[0];
  assert.deepEqual([r.title, r.category], ['Reunião do CBEVET', 'CBEVET']);
});
