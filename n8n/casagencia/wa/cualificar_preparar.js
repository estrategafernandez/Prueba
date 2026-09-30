// [WA][SUB] guardarCualificacion · Preparar
// Guarda lo que el cliente ha contestado y decide que pasa despues:
//
//   COMPRA   -> dos preguntas (cuanto tiempo lleva buscando y si necesita
//               vender para comprar). Se guardan y Sara ofrece la visita.
//   ALQUILER -> las cuatro preguntas del telefono (personas, ingresos,
//               mascotas y cuando entrar). Se guardan, se avisa al comercial
//               y la conversacion pasa a una persona: en alquiler la IA no
//               agenda, decide el equipo.
const j = $input.first().json || {};
const tel = normalizarTelefono(j.telefono);
const referencia = String(j.referencia ?? '').toUpperCase().trim();
const alquiler = esAlquiler(referencia, j.operacion);
const r = resolverAsesora(referencia);

const limpio = (v) => {
  const s = String(v ?? '').trim();
  return s && !['undefined', 'null'].includes(s.toLowerCase()) ? s : '';
};

const campos = {
  q_tiempo_buscando: limpio(j.tiempo_buscando),
  q_necesita_vender: limpio(j.necesita_vender),
  q_personas:        limpio(j.personas),
  q_ingresos:        limpio(j.ingresos),
  q_mascotas:        limpio(j.mascotas),
  q_entrada:         limpio(j.entrada),
  q_duracion:        limpio(j.duracion),
  q_actividad:       limpio(j.actividad),
};

const respuestas = alquiler
  ? [['Personas', campos.q_personas], ['Ingresos', campos.q_ingresos],
     ['Mascotas', campos.q_mascotas], ['Entrada', campos.q_entrada],
     ['Todo el ano o temporada', campos.q_duracion], ['Actividad', campos.q_actividad]]
  : [['Lleva buscando', campos.q_tiempo_buscando], ['Necesita vender para comprar', campos.q_necesita_vender]];

const resumenRespuestas = respuestas.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
const resumen = limpio(j.resumen);

return [{
  json: {
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    nombre: limpio(j.nombre),
    referencia,
    operacion: alquiler ? 'alquiler' : 'venta',
    es_alquiler: alquiler,
    asesora: r.destinatario,
    estado: alquiler ? 'alquiler_pasado_al_equipo' : 'cualificado',
    ...campos,
    campos_con_dato: Object.entries(campos).filter(([, v]) => v).map(([k]) => k),
    conversacion_id: Number(j.conversacion_id || 0),
    // Lo que necesita el aviso al equipo (solo se usa en alquiler)
    aviso: {
      accion: 'INTERVENIR',
      destinatario: r.destinatario,
      referencia,
      cliente_nombre: limpio(j.nombre),
      cliente_telefono: tel.e164,
      resumen: [ 'Lead de ALQUILER cualificado', resumenRespuestas, resumen ].filter(Boolean).join(' · '),
      detalle: [
        'Lead de ALQUILER cualificado por WhatsApp. La IA no agenda en alquiler:',
        'decide tu si le das visita.', '',
        ...respuestas.map(([k, v]) => `${k}: ${v || 'no facilitado'}`), '',
        `Resumen: ${resumen || 'sin resumen'}`,
      ].join('\n'),
      conversacion_id: Number(j.conversacion_id || 0),
      pasar_a_humano: true,
      etiqueta: '',
    },
    respuesta: alquiler
      ? 'Respuestas guardadas. Dile al cliente, con naturalidad, que le pasas sus datos a la asesora y que '
        + 'alguien del equipo le escribe por aqui para organizar la visita. No le ofrezcas fecha ni hora y '
        + 'no le hagas mas preguntas: a partir de ahora la conversacion la lleva una persona.'
      : 'Respuestas guardadas. Ahora ofrecele directamente la visita: preguntale que dia y a que hora le '
        + 'viene bien y consulta la agenda con BuscarDisponibilidadCalendario.',
  }
}];
