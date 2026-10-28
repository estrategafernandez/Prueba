// [WA] 13 · Envios que no llegan · BuscarFallos
// Por cada lead al que le mandamos la plantilla, los mensajes de su conversacion
// que Meta ha marcado como failed. El fallo llega por webhook DESPUES del envio,
// asi que esto es lo unico que se entera: al mandarla, todo parecia bien.
// Las respuestas de Chatwoot vienen en el mismo orden que los leads.
const leads = $('UnoPorLead').all().map(i => i.json);
const respuestas = $('MensajesDeLaConversacion').all().map(i => i.json);

const salida = [];
for (let k = 0; k < leads.length; k++) {
  const l = leads[k];
  const ms = [].concat(respuestas[k]?.payload ?? []);
  // Nuestros (salientes, no notas internas) que no han llegado
  const fallidos = ms.filter(m => m && m.status === 'failed' && !m.private
    && (m.message_type === 1 || m.message_type === 3 || m.message_type === 'outgoing'));
  if (!fallidos.length) continue;
  // Si despues del ultimo fallo ha entrado algo del cliente, es que si nos
  // llega por otro lado: no se avisa, ya hay conversacion.
  const ultimo = fallidos[fallidos.length - 1];
  const hablo = ms.some(m => m.message_type === 0 && !m.private
    && Number(m.created_at || 0) > Number(ultimo.created_at || 0));
  if (hablo) continue;

  const error = String(ultimo.external_error ?? ultimo.content_attributes?.external_error ?? '').trim();
  const motivo = motivoDelFallo(error);
  salida.push({ json: {
    ...l,
    // Una sola vez por mensaje fallido
    evento_id: `fallo:${ultimo.id}`,
    mensaje_id: ultimo.id,
    error,
    codigo: motivo.codigo,
    motivo: motivo.que,
    hay_que_llamar: motivo.llamar,
    cuantos_fallos: fallidos.length,
    texto_fallido: String(ultimo.content ?? '').replace(/\s+/g, ' ').slice(0, 120),
  } });
}
return salida;
