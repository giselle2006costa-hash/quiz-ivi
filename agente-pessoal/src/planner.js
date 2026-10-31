import { config } from './config.js';

const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: config.tz });
export const dayKey = (d) => d.toLocaleDateString('sv-SE', { timeZone: config.tz }); // YYYY-MM-DD

// Instante (Date) de um HH:MM no dia dado, no fuso configurado.
function at(dayStr, time) {
  const guess = new Date(`${dayStr}T${time}:00Z`);
  const shown = new Date(guess.toLocaleString('sv-SE', { timeZone: config.tz }).replace(' ', 'T') + 'Z');
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime()));
}

export function freeSlots(events, dayStr, minMin = 30) {
  const ws = at(dayStr, config.dayStart), we = at(dayStr, config.dayEnd);
  const busy = events
    .map((e) => [new Date(e.start_at), new Date(new Date(e.start_at).getTime() + e.duration_min * 60_000)])
    .sort((a, b) => a[0] - b[0]);
  const slots = [];
  let cursor = ws;
  for (const [s, e] of busy) {
    if (s - cursor >= minMin * 60_000) slots.push([cursor, s]);
    if (e > cursor) cursor = e;
  }
  if (we - cursor >= minMin * 60_000) slots.push([cursor, we]);
  return slots.filter(([a, b]) => b > a);
}

export function buildPlan(items, now = new Date()) {
  const today = dayKey(now);
  const open = items.filter((i) => !i.done);
  const events = open.filter((i) => i.start_at && dayKey(new Date(i.start_at)) === today)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const tasks = open.filter((i) => !i.start_at && (!i.due_date || i.due_date <= today))
    .sort((a, b) => a.priority - b.priority);
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
  const slots = freeSlots(events, today).filter(([, b]) => b > now);

  const lines = [`Bom dia! Seu dia (${today.split('-').reverse().join('/')}):`];
  lines.push('', events.length ? 'Compromissos:' : 'Sem compromissos com horario.');
  events.forEach((e) => lines.push(`- ${hhmm(new Date(e.start_at))} ${e.title} (${e.duration_min} min)`));

  if (tasks.length) {
    lines.push('', 'Tarefas (por prioridade):');
    const flag = { 1: '[alta]', 2: '[media]', 3: '[baixa]' };
    tasks.forEach((t) => lines.push(`- ${flag[t.priority] ?? ''} ${t.title}${overdue.includes(t) ? ' (atrasada)' : ''}`));
  }
  if (slots.length) {
    lines.push('', 'Horarios livres:');
    slots.forEach(([a, b]) => lines.push(`- ${hhmm(a)} as ${hhmm(b)}`));
  }
  return { text: lines.join('\n'), events, tasks, slots };
}
