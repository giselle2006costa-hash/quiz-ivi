import { createHmac, timingSafeEqual } from 'node:crypto';

// Valor do cookie de sessao: derivado da senha, entao trocar APP_TOKEN desconecta todos os aparelhos.
export const sessionValue = (secret) => createHmac('sha256', secret).update('agenda-session-v1').digest('hex');

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export const readCookie = (header = '', name) => {
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
};

export const COOKIE = 'agenda_session';
export const sessionCookie = (secret, secure) =>
  `${COOKIE}=${sessionValue(secret)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
export const clearCookie = (secure) =>
  `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
