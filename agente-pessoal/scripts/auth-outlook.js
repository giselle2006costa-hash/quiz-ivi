// Uso unico: npm run auth:outlook  (login por codigo, sem precisar de servidor)
import { writeFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { SCOPE } from '../src/outlook.js';

const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
if (!config.msClientId) { console.error('Defina MS_CLIENT_ID no .env primeiro.'); process.exit(1); }

const dc = await (await fetch(`${AUTH}/devicecode`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: config.msClientId, scope: SCOPE }),
})).json();
if (!dc.device_code) { console.error(dc); process.exit(1); }
console.log(`\n${dc.message}\n`);

for (;;) {
  await new Promise((r) => setTimeout(r, (dc.interval || 5) * 1000));
  const j = await (await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.msClientId, device_code: dc.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })).json();
  if (j.error === 'authorization_pending') continue;
  if (j.error) { console.error(j.error_description); process.exit(1); }
  writeFileSync(config.tokenPath, JSON.stringify({
    refresh_token: j.refresh_token, access_token: j.access_token,
    expires_at: Date.now() + j.expires_in * 1000,
  }));
  console.log('Outlook conectado. Token salvo em data/ms_token.json');
  break;
}
