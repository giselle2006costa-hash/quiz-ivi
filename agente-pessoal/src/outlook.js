import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { config } from './config.js';

const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export const SCOPE = 'offline_access Calendars.ReadWrite';

export const outlookEnabled = () => Boolean(config.msClientId && existsSync(config.tokenPath));

async function accessToken() {
  const saved = JSON.parse(readFileSync(config.tokenPath, 'utf8'));
  if (saved.access_token && saved.expires_at > Date.now() + 60_000) return saved.access_token;
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.msClientId, grant_type: 'refresh_token',
      refresh_token: saved.refresh_token, scope: SCOPE,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`refresh falhou: ${j.error_description || res.status}`);
  // a Microsoft rotaciona o refresh token: precisa salvar o novo
  writeFileSync(config.tokenPath, JSON.stringify({
    refresh_token: j.refresh_token || saved.refresh_token,
    access_token: j.access_token,
    expires_at: Date.now() + j.expires_in * 1000,
  }));
  return j.access_token;
}

async function graph(method, path, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`graph ${res.status}: ${j.error?.message || ''}`);
  return j;
}

const toEvent = (i) => {
  const start = new Date(i.start_at);
  const end = new Date(start.getTime() + i.duration_min * 60_000);
  const fmt = (d) => d.toISOString().replace('Z', '');
  return {
    subject: i.title,
    body: { contentType: 'text', content: i.notes || '' },
    start: { dateTime: fmt(start), timeZone: 'UTC' },
    end: { dateTime: fmt(end), timeZone: 'UTC' },
    isReminderOn: true,
    reminderMinutesBeforeStart: i.remind_min,
  };
};

// Itens sem horario (tarefas) nao vao para o Outlook.
export async function syncToOutlook(item) {
  if (!outlookEnabled() || !item.start_at) return item.outlook_id ?? null;
  if (item.outlook_id) {
    await graph('PATCH', `/me/events/${item.outlook_id}`, toEvent(item));
    return item.outlook_id;
  }
  return (await graph('POST', '/me/events', toEvent(item))).id;
}

export async function deleteFromOutlook(item) {
  if (!outlookEnabled() || !item.outlook_id) return;
  await graph('DELETE', `/me/events/${item.outlook_id}`);
}

// Login por codigo (device flow): o servidor guarda o token no proprio disco.
let pending = null; // { user_code, verification_uri, expires_at, error? }
export const outlookPending = () => (pending && !pending.error && pending.expires_at > Date.now() ? pending : null);
export const outlookLastError = () => pending?.error ?? null;

export async function connectOutlook(onConnected) {
  if (!config.msClientId) throw new Error('MS_CLIENT_ID nao configurado');
  const dc = await (await fetch(`${AUTH}/devicecode`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.msClientId, scope: SCOPE }),
  })).json();
  if (!dc.device_code) throw new Error(dc.error_description || 'falha ao iniciar login');
  pending = { user_code: dc.user_code, verification_uri: dc.verification_uri, expires_at: Date.now() + dc.expires_in * 1000 };
  const mine = pending;
  (async () => {
    while (pending === mine && Date.now() < mine.expires_at) {
      await new Promise((r) => setTimeout(r, (dc.interval || 5) * 1000));
      const j = await (await fetch(`${AUTH}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.msClientId, device_code: dc.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
      })).json().catch(() => ({ error: 'network' }));
      if (j.error === 'authorization_pending' || j.error === 'network') continue;
      if (j.error) { mine.error = j.error_description || j.error; return; }
      writeFileSync(config.tokenPath, JSON.stringify({
        refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 }));
      pending = null;
      await onConnected?.();
      return;
    }
  })().catch((e) => { mine.error = e.message; });
  return { user_code: mine.user_code, verification_uri: mine.verification_uri };
}
