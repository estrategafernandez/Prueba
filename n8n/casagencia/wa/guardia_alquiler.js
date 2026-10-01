// [WA][SUB] Agenda · GuardiaDeAlquiler
// Regla de Paco: en alquiler y en traspaso NO se agenda visita. Se cualifica al
// cliente y decide una persona del equipo. El prompt ya se lo dice al agente,
// pero si el modelo se despista, aqui se para: no se llega a tocar el calendario.
//
// Deja tambien la peticion envuelta en "body", que es como la esperan los
// nodos de agenda que se reutilizan del asistente telefonico.
const j = $input.first().json || {};
const referencia = String(j.referencia ?? '').toUpperCase().trim();
const tipo = String(j.tipo_transaccion ?? j.operacion ?? '').toLowerCase();
const alquiler = esAlquiler(referencia, tipo);

// Antelacion minima (0 = sin minimo, manda el horario de oficina)
let demasiadoPronto = false;
if (ANTELACION_MINIMA_HORAS > 0 && j.fecha && j.hora) {
  const cita = DateTime.fromFormat(`${j.fecha} ${j.hora}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
  demasiadoPronto = cita.isValid && cita < DateTime.now().setZone(ZONA).plus({ hours: ANTELACION_MINIMA_HORAS });
}

let respuesta = '';
if (alquiler) {
  respuesta = 'BLOQUEADO: ' + referencia + ' es de ALQUILER y en alquiler no se agenda visita. Haz las ' +
    'cuatro preguntas de cualificacion y llama a guardarCualificacion: el equipo entra en la conversacion ' +
    'y decide la visita. No ofrezcas ni aceptes fecha ni hora.';
} else if (demasiadoPronto) {
  respuesta = `Esa hora es demasiado pronto: las visitas se agendan con al menos ${ANTELACION_MINIMA_HORAS} ` +
    'horas de antelacion. Proponle un dia a partir de pasado ese margen.';
}

return [{
  json: {
    ...j,
    referencia,
    es_alquiler: alquiler,
    seguir: !respuesta,
    // Prueba: se consulta la agenda de verdad, pero la reserva NO se escribe
    es_prueba: esPrueba(j.telefono),
    respuesta,
    body: {
      nombre: String(j.nombre ?? '').trim(),
      telefono: j.telefono,
      referencia,
      tipo_transaccion: alquiler ? 'alquiler' : 'compra',
      fecha: String(j.fecha ?? '').trim(),
      // Al CONSULTAR huecos basta con el dia: si el cliente no ha dicho hora se
      // pregunta por las 11:00 y el calendario devuelve las libres de ese dia.
      // Al RESERVAR la hora es obligatoria y no se rellena nunca.
      hora: String(j.hora ?? '').trim() || (String(j.modo ?? '') === 'consulta' ? '11:00' : ''),
    },
  }
}];
