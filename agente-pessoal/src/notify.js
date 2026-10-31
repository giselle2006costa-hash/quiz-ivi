import { config } from './config.js';

async function push(message, title = 'Agenda') {
  if (!config.ntfy.topic) return { channel: 'push', skipped: true };
  const res = await fetch(`${config.ntfy.server}/${config.ntfy.topic}`, {
    method: 'POST',
    // cabecalhos HTTP so aceitam latin1: mantenha o titulo sem acentos
    headers: { Title: title, Priority: 'high', Tags: 'calendar' },
    body: message,
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  return { channel: 'push', ok: true };
}

async function whatsapp(message) {
  const w = config.whatsapp;
  if (!w.token || !w.phoneId || !w.to) return { channel: 'whatsapp', skipped: true };
  // Texto livre so entrega dentro de 24h apos voce escrever para o numero.
  // Fora disso a Meta exige template aprovado, entao usamos o template se configurado.
  const body = w.template
    ? { messaging_product: 'whatsapp', to: w.to, type: 'template',
        template: { name: w.template, language: { code: w.lang },
          components: [{ type: 'body', parameters: [{ type: 'text', text: message.replace(/\s*\n\s*/g, ' | ').slice(0, 1000) }] }] } }
    : { messaging_product: 'whatsapp', to: w.to, type: 'text', text: { body: message } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${w.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`whatsapp ${res.status}: ${await res.text()}`);
  return { channel: 'whatsapp', ok: true };
}

// Envia por todos os canais; falha em um nao derruba o outro.
export async function notify(message, title) {
  const results = await Promise.allSettled([push(message, title), whatsapp(message)]);
  results.forEach((r) => r.status === 'rejected' && console.error('[notify]', r.reason.message));
  return results;
}
