// [WA] 2 · Asistente · EstadoEnProceso
// En cuanto el cliente contesta, la conversacion pasa a "2-en_proceso" (como
// en Blue). Solo si todavia esta en bienvenida o sin estado: una visita ya
// agendada o una conversacion en manos de una persona no se tocan.
const e = $('EntradaMensaje').first().json;
const tiene = (x) => (e.etiquetas || []).includes(x);
const hayQueMarcar = !tiene(ETIQUETAS.en_proceso) && !tiene(ETIQUETAS.agendada) && !tiene(ETIQUETAS.intervenir);
return [{ json: {
  marcar: hayQueMarcar && !!e.conversacion_id,
  conversacion_id: Number(e.conversacion_id || 0),
  etiquetas: ETIQUETAS.en_proceso,
} }];
