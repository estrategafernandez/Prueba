// [WA] 2 · Asistente · ContextoDelLead
// Junta en un bloque de texto lo que ya sabemos de esta persona: de que portal
// vino, que inmueble pidio (y su enlace), si es compra o alquiler, que
// comercial le toca y que preguntas de cualificacion estan ya contestadas.
// Es lo que el agente lee antes de escribir, para no volver a preguntar.
const d = $('JuntarMensajes').first().json;
const e = $('EntradaMensaje').first().json;

// La consulta a Postgres puede no devolver nada: el cliente puede escribir al
// numero sin haber pasado por un portal.
const fila = ($('LeerFichaDelLead').all().map(i => i.json).find(f => f && f.telefono_wa) ?? {});

// La ficha COMPLETA del inmueble por el que pidio informacion va dentro del
// contexto en cada turno: Sara la tiene siempre delante y puede contestar
// cualquier duda sin llamar a ninguna herramienta.
let fichaInmueble = '';
let fichaEncontrada = false;
if (fila.referencia) {
  const cartera = leerCartera('LeerCartera');
  const { filas: encontrado } = buscarReferencia(cartera, fila.referencia);
  if (encontrado.length) {
    fichaInmueble = fichaTexto(encontrado[0], leerDirecciones('LeerDirecciones'));
    fichaEncontrada = true;
  } else if (cartera.length) {
    fichaInmueble = `${fila.referencia} ya no esta en la cartera actual: puede que se haya vendido o ` +
      'alquilado. Diselo con tacto, sin afirmarlo, y ofrecele parecidos con recomendarSimilares.';
  } else {
    fichaInmueble = 'No se ha podido leer la cartera ahora mismo. Si te pregunta por el inmueble, ' +
      'usa buscarPorReferencia; no inventes nada.';
  }
}

const hay = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const val = (v) => (hay(v) ? String(v).trim() : 'no lo sabemos');

// Si ha pedido informacion de varios inmuebles (una fila de wa_leads por cada
// uno), las otras solicitudes de los ultimos 30 dias. Las respuestas de
// cualificacion son de la persona, no del inmueble: valen las de cualquiera.
let otras = fila.otras_solicitudes ?? [];
if (typeof otras === 'string') { try { otras = JSON.parse(otras); } catch (e) { otras = []; } }
otras = [].concat(otras || []).filter(o => o && hay(o.referencia));
const q = (k) => (hay(fila[k]) ? fila[k] : (otras.find(o => hay(o[k])) || {})[k]);

const esAlq = fila.es_alquiler === true || esAlquiler(fila.referencia, fila.operacion);
const asesora = hay(fila.asesora) ? fila.asesora : resolverAsesora(fila.referencia).destinatario;

const PREGUNTAS_ALQUILER = [
  ['personas', 'para cuantas personas seria la vivienda', q('q_personas')],
  ['ingresos', 'ingresos fijos demostrables (nomina o contrato)', q('q_ingresos')],
  ['mascotas', 'si conviven con alguna mascota', q('q_mascotas')],
  ['entrada', 'para que fecha necesitan entrar a vivir', q('q_entrada')],
];
// Si tiene que vender, la direccion o zona de esa vivienda es una pregunta mas.
const vendedor = hay(q('q_vivienda_venta')) || esAfirmativo(q('q_necesita_vender'));
const PREGUNTAS_COMPRA = [
  ['tiempo_buscando', 'cuanto tiempo lleva buscando para comprar', q('q_tiempo_buscando')],
  ['necesita_vender', 'si necesita vender una vivienda para poder comprar', q('q_necesita_vender')],
  ...(vendedor ? [['vivienda_a_vender', 'direccion o zona de la vivienda que tiene que vender', q('q_vivienda_venta')]] : []),
  ['financiacion', 'como lo va a financiar (hipoteca, recursos propios o hipoteca ya preconcedida)', q('q_financiacion')],
];
const lista = esAlq ? PREGUNTAS_ALQUILER : PREGUNTAS_COMPRA;
const contestadas = lista.filter(([, , v]) => hay(v));
const pendientes = lista.filter(([, , v]) => !hay(v));

