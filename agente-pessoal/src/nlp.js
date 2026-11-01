import { config } from './config.js';
import { dayKey, addDays, weekdayOf, zonedDate } from './planner.js';

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// ---------- Claude (interpretacao de verdade) ----------
const SYSTEM = `Voce organiza a agenda pessoal de uma usuaria brasileira. Ela envia frases curtas, \
digitadas ou ditadas por voz (a transcricao pode ter erros), e voce converte cada uma em itens.

Tipos de item:
- "event": compromisso com data E horario definidos (consulta, reuniao, aniversario com hora).
- "task": algo a fazer. Pode ter prazo (date) mas nao tem horario marcado.
- "note": informacao, ideia ou lembrete para guardar, sem acao a executar.

Regras:
- Datas relativas ("amanha", "sexta", "dia 15") partem da data e hora atuais informadas na mensagem.
- Nunca invente horario. Sem horario claro, o item e "task" (com date se houver prazo) ou "note".
- Uma frase pode conter varios itens; devolva um por item.
- "title" curto e claro, no imperativo ou como substantivo ("Dentista", "Pagar conta de luz"), \
mantendo nomes proprios. Sem a data e o horario no titulo.
- "date" em YYYY-MM-DD e "time" em HH:MM (24h), no fuso da usuaria. Use null quando nao houver.
- priority: 1 alta (urgente/importante), 2 normal, 3 baixa. duration_min so para events \
(consultas e reunioes 60 se nao informado, compromissos curtos 30). remind_min so se ela pedir aviso especifico.
- "details": contexto extra util (local, quem, observacoes) ou null.`;

