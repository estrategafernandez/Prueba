// [WA][SUB] Agenda · GuardiaDeAlquiler
// Regla de Paco: en alquiler y en traspaso NO se agenda visita. Se cualifica al
// cliente y llama la asesora. El prompt ya se lo dice al agente, pero si el
// modelo se despista, aqui se para: no se llega a tocar el calendario.
const j = $input.first().json || {};
const referencia = String(j.referencia ?? '').toUpperCase().trim();
const alquiler = esAlquiler(referencia, j.tipo_transaccion ?? j.operacion);

return [{
  json: {
    ...j,
    referencia,
    es_alquiler: alquiler,
    seguir: !alquiler,
    respuesta: alquiler
      ? 'BLOQUEADO: ' + referencia + ' es un inmueble de ALQUILER y en alquiler no se agenda visita. '
        + MSG_ALQUILER_SIN_AGENDA + ' Haz las cuatro preguntas de cualificacion y llama a '
        + 'CualificarLead. No ofrezcas fecha ni hora.'
      : '',
  }
}];
