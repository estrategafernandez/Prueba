// [WA][SUB] AvisoEquipo · Resultado
// Solo se da el aviso por enviado si ha salido de verdad por algun canal.
const p = $('Preparar').first().json;
let wa = {}, correo = {};
try { wa = $('EnviarWhatsApp').first().json || {}; } catch (e) { wa = {}; }
try { correo = $('EnviarCorreo').first().json || {}; } catch (e) { correo = {}; }

const waOk = Array.isArray(wa.messages) && !!wa.messages[0]?.id;
const correoOk = !!(correo.id || correo.threadId || (correo.labelIds || []).length);
const error = wa.error?.message || (typeof wa.error === 'string' ? wa.error : '');

const canales = [waOk ? 'WhatsApp' : '', correoOk ? 'correo' : ''].filter(Boolean).join(' y ');
return [{ json: {
  mensaje_registrado: waOk || correoOk,
  whatsapp_ok: waOk,
  correo_ok: correoOk,
  para: p.para_nombre,
  error_whatsapp: waOk ? '' : String(error || 'sin respuesta de Meta').slice(0, 200),
  respuesta: (waOk || correoOk)
    ? `mensaje_registrado: true. Aviso enviado a ${p.para_nombre} por ${canales}.`
      + (p.pasar_a_humano ? ' La conversacion queda para una persona del equipo: despidete y no sigas preguntando.' : '')
    : 'mensaje_registrado: false. El aviso NO ha salido. No le digas al cliente que el equipo esta avisado; '
      + 'dile que ha habido un problema tecnico y que lo intente de nuevo mas tarde o llame a la oficina.',
} }];
