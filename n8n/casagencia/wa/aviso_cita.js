// [WA][SUB] confirmarCitaCalendario · PrepararAvisoCita
// La visita ya esta en la agenda: se prepara el aviso al comercial.
const v = $('ValidarAntesDeInsertar').first().json;
const s = $('Start').first().json;
return [{ json: {
  accion: 'VISITA AGENDADA',
  destinatario: v.asesora,
  referencia: v.referencia,
  cliente_nombre: v.nombre,
  cliente_telefono: v.telefono_e164,
  cita: fechaLegible(v.fecha, v.hora),
  resumen: String(s.resumen ?? '').trim(),
  detalle: String(s.resumen ?? '').trim(),
  conversacion_id: Number(s.conversacion_id || 0),
  pasar_a_humano: false,
  etiqueta: ETIQUETAS.agendada,
} }];
