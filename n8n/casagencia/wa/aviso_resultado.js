// [WA][SUB] AvisoEquipo · Resultado
// Solo se da el aviso por enviado si le ha llegado a Meta para la comercial.
const p = $('Preparar').first().json;
const envios = $('Juntar').first().json.envios || [];
const ok = envios.filter(e => e.ok).map(e => e.para);
const fallo = envios.filter(e => !e.ok);
// El primero es la comercial (o el que prueba): ese es el que cuenta
const llego = !!envios[0]?.ok;
return [{ json: {
  mensaje_registrado: llego,
  whatsapp_ok: llego,
  enviado_a: ok,
  para: p.para_nombre,
  error_whatsapp: fallo.map(e => `${e.para}: ${e.error || 'sin respuesta de Meta'}`).join(' | '),
  respuesta: llego
    ? `mensaje_registrado: true. Aviso enviado a ${p.para_nombre} por WhatsApp.`
      + (p.pasar_a_humano ? ' La conversacion queda para una persona del equipo: despidete y no sigas preguntando.' : '')
    : 'mensaje_registrado: false. El aviso NO ha salido. No le digas al cliente que el equipo esta avisado; '
      + 'dile que ha habido un problema tecnico y que lo intente de nuevo mas tarde o llame a la oficina.',
} }];
