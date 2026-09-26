// [WA] 2 · Asistente · ContextoDelLead
// Junta en un bloque de texto lo que ya sabemos de esta persona: de que portal
// vino, que inmueble pidio, si es compra o alquiler, que asesora le toca y que
// preguntas de cualificacion estan ya contestadas. Es lo que el agente lee
// antes de escribir, para no volver a preguntar lo mismo.
const d = $('JuntarMensajes').first().json;

// La consulta a Postgres puede no devolver nada: el cliente puede escribir al
// numero sin haber pasado por un portal.
const fila = ($input.all().map(i => i.json).find(f => f && f.telefono_wa) ?? {});

const hay = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const val = (v) => (hay(v) ? String(v).trim() : 'no lo sabemos');

const esAlq = fila.es_alquiler === true || esAlquiler(fila.referencia, fila.operacion);
const r = resolverAsesora(fila.referencia);
const asesora = hay(fila.asesora) ? fila.asesora : (r.asesora || 'sin asignar');

const preguntasAlquiler = [
  ['personas que van a vivir', fila.q_personas],
  ['ingresos o contrato de trabajo', fila.q_ingresos],
  ['mascotas', fila.q_mascotas],
  ['cuando necesita entrar', fila.q_entrada],
  ['todo el ano o temporada', fila.q_duracion],
];
const preguntasCompra = [
  ['para cuando quiere comprar', fila.q_cuando],
  ['zona que le interesa', fila.q_zona],
  ['presupuesto', fila.q_presupuesto],
  ['financiacion o hipoteca', fila.q_financiacion],
];
const lista = esAlq ? preguntasAlquiler : preguntasCompra;

const contestadas = lista.filter(([, v]) => hay(v) && String(v).toLowerCase() !== 'no facilitado');
const pendientes = lista.filter(([, v]) => !hay(v));

const lineas = [
  `- Cliente: ${hay(fila.nombre) ? fila.nombre : (d.nombre || 'sin nombre')}`,
  `- Telefono: ${d.telefono_e164}`,
  `- Ficha del lead: ${hay(fila.telefono_wa) ? 'si, vino de un portal' : 'no, ha escrito el directamente'}`,
  `- Portal de origen: ${val(fila.portal)}`,
  `- Referencia del inmueble que pidio: ${val(fila.referencia)}`,
  `- Operacion: ${esAlq ? 'ALQUILER' : (hay(fila.operacion) ? fila.operacion : 'no lo sabemos')}`,
  `- Asesora que le corresponde: ${asesora}`,
  `- Estado: ${val(fila.estado)}`,
  contestadas.length
    ? `- Ya nos ha contestado: ${contestadas.map(([k, v]) => `${k} = ${v}`).join('; ')}`
    : '- Todavia no nos ha contestado ninguna pregunta de cualificacion.',
  pendientes.length
    ? `- Te faltan por preguntar: ${pendientes.map(([k]) => k).join('; ')}`
    : '- Ya tienes todas las preguntas contestadas: no vuelvas a preguntar.',
];
if (hay(fila.notas)) lineas.push(`- Notas internas: ${fila.notas}`);
if (esAlq) lineas.push('- OJO: es ALQUILER. No se agenda visita: se cualifica y llama la asesora.');

return [{
  json: {
    contexto: lineas.join('\n'),
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
