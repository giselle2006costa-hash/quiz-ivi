import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env simples (sem dependencias)
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const env = process.env;
export const config = {
  port: Number(env.PORT || 3000),
  tz: env.TZ || 'America/Sao_Paulo',
  appToken: env.APP_TOKEN || '',
  dailyPlanAt: env.DAILY_PLAN_AT || '07:30',
  dayStart: env.DAY_START || '08:00',
  dayEnd: env.DAY_END || '18:00',
  dbPath: env.DB_PATH || path.join(ROOT, 'data', 'agenda.db'),
  tokenPath: path.join(ROOT, 'data', 'ms_token.json'),
  ntfy: { server: env.NTFY_SERVER || 'https://ntfy.sh', topic: env.NTFY_TOPIC || '' },
  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneId: env.WHATSAPP_PHONE_ID || '',
    to: env.WHATSAPP_TO || '',
    template: env.WHATSAPP_TEMPLATE || '',
    lang: env.WHATSAPP_TEMPLATE_LANG || 'pt_BR',
  },
  msClientId: env.MS_CLIENT_ID || '',
};
