// [WA][SUB] confirmarCitaCalendario · PrepararAvisoCita
// La visita ya esta en la agenda como PRE-RESERVA: se prepara el aviso a la
// asesora, con lo que sabemos del cliente, para que le llame y la confirme.
const v = $('ValidarAntesDeInsertar').first().json;
const s = $('Start').first().json;
let cualificacion = '';
try { cualificacion = String($('LeerCualificacion').first().json.cualificacion ?? '').trim(); } catch (e) { cualificacion = ''; }
const resumen = String(s.resumen ?? '').replace(/\s+/g, ' ').trim();
// Estado y llaves segun eGO (si eGO no contesta, el aviso sale igual)
let crm = '';
try { crm = String($('FichaDelCRM').first().json.para_la_asesora ?? '').trim(); } catch (e) { crm = ''; }
return [{ json: {
  accion: 'PRE-RESERVA',
  destinatario: v.asesora,
  referencia: v.referencia,
  cliente_nombre: v.nombre,
  cliente_telefono: v.telefono_e164,
  cita: fechaLegible(v.fecha, v.hora),
  // Al WhatsApp, lo corto: el resumen de Sara (ya lleva la cualificacion) y eGO
  resumen: [resumen || cualificacion, crm].filter(Boolean).join(' · '),
  detalle: [cualificacion ? 'Cualificacion: ' + cualificacion : '', resumen, crm].filter(Boolean).join('\n'),
  conversacion_id: Number(s.conversacion_id || 0),
  pasar_a_humano: false,
  etiqueta: ETIQUETAS.agendada,
} }];
