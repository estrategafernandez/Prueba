// [WA][SUB] Enviar plantilla · ElegirContacto
// Chatwoot devuelve coincidencias parciales en la busqueda: nos quedamos solo
// con el contacto cuyo telefono coincide EXACTAMENTE, para no escribirle a
// quien no toca.
const norm = $('Normalizar').first().json;
const encontrados = ($input.first().json.payload) || [];
const digitos = (s) => String(s ?? '').replace(/\D/g, '');
const exactos = encontrados.filter(c =>
  digitos(c.phone_number) === norm.wa_id || digitos(c.identifier) === norm.wa_id);
return [{ json: { payload: exactos.length ? [exactos[0]] : [] } }];
