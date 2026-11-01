// Regras de uma edicao: o tipo acompanha o horario e o Outlook so e tocado quando precisa.
const OUTLOOK_FIELDS = ['title', 'notes', 'start_at', 'duration_min', 'remind_min'];

export function validatePatch(patch) {
  if ('title' in patch && !patch.title) return 'o titulo nao pode ficar vazio';
  if ('start_at' in patch && patch.start_at !== null && Number.isNaN(Date.parse(patch.start_at))) return 'data ou hora invalida';
  return null;
}

// Devolve { patch, syncOutlook, removeFromOutlook } para o item `cur` receber `patch`.
export function planEdit(cur, patch) {
  const out = { ...patch };
  const clearsTime = 'start_at' in patch && patch.start_at === null;
  const setsTime = 'start_at' in patch && patch.start_at !== null;
  if (!('kind' in patch) && cur.kind !== 'note') {
    if (setsTime) out.kind = 'event';
    else if (clearsTime && cur.kind === 'event') out.kind = 'task';
  }
  const finalKind = out.kind ?? cur.kind;
  const hasTime = setsTime || (!clearsTime && !!cur.start_at);
  // anotacao nunca vai para o Outlook; evento sem horario deixa de ser evento
  const removeFromOutlook = !!cur.outlook_id && (finalKind === 'note' || !hasTime);
  const touchesOutlook = OUTLOOK_FIELDS.some((k) => k in patch);
  return { patch: out, removeFromOutlook, syncOutlook: !removeFromOutlook && finalKind === 'event' && hasTime && touchesOutlook };
}
