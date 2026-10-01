// [WA][SUB] confirmarCitaCalendario · PrepararAvisoCita
// La visita ya esta en la agenda como PRE-RESERVA: se prepara el aviso a la
// asesora, con lo que sabemos del cliente, para que le llame y la confirme.
const v = $('ValidarAntesDeInsertar').first().json;
const s = $('Start').first().json;
let cualificacion = '';
try { cualificacion = String($('LeerCualificacion').first().json.cualificacion ?? '').trim(); } catch (e) { cualificacion = ''; }
const resumen = String(s.resumen ?? '').replace(/\s+/g, ' ').trim();
return [{ json: {
  accion: 'PRE-RESERVA',
  destinatario: v.asesora,
  referencia: v.referencia,
  cliente_nombre: v.nombre,
  cliente_telefono: v.telefono_e164,
  cita: fechaLegible(v.fecha, v.hora),
  resumen: [cualificacion, resumen].filter(Boolean).join(' · '),
  detalle: [cualificacion ? 'Cualificacion: ' + cualificacion : '', resumen].filter(Boolean).join('\n'),
  conversacion_id: Number(s.conversacion_id || 0),
  pasar_a_humano: false,
  etiqueta: ETIQUETAS.agendada,
} }];
