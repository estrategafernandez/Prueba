// [WA][SUB] Enviar plantilla · ElegirConversacion
// De todas las conversaciones del contacto se elige la mas adecuada: primero
// las abiertas y, entre ellas, la de actividad mas reciente.
const conversaciones = $input.first().json.payload || [];
const abiertas = conversaciones.filter(c => c.status === 'open');
const candidatas = abiertas.length ? abiertas : conversaciones;
candidatas.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));
return [{ json: { conversacion_id: candidatas.length ? candidatas[0].id : 0 } }];
