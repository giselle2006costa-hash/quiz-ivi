import { config } from './config.js';
import { notify } from './notify.js';
import { buildPlan, dayKey } from './planner.js';

const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: config.tz });

// Roda a cada minuto: dispara lembretes vencidos e o resumo diario (1x por dia).
export async function tick(s, now = new Date()) {
  for (const item of s.dueReminders(now.toISOString())) {
    const mins = Math.max(0, Math.round((new Date(item.start_at) - now) / 60_000));
    const when = mins > 0 ? `em ${mins} min (${hhmm(new Date(item.start_at))})` : 'agora';
    // marca antes de enviar: se o envio falhar nao ficamos reenviando todo minuto
    s.markReminded(item.id);
    await notify(`${item.title} - ${when}`, 'Lembrete');
  }

  const today = dayKey(now);
  const nowHm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: config.tz });
  if (nowHm >= config.dailyPlanAt && s.kvGet('last_plan') !== today) {
    s.kvSet('last_plan', today);
    await notify(buildPlan(s.list(), now).text, 'Seu dia');
  }
}

export function startScheduler(s) {
  const run = () => tick(s).catch((e) => console.error('[tick]', e.message));
  run();
  return setInterval(run, 60_000);
}
