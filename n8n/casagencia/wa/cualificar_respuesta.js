// [WA][SUB] guardarCualificacion · Respuesta
// En alquiler: si faltan respuestas, Sara tiene que preguntarlas antes de pasar
// la conversacion al equipo. Y si el aviso al equipo no ha salido, tiene que
// saberlo: no puede decirle al cliente que el equipo ya tiene sus datos.
const p = $('Preparar').first().json;

// --- COMPRA ---------------------------------------------------------------
// El orden es visita primero y preguntas despues, asi que aqui ya se sabe si la
// tiene pre-reservada: la ficha guardada lo dice.
if (!p.es_alquiler) {
  let ficha = {};
  try { ficha = $('GuardarFicha').first().json || {}; } catch (e) { ficha = {}; }
  const falta = p.falta_compra || [];
  const marcado = p.marcado_vendedor ? ' (y la conversacion marcada como vendedor)' : '';
  if (falta.length) {
    return [{ json: { respuesta: `Respuestas guardadas${marcado}. Falta ${falta[0]}: preguntaselo y guardalo `
      + 'con guardarCualificacion (solo ese dato). No le vuelvas a ofrecer fecha ni hora de visita.' } }];
  }
  const conCita = String(ficha.estado || '') === 'cita_agendada';
  const cuando = conCita && ficha.cita_fecha ? fechaLegible(ficha.cita_fecha, ficha.cita_hora) : '';
  const quien = quienSeEncarga(p.asesora);
  if (conCita) {
    let aviso = {};
    try { aviso = $('AvisarDeLaVisita').first().json || {}; } catch (e) { aviso = {}; }
    const salio = aviso.mensaje_registrado === true;
    return [{ json: { respuesta: `Respuestas guardadas${marcado}`
      + (salio ? ` y mandadas a ${p.asesora}` : '')
      + `. Ya tienes todo: la visita${cuando ? ' del ' + cuando : ''} esta pre-reservada y las dos preguntas `
      + `contestadas. Cierra ahora: dile que con esto ${quien} ya tiene todo lo que necesita para la visita y `
      + `que le llamara lo antes posible para confirmarsela. Nombrala, NO digas "alguien del equipo". No le `
      + 'vuelvas a preguntar nada ni le ofrezcas otra fecha.' } }];
  }
  return [{ json: { respuesta: `Respuestas guardadas${marcado}. OJO: todavia NO tiene visita. No le digas que `
    + 'la tiene. Ofrecesela ahora: preguntale que dia y a que hora le viene bien y consulta la agenda con '
    + 'BuscarDisponibilidadCalendario.' } }];
}

// --- ALQUILER -------------------------------------------------------------
const f = $('FaltaAlquiler').first().json;
if (f.faltan.length) {
  return [{ json: { respuesta: 'Respuestas guardadas, pero todavia NO se pasa al equipo: falta ' + f.faltan.join(', ')
    + '. Preguntaselo (una cosa cada vez) y vuelve a usar guardarCualificacion solo con ese dato. Aun no le digas '
    + 'que le pasas sus datos a la asesora.' } }];
}
let aviso = {};
try { aviso = $('PasarAlEquipo').first().json || {}; } catch (e) { aviso = {}; }
if (aviso.mensaje_registrado !== true) {
  return [{ json: { respuesta: 'Respuestas guardadas, pero el aviso al equipo NO ha salido. No le digas que ya lo ' +
    'tienen: dile que ha habido un problema tecnico y que el equipo revisara su solicitud; y vuelve a intentarlo ' +
    'con avisarEquipo.' } }];
}
// La asesora que ha recibido el aviso de verdad (la de la referencia), por su nombre
let zona = '';
try { zona = $('ResolverReferencia').first().json.municipio_cartera || ''; } catch (e) { zona = ''; }
const asesora = String(aviso.para || p.asesora || '').trim();
const quien = quienSeEncarga(asesora, zona);
const ella = ['Carmen', 'Gisela', 'Laurence'].includes(asesora) ? asesora : 'el equipo';
return [{ json: {
  asesora,
  respuesta: `Respuestas guardadas y aviso enviado a ${asesora || 'el equipo'}. Dile al cliente, con naturalidad, ` +
    `que le pasas sus datos a ${quien}, y que ${ella} se pondra en contacto con el para organizar la visita. ` +
    `Nombrala por su nombre: NO digas "alguien del equipo". No le ofrezcas fecha ni hora y no le vuelvas a hacer ` +
    `las preguntas. Si sigue escribiendo, contestale con normalidad, pero la visita la organiza ${ella}.`,
} }];
