import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { config, ROOT } from './config.js';
import { openDb, store } from './db.js';
import { syncToOutlook, deleteFromOutlook, outlookEnabled } from './outlook.js';
import { buildPlan } from './planner.js';
import { startScheduler } from './scheduler.js';
import { notify } from './notify.js';

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
const authorized = (req) => {
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(config.appToken);
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
};

const clean = (b) => {
  const out = {};
  if (typeof b.title === 'string') out.title = b.title.trim().slice(0, 200);
  if (typeof b.notes === 'string') out.notes = b.notes.slice(0, 2000);
  if ('start_at' in b) out.start_at = b.start_at ? new Date(b.start_at).toISOString() : null;
  if ('due_date' in b) out.due_date = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null;
  for (const k of ['duration_min', 'remind_min', 'priority']) if (Number.isInteger(b[k]) && b[k] >= 0) out[k] = b[k];
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(path.join(ROOT, 'public', 'index.html')));
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });

    if (url.pathname === '/api/status' && req.method === 'GET')
      return json(res, 200, { outlook: outlookEnabled(), push: !!config.ntfy.topic, whatsapp: !!config.whatsapp.token });
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
server.listen(config.port, () => {
  console.log(`Agenda em http://localhost:${config.port}  (outlook: ${outlookEnabled()}, push: ${!!config.ntfy.topic})`);
  startScheduler(s);
});
