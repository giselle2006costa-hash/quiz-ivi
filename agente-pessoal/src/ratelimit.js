// Limita tentativas de login erradas por IP (em memoria; suficiente para 1 instancia).
export function createLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const fails = new Map(); // ip -> [timestamps]
  const recent = (ip, now) => {
    const list = (fails.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (list.length) fails.set(ip, list); else fails.delete(ip);
    return list;
  };
  return {
    blocked: (ip, now = Date.now()) => recent(ip, now).length >= max,
    fail: (ip, now = Date.now()) => { fails.set(ip, [...recent(ip, now), now]); },
    reset: (ip) => fails.delete(ip),
  };
}