const lineas = [
  `- Cliente: ${hay(fila.nombre) ? fila.nombre : (d.nombre || 'sin nombre')}`,
  `- Telefono (ya lo tienes, no lo pidas): ${d.telefono_e164}`,
  `- Como ha llegado: ${hay(fila.telefono_wa) ? 'solicitud de un portal (ya le mandamos la plantilla de bienvenida)' : 'ha escrito el directamente, sin solicitud previa'}`,
  `- Portal: ${val(fila.portal)}`,
  `- Referencia del inmueble que pidio: ${val(fila.referencia)}`,
  hay(fila.enlace) ? `- Enlace del anuncio: ${fila.enlace}` : '',
  `- Operacion: ${esAlq ? 'ALQUILER' : (hay(fila.operacion) ? 'COMPRA' : 'no lo sabemos')}`,
  `- Comercial que le corresponde: ${asesora}`,
  `- Estado de la conversacion: ${(e.etiquetas || []).join(', ') || 'sin etiqueta'}`,
  contestadas.length
    ? `- Ya ha contestado: ${contestadas.map(([, k, v]) => `${k} = ${v}`).join('; ')}`
    : '- Todavia no ha contestado ninguna pregunta de cualificacion.',
  pendientes.length
    ? `- Te faltan: ${pendientes.map(([, k]) => k).join('; ')}`
    : '- Ya tienes todas las preguntas y estan guardadas: no vuelvas a preguntar ni a ejecutar guardarCualificacion.',
  fila.estado === 'cita_agendada'
    ? `- VISITA YA REGISTRADA${hay(fila.cita_fecha) ? ` el ${fechaLegible(fila.cita_fecha, fila.cita_hora)}` : ''}: `
      + 'no la vuelvas a reservar. Si quiere cambiarla o anularla, avisarEquipo.'
    : '',
  esAlq ? '- OJO: es ALQUILER. No se agenda: preguntas, guardarCualificacion y pasa al equipo.' : '',
];
if (otras.length) {
  const todas = [fila, ...otras].map(o => `${o.referencia}${hay(o.enlace) ? ` (${o.enlace})` : ''}` +
    ` - ${o.es_alquiler === true || esAlquiler(o.referencia, o.operacion) ? 'alquiler' : 'compra'}`);
  lineas.push(`- HA PEDIDO INFORMACION DE ${todas.length} INMUEBLES (le escribimos por cada uno: la bienvenida ` +
    `y "Tambien he visto que te has interesado por este otro inmueble"): ${todas.join('; ')}. Tenlos presentes ` +
    'todos; las preguntas de cualificacion valen para todos.');
}
if (hay(fila.notas)) lineas.push(`- Notas internas: ${fila.notas}`);
if (fichaInmueble) {
  lineas.push('', 'FICHA DEL INMUEBLE POR EL QUE PIDIO INFORMACION (datos reales de la cartera; lo que ' +
    'no este aqui, no lo sabes):', fichaInmueble);
}
// Y la de cada uno de los otros que ha pedido
if (otras.length) {
  const cartera = leerCartera('LeerCartera');
  const dirs = leerDirecciones('LeerDirecciones');
  for (const o of otras.slice(0, 3)) {
    const { filas: f } = buscarReferencia(cartera, o.referencia);
    lineas.push('', `FICHA DEL OTRO INMUEBLE QUE PIDIO (${o.referencia}):`,
      f.length ? fichaTexto(f[0], dirs)
        : `${o.referencia} ya no esta en la cartera actual: diselo con tacto y ofrecele parecidos.`);
  }
}

return [{
  json: {
    contexto: lineas.filter(Boolean).join('\n'),
    es_alquiler: esAlq,
    referencia: hay(fila.referencia) ? String(fila.referencia) : '',
    otras_referencias: otras.map(o => String(o.referencia)),
    asesora,
    telefono_e164: d.telefono_e164,
    telefono_wa: d.telefono_wa,
    nombre: hay(fila.nombre) ? fila.nombre : (d.nombre || ''),
    conversacion_id: d.conversacion_id,
    cuenta_id: d.cuenta_id,
    mensaje: d.mensaje,
    preguntas_pendientes: pendientes.map(([k]) => k),
    ficha_cargada: fichaEncontrada,
  }
}];
