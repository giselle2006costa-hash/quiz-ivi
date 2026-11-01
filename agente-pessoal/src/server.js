import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { safeEqual, sessionValue, readCookie, COOKIE, sessionCookie, clearCookie } from './auth.js';
import { config, ROOT } from './config.js';
import { openDb, store } from './db.js';
import { syncToOutlook, deleteFromOutlook, outlookEnabled, connectOutlook, outlookPending, outlookLastError } from './outlook.js';
import { interpret, toItems } from './nlp.js';
import { buildPlan, dayKey } from './planner.js';
import { startScheduler } from './scheduler.js';
import { notify } from './notify.js';
import { createLimiter } from './ratelimit.js';

const limiter = createLimiter();
const clientIp = (req) => req.headers['fly-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const db = openDb();
const s = store(db);

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok, fail) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { fail(e); } });
});
// Aceita o cookie de sessao (app web) ou "Authorization: Bearer" (atalho da Siri, scripts).
const authorized = (req) => {
  if (!config.appToken) return false;
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (bearer && safeEqual(bearer, config.appToken)) return true;
  return safeEqual(readCookie(req.headers.cookie, COOKIE), sessionValue(config.appToken));
};
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';

const clean = (b) => {
  const out = {};
  if (typeof b.title === 'string') out.title = b.title.trim().slice(0, 200);
  if (typeof b.notes === 'string') out.notes = b.notes.slice(0, 2000);
  if ('start_at' in b) out.start_at = b.start_at ? new Date(b.start_at).toISOString() : null;
  if ('due_date' in b) out.due_date = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null;
  for (const k of ['duration_min', 'remind_min', 'priority']) if (Number.isInteger(b[k]) && b[k] >= 0) out[k] = b[k];
  if (['event', 'task', 'note'].includes(b.kind)) out.kind = b.kind;
  if ('done' in b) out.done = b.done ? 1 : 0;
  return out;
};

// Outlook e "melhor esforco": se cair, o app e os lembretes continuam funcionando.
async function sync(item) {
  try {
    const outlook_id = await syncToOutlook(item);
    return outlook_id !== item.outlook_id ? s.update(item.id, { outlook_id }) : item;
  } catch (e) {
    console.error('[outlook]', e.message);
    return item;
  }
}

const fmtWhen = (i) => new Date(i.start_at).toLocaleString('pt-BR', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: config.tz });
const describe = (i) => {
  if (i.kind === 'note') return `Anotado: ${i.title}`;
  if (i.kind === 'event') {
    const out = i.outlook_id ? ' (no Outlook)' : outlookEnabled() ? ' (Outlook falhou, so no app)' : '';
    return `Compromisso: ${i.title} - ${fmtWhen(i)}${out}`;
  }
  return `Tarefa: ${i.title}${i.due_date ? ` - prazo ${i.due_date.split('-').reverse().join('/')}` : ''}`;
};

// Teto diario de interpretacoes para o gasto com a API nunca fugir do controle.
const QUICK_PER_DAY = 200;
function quickBudgetOk() {
  const k = `quick_${dayKey(new Date())}`;
  const n = Number(s.kvGet(k) || 0);
  if (n >= QUICK_PER_DAY) return false;
  s.kvSet(k, String(n + 1));
  return true;
}

// Depois de conectar o Outlook, envia o que ja estava na agenda.
async function backfillOutlook() {
  for (const i of s.list().filter((x) => x.kind === 'event' && !x.done && !x.outlook_id && new Date(x.start_at) > new Date())) await sync(i);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(path.join(ROOT, 'public', 'index.html')));
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    const ip = clientIp(req);
    if (limiter.blocked(ip)) return json(res, 429, { error: 'muitas tentativas, tente mais tarde' });
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (typeof password === 'string' && safeEqual(password, config.appToken)) {
        limiter.reset(ip);
        res.setHeader('Set-Cookie', sessionCookie(config.appToken, isHttps(req)));
        return json(res, 200, { ok: true });
      }
      limiter.fail(ip);
      return json(res, 401, { error: 'senha incorreta' });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', clearCookie(isHttps(req)));
      return json(res, 200, { ok: true });
    }
    if (!authorized(req)) {
      // sem header = abertura da pagina sem login; so conta como erro quando ha senha errada
      if (req.headers.authorization) limiter.fail(ip);
      return json(res, 401, { error: 'unauthorized' });
    }
    limiter.reset(ip);

    if (url.pathname === '/api/status' && req.method === 'GET')
      return json(res, 200, {
        outlook: outlookEnabled(), outlookConfigured: !!config.msClientId, outlookPending: outlookPending(),
        outlookError: outlookLastError(), push: !!config.ntfy.topic, whatsapp: !!config.whatsapp.token,
        ai: !!process.env.ANTHROPIC_API_KEY,
      });
    if (url.pathname === '/api/outlook/connect' && req.method === 'POST') {
      try { return json(res, 200, await connectOutlook(backfillOutlook)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (url.pathname === '/api/quick' && req.method === 'POST') {
      const { text } = await readBody(req);
      if (typeof text !== 'string' || !text.trim()) return json(res, 400, { error: 'text obrigatorio' });
      if (!quickBudgetOk()) return json(res, 429, { error: 'limite diario de mensagens atingido' });
      const { entries, ai } = await interpret(text);
      const created = [];
      for (const it of toItems(entries)) created.push(await sync(s.create(it)));
      if (!created.length) return json(res, 422, { error: 'nao entendi, tente de outro jeito', reply: 'Nao entendi. Tente: "dentista amanha as 14h".' });
      return json(res, 201, { ai, items: created, reply: created.map(describe).join('\n') });
    }
    if (url.pathname === '/api/items' && req.method === 'GET') return json(res, 200, s.list());
    if (url.pathname === '/api/plan' && req.method === 'GET') return json(res, 200, buildPlan(s.list()));
    if (url.pathname === '/api/test-notify' && req.method === 'POST') {
      await notify('Teste: seu agente esta funcionando.', 'Teste');
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/items' && req.method === 'POST') {
      const b = clean(await readBody(req));
      if (!b.title) return json(res, 400, { error: 'title obrigatorio' });
      return json(res, 201, await sync(s.create(b)));
    }
    const m = url.pathname.match(/^\/api\/items\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      const cur = s.get(id);
      if (!cur) return json(res, 404, { error: 'not found' });
      if (req.method === 'PATCH') {
        const upd = s.update(id, clean(await readBody(req)));
        // concluido sai do Outlook? nao: so mudancas de horario/titulo sincronizam
        return json(res, 200, await sync(upd));
      }
      if (req.method === 'DELETE') {
        try { await deleteFromOutlook(cur); } catch (e) { console.error('[outlook]', e.message); }
        s.remove(id);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'erro interno' });
  }
});

if (!config.appToken) { console.error('Defina APP_TOKEN no .env'); process.exit(1); }
if (process.env.NODE_ENV === 'production' && config.appToken.length < 12) {
  console.error('APP_TOKEN precisa ter pelo menos 12 caracteres em producao'); process.exit(1);
}
server.listen(config.port, () => {
  console.log(`Agenda em http://localhost:${config.port}  (outlook: ${outlookEnabled()}, push: ${!!config.ntfy.topic})`);
  startScheduler(s);
});
