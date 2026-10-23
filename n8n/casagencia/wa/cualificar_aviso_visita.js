// [WA][SUB] guardarCualificacion · DatosDeLaVisita
// En compra la visita se reserva ANTES de las preguntas, asi que la pre-reserva
// le llego a la asesora sin ellas. Esto es el aviso que se le manda despues,
// cuando ya estan las dos: las respuestas y, para que sepa de que visita le
// hablan, el dia y la hora que tiene guardados en la ficha.
const p = $('Preparar').first().json;
let f = {};
try { f = $('GuardarFicha').first().json || {}; } catch (e) { f = {}; }
const cuando = f.cita_fecha ? fechaLegible(f.cita_fecha, f.cita_hora) : '';
return [{ json: { ...(p.aviso_compra || {}), cita: cuando } }];
