// [WA] 2 · Asistente · ContextoDelLead
// Junta en un bloque de texto lo que ya sabemos de esta persona: de que portal
// vino, que inmueble pidio (y su enlace), si es compra o alquiler, que
// comercial le toca y que preguntas de cualificacion estan ya contestadas.
// Es lo que el agente lee antes de escribir, para no volver a preguntar.
const d = $('JuntarMensajes').first().json;
const e = $('EntradaMensaje').first().json;

// La consulta a Postgres puede no devolver nada: el cliente puede escribir al
// numero sin haber pasado por un portal.
const fila = ($input.all().map(i => i.json).find(f => f && f.telefono_wa) ?? {});

const hay = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const val = (v) => (hay(v) ? String(v).trim() : 'no lo sabemos');

const esAlq = fila.es_alquiler === true || esAlquiler(fila.referencia, fila.operacion);
const asesora = hay(fila.asesora) ? fila.asesora : resolverAsesora(fila.referencia).destinatario;

const PREGUNTAS_ALQUILER = [
  ['personas', 'para cuantas personas seria la vivienda', fila.q_personas],
  ['ingresos', 'ingresos fijos demostrables (nomina o contrato)', fila.q_ingresos],
  ['mascotas', 'si conviven con alguna mascota', fila.q_mascotas],
  ['entrada', 'para que fecha necesitan entrar a vivir', fila.q_entrada],
];
const PREGUNTAS_COMPRA = [
  ['tiempo_buscando', 'cuanto tiempo lleva buscando para comprar', fila.q_tiempo_buscando],
  ['necesita_vender', 'si necesita vender una vivienda para poder comprar', fila.q_necesita_vender],
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
    : '- Ya tienes todas las preguntas: no vuelvas a preguntar.',
  esAlq ? '- OJO: es ALQUILER. No se agenda: preguntas, guardarCualificacion y pasa al equipo.' : '',
];
if (hay(fila.notas)) lineas.push(`- Notas internas: ${fila.notas}`);

return [{
  json: {
    contexto: lineas.filter(Boolean).join('\n'),
    es_alquiler: esAlq,
    referencia: hay(fila.referencia) ? String(fila.referencia) : '',
    asesora,
    telefono_e164: d.telefono_e164,
    telefono_wa: d.telefono_wa,
    nombre: hay(fila.nombre) ? fila.nombre : (d.nombre || ''),
    conversacion_id: d.conversacion_id,
    cuenta_id: d.cuenta_id,
    mensaje: d.mensaje,
    preguntas_pendientes: pendientes.map(([k]) => k),
  }
}];
