// [WA][SUB] Etiquetar · UnirEtiquetas
// La API de Chatwoot SUSTITUYE la lista de etiquetas, no la amplia. Asi que se
// leen las que ya tiene la conversacion y se manda la union, para no borrar
// lo que hayan puesto las personas a mano.
//
// Las de estado (1-bienvenida_ia, 2-en_proceso, 3-agendada_ia) van de una en
// una y NUNCA hacia atras: si ya esta agendada, un mensaje nuevo del cliente
// no la devuelve a "en proceso". 4-intervenir se suma a la que haya.
const actuales = ($input.first().json.payload ?? []).map(String);
const pedidas = String($('Start').first().json.etiquetas ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const rango = (e) => ESTADOS.indexOf(e);          // -1 si no es de estado
const estadoActual = actuales.filter(e => rango(e) >= 0).sort((a, b) => rango(b) - rango(a))[0] || '';

// Reinicio a mano ([WA] 9 con reiniciar): se quitan todas las de la IA,
// incluida 4-intervenir, y se ponen las pedidas. Las de las personas se quedan.
const forzar = String($('Start').first().json.forzar ?? '').toLowerCase() === 'true';
let finales = forzar
  ? actuales.filter(e => !ESTADOS.includes(e) && e !== ETIQUETAS.intervenir)
  : [...actuales];
for (const e of pedidas) {
  if (rango(e) >= 0) {
    if (!forzar && rango(e) < rango(estadoActual)) continue;  // no se retrocede
    finales = finales.filter(x => rango(x) < 0);            // fuera el estado anterior
  }
  if (!finales.includes(e)) finales.push(e);
}

const cambia = JSON.stringify([...finales].sort()) !== JSON.stringify([...actuales].sort());
return [{ json: { labels: finales, cambia } }];