export async function parseWithClaude(text, now, client) {
  if (!client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
  }
  const nowStr = now.toLocaleString('pt-BR', { timeZone: config.tz, dateStyle: 'full', timeStyle: 'short' });
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    max_tokens: 4096,
    system: SYSTEM,
    // esforco baixo: a tarefa e simples e a resposta precisa ser rapida
    output_config: { effort: 'low', format: await schemaFor() },
    messages: [{ role: 'user', content: `Agora: ${nowStr} (${config.tz}); hoje e ${dayKey(now)}.\n\nMensagem: ${text}` }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error('sem resposta utilizavel');
  return response.parsed_output.items;
}

function buildSchema(z, zodOutputFormat) {
  const Entry = z.object({
    kind: z.enum(['event', 'task', 'note']),
    title: z.string(),
    date: z.string().nullable(),
    time: z.string().nullable(),
    duration_min: z.number().nullable(),
    priority: z.number().nullable(),
    remind_min: z.number().nullable(),
    details: z.string().nullable(),
  });
  return zodOutputFormat(z.object({ items: z.array(Entry) }));
}
async function schemaFor() {
  const [{ zodOutputFormat }, { z }] = await Promise.all([import('@anthropic-ai/sdk/helpers/zod'), import('zod')]);
  return buildSchema(z, zodOutputFormat);
}

// ---------- Reserva simples (sem chave / se a API falhar) ----------
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseSimple(text, now = new Date()) {
  const base = text.normalize('NFC').trim();
  let plain = strip(base).toLowerCase();
  const cut = (m) => { // remove o trecho casado dos dois textos, mantendo os indices alinhados
    plain = plain.slice(0, m.index) + ' ' + plain.slice(m.index + m[0].length);
    work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length);
  };
  let work = base;
  const today = dayKey(now);
  let date = null, time = null, m;

  if ((m = plain.match(/\bdepois de amanha\b/))) { date = addDays(today, 2); cut(m); }
  else if ((m = plain.match(/\bamanha\b/))) { date = addDays(today, 1); cut(m); }
  else if ((m = plain.match(/\bhoje\b/))) { date = today; cut(m); }
  else if ((m = plain.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
    date = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    if (!m[3] && date < today) date = date.replace(/^\d{4}/, y + 1);
    cut(m);
  } else if ((m = plain.match(/\bdia (\d{1,2})\b/))) {
    const [y, mo] = today.split('-');
    date = `${y}-${mo}-${String(m[1]).padStart(2, '0')}`;
    if (date < today) { const nx = addDays(`${y}-${mo}-28`, 5).slice(0, 7); date = `${nx}-${String(m[1]).padStart(2, '0')}`; }
    cut(m);
  } else if ((m = plain.match(new RegExp(`\\b(${WEEKDAYS.join('|')})(?:-feira)?\\b`)))) {
    const want = WEEKDAYS.indexOf(m[1]);
    const diff = ((want - weekdayOf(today) + 7) % 7) || 7;
    date = addDays(today, diff);
    cut(m);
  }

  if ((m = plain.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?!\d)/)) || (m = plain.match(/\bas (\d{1,2})(?:\s*(?:h|:)\s*(\d{2}))?(?![\d/])/))) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (/\b(tarde|noite)\b/.test(plain) && h < 12) h += 12;
    if (h < 24 && min < 60) { time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`; cut(m); }
  }
  let duration = null;
  if ((m = plain.match(/\b(\d{1,3})\s*min(?:utos?)?\b/))) { duration = +m[1]; cut(m); }
  let priority = null;
  if (/\b(urgente|importante|prioridade alta)\b/.test(plain)) priority = 1;
  else if (/\b(sem pressa|quando der)\b/.test(plain)) priority = 3;

  const isNote = /^\s*(anota(r|cao)?|nota|ideia|lembrar que|guardar)\b/.test(plain);
  work = work
    .replace(/\b(da manh[ãa]|da tarde|da noite|de manh[ãa])\b/gi, ' ')
    .replace(/^\s*(anotar|anota|nota|ideia|guardar|marcar|agendar|me lembra(r)?( de)?|lembrar( de| que)?)[:,]?\s+/i, '')
    .replace(/\b(urgente|importante|sem pressa|quando der)\b/gi, ' ')
    .replace(/\s+(para|pra|no|na|em|de|as|às|dia|o|a)\s*$/i, '')
    .replace(/^\s*(para|pra|no|na|em|de|as|às|dia)\s+/i, '')
    .replace(/\s{2,}/g, ' ').replace(/[,;:\-–]+\s*$/, '').trim();
  const title = work ? work[0].toUpperCase() + work.slice(1) : base;

  const kind = isNote ? 'note' : date && time ? 'event' : 'task';
  return [{ kind, title, date, time, duration_min: duration, priority, remind_min: null, details: null }];
}

// ---------- Entrada unica ----------
export async function interpret(text, now = new Date(), client) {
  const clean = text.trim().slice(0, 1000);
  if (process.env.ANTHROPIC_API_KEY || client) {
    try { return { entries: await parseWithClaude(clean, now, client), ai: true }; }
    catch (e) { console.error('[nlp] claude falhou, usando interpretador simples:', e.message); }
  }
  return { entries: parseSimple(clean, now), ai: false };
}

// Entradas -> itens prontos para o banco (valida data/hora; sem horario valido vira tarefa).
export function toItems(entries) {
  return entries.filter((e) => e?.title?.trim()).map((e) => {
    const date = DATE_RE.test(e.date ?? '') ? e.date : null;
    const time = TIME_RE.test(e.time ?? '') ? e.time.padStart(5, '0') : null;
    const prio = [1, 2, 3].includes(e.priority) ? e.priority : 2;
    const base = { title: e.title.trim().slice(0, 200), notes: (e.details ?? '').slice(0, 2000), priority: prio };
    if (e.kind === 'note') return { ...base, kind: 'note' };
    if (e.kind === 'event' && date && time) {
      return { ...base, kind: 'event', start_at: zonedDate(date, time).toISOString(),
        duration_min: Number.isInteger(e.duration_min) && e.duration_min > 0 ? e.duration_min : 30,
        ...(Number.isInteger(e.remind_min) && e.remind_min >= 0 ? { remind_min: e.remind_min } : {}) };
    }
    return { ...base, kind: 'task', due_date: date };
  });
}
