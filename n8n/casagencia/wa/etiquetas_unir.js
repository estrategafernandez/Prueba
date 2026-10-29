// [WA][SUB] Etiquetar · UnirEtiquetas
// La API de Chatwoot SUSTITUYE la lista de etiquetas, no la amplia. Asi que se
// leen las que ya tiene la conversacion y se manda la union, para no borrar
// lo que hayan puesto las personas a mano.
//
// Las de estado (1-bienvenida_ia, 2-en_proceso, 3-agendada_ia) van de una en
// una y NUNCA hacia atras: si ya esta agendada, un mensaje nuevo del cliente
// no la devuelve a "en proceso". 4-intervenir se suma a la que haya, pero
// quita 2-en_proceso: la conversacion la lleva ya una persona (y mientras tenga
// 4-intervenir no se vuelve a poner).
//
// Si NO se han podido leer las que tiene, no se escribe nada: como Chatwoot
// sustituye la lista entera, se borrarian todas (las de las personas incluidas).
const leido = $input.first().json || {};
if (!Array.isArray(leido.payload)) return [{ json: { labels: [], cambia: false, sin_leer: true } }];
const actuales = leido.payload.map(String);
const pedidas = String($('Start').first().json.etiquetas ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// La del inmueble, si ha llegado referencia: se suma como una mas (no es de
// estado, asi que ninguna otra la quita)
let deReferencia = '';
try { deReferencia = String($('Preparar').first().json.etiqueta_referencia || ''); } catch (e) {}
if (deReferencia && !pedidas.includes(deReferencia)) pedidas.push(deReferencia);

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

if (finales.includes(ETIQUETAS.intervenir)) finales = finales.filter(x => x !== ETIQUETAS.en_proceso);

const cambia = JSON.stringify([...finales].sort()) !== JSON.stringify([...actuales].sort());
return [{ json: { labels: finales, cambia } }];
