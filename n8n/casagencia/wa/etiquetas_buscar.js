// [WA][SUB] Etiquetar · BuscarEtiqueta
// ¿Existe ya en la cuenta la etiqueta de esta referencia? Chatwoot las guarda en
// minusculas, asi que se compara sin distinguir. Si la lista no se ha podido
// leer, se intenta crear igual: si ya existia, Chatwoot dice que el nombre esta
// cogido y no pasa nada.
const buscada = $('Preparar').first().json.etiqueta_referencia;
const r = $input.first().json || {};
const leida = Array.isArray(r.payload);
const existe = leida && r.payload.some(e => String(e?.title ?? '').toLowerCase() === buscada);
return [{ json: { existe, leida, buscada } }];
