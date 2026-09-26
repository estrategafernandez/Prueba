// [WA][SUB] Etiquetar · UnirEtiquetas
// La API de Chatwoot SUSTITUYE la lista de etiquetas, no la amplia. Asi que se
// leen las que ya tiene la conversacion y se manda la union, para no borrar lo
// que hayan puesto Paco o las asesoras a mano.
const actuales = ($input.first().json.payload ?? []).map(String);
const nueva = String($('Start').first().json.etiqueta ?? '').trim().toLowerCase();

// Las etiquetas de estado de la IA son excluyentes entre si: al poner una, las
// otras se quitan. Las etiquetas de personas se dejan siempre.
const estados = [ETIQUETAS.nueva, ETIQUETAS.cualificando, ETIQUETAS.cualificado,
                 ETIQUETAS.cita, ETIQUETAS.alquiler];
const esEstado = estados.includes(nueva);

const finales = actuales.filter(e => !(esEstado && estados.includes(e)));
if (nueva && !finales.includes(nueva)) finales.push(nueva);

return [{ json: { labels: finales } }];
