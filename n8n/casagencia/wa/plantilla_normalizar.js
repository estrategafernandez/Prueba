// [WA][SUB] Enviar plantilla · Normalizar
// Deja el telefono en el formato que quiere Meta y decide que plantilla toca.
const j = $input.first().json || {};
const tel = normalizarTelefono(j.telefono);

return [{
  json: {
    telefono_e164: tel.e164,
    wa_id: tel.wa_id,
    telefono_valido: tel.valido,
    nombre: String(j.nombre || '').trim() || 'Hola',
    referencia: String(j.referencia || '').toUpperCase(),
    operacion: String(j.operacion || ''),
    portal: String(j.portal || ''),
    plantilla: String(j.plantilla || PLANTILLA_LEAD),
    idioma: String(j.idioma || PLANTILLA_IDIOMA),
    param1: String(j.param1 ?? j.nombre ?? '').trim(),
    param2: String(j.param2 ?? j.referencia ?? '').trim(),
    conversacion_id: Number(j.conversacion_id || 0),
    chatwoot_url: CHATWOOT_URL,
    cuenta: CHATWOOT_CUENTA,
    inbox: CHATWOOT_INBOX,
  }
}];
