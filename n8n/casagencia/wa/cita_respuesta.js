// [WA][SUB] confirmarCitaCalendario · RespuestaOK
// La cita esta en la agenda. Se le dice al agente que la de como PRE-RESERVA
// y que el comercial ya esta avisado (si el aviso ha salido de verdad).
const v = $('ValidarAntesDeInsertar').first().json;
const evento = $('InsertarEnAgenda').first().json;
let aviso = {};
try { aviso = $('AvisarAlComercial').first().json || {}; } catch (e) { aviso = {}; }
const avisado = aviso.mensaje_registrado === true;

return [{ json: {
  cita_confirmada: true,
  evento_id: evento.id,
  asesora: v.asesora,
  respuesta:
    `cita_confirmada: true. La visita ha quedado guardada como PRE-RESERVA el ${fechaLegible(v.fecha, v.hora)} ` +
    `(inmueble ${v.referencia}) con ${v.asesora}. Diselo al cliente dejando claro que queda pendiente de que ` +
    `${v.asesora} se la confirme.` +
    (avisado ? ` ${v.asesora} ya ha recibido el aviso.` : ' El aviso al comercial no ha salido: no le digas al cliente que ya esta avisado.'),
} }];
