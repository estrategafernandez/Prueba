// [WA] 13 · Envios que no llegan · BuscarFallos
// Por cada lead al que le mandamos la plantilla, los mensajes de su conversacion
// que Meta ha marcado como failed. El fallo llega por webhook DESPUES del envio,
// asi que esto es lo unico que se entera: al mandarla, todo parecia bien.
// Las respuestas de Chatwoot vienen en el mismo orden que los leads.
//
// Cuantos envios llevan NO se guarda en ninguna columna: se cuentan los mensajes
// fallidos de la conversacion, que es la verdad. Y la espera entre intentos se
// mide desde el ultimo fallo, no desde la ficha (que la tocan otros flujos).
const leads = $('UnoPorLead').all().map(i => i.json);
const respuestas = $('MensajesDeLaConversacion').all().map(i => i.json);
const ahoraSeg = Math.floor(DateTime.now().toSeconds());
// Nuestros: salientes y que no sean notas internas del panel
const nuestro = (m) => m && !m.private
  && (m.message_type === 1 || m.message_type === 3 || m.message_type === 'outgoing');

const salida = [];
const vistos = new Set();
for (let k = 0; k < leads.length; k++) {
  const l = leads[k];
  const ms = [].concat(respuestas[k]?.payload ?? []);
  const fallidos = ms.filter(m => nuestro(m) && m.status === 'failed');
  if (!fallidos.length) continue;
  // Ya se le han mandado todos los que tocaban: no se le persigue mas
  if (fallidos.length >= REINTENTOS_ENVIO) continue;

  const ultimo = fallidos[fallidos.length - 1];
  const desde = Number(ultimo.created_at || 0);
  // Si despues del ultimo fallo ha entrado algo del cliente, es que si nos llega
  // por otro lado: no se reintenta, ya hay conversacion.
  const hablo = ms.some(m => m.message_type === 0 && !m.private
    && Number(m.created_at || 0) > desde);
  if (hablo) continue;
  // Y si despues le ha salido algo que NO fallo (el reintento anterior, o la
  // asesora a mano), ese si llego: tampoco hay nada que reintentar.
  const llego = ms.some(m => nuestro(m) && m.status !== 'failed'
    && Number(m.created_at || 0) > desde);
  if (llego) continue;
  // Los intentos se espacian: 1 h desde el primer fallo, 2 h desde el segundo...
  const horas = (ahoraSeg - desde) / 3600;
  if (horas < fallidos.length) continue;
  // Un cliente puede tener varias fichas (un inmueble cada una) con la MISMA
  // conversacion: el fallo es uno y el reenvio tambien.
  const evento_id = `fallo:${ultimo.id}`;
  if (vistos.has(evento_id)) continue;
  vistos.add(evento_id);

  const error = String(ultimo.external_error ?? ultimo.content_attributes?.external_error ?? '').trim();
  const motivo = motivoDelFallo(error);
  salida.push({ json: {
    ...l,
    evento_id,
    mensaje_id: ultimo.id,
    error,
    codigo: motivo.codigo,
    motivo: motivo.que,
    hay_que_llamar: motivo.llamar,
    // Los envios que ya han fallado, y el que sale ahora
    cuantos_fallos: fallidos.length,
    intento: fallidos.length + 1,
    ultimo_intento: fallidos.length + 1 >= REINTENTOS_ENVIO,
    horas_desde_el_fallo: Math.round(horas * 10) / 10,
    texto_fallido: String(ultimo.content ?? '').replace(/\s+/g, ' ').slice(0, 120),
  } });
}
return salida;
