// [WA] 3 · Recordatorio · SoloLosNuevos
// Cada visita se recuerda UNA vez. Antes de avisar se apunta en wa_avisos con
// "on conflict do nothing": solo devuelve fila la primera vez, asi que aunque
// el workflow corra cada hora (o dos veces a la vez) nadie recibe dos avisos.
const nuevos = new Set($input.all().map(i => String(i.json.evento_id ?? '')).filter(Boolean));
return $('VisitasDeWhatsApp').all().filter(i => nuevos.has(String(i.json.evento_id)));
