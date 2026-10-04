// [WA][SUB] guardarCualificacion · FaltaAlquiler
// Lo que queda guardado en la ficha (las respuestas de esta vez y de las
// anteriores). En alquiler hacen falta las cuatro: personas, ingresos, mascotas
// y fecha de entrada; en locales y traspasos, la actividad y la fecha.
const p = $('Preparar').first().json;
let g = {};
try { g = $('GuardarFicha').first().json || {}; } catch (e) { g = {}; }
const v = (k) => String((g.id ? g[k] : p[k]) ?? '').trim();
const PIDE = v('q_actividad')
  ? [['q_actividad', 'para que actividad lo quiere'], ['q_entrada', 'para que fecha lo necesita']]
  : [['q_personas', 'para cuantas personas'], ['q_ingresos', 'si tienen ingresos fijos demostrables'],
     ['q_mascotas', 'si conviven con mascotas'], ['q_entrada', 'para que fecha necesitan entrar']];
const faltan = PIDE.filter(([k]) => !v(k)).map(([, t]) => t);
// El aviso con TODAS las respuestas guardadas (aunque llegaran en varias veces)
const ETQ = { q_personas: 'Personas', q_ingresos: 'Ingresos', q_mascotas: 'Mascotas', q_entrada: 'Entrada',
              q_actividad: 'Actividad' };
const datos = PIDE.map(([k]) => [ETQ[k], v(k)]).filter(([, x]) => x);
return [{ json: {
  completo: faltan.length === 0, faltan, ficha_id: g.id || null,
  resumen_aviso: ['ALQUILER cualificado', ...datos.map(([, x]) => recortar(x, 45)), p.resumen_sara]
    .filter(Boolean).join(' · '),
  detalle_aviso: ['Lead de ALQUILER cualificado por WhatsApp. La IA no agenda en alquiler: decide tu si le das visita.',
    '', ...datos.map(([k, x]) => `${k}: ${x}`), '', `Resumen: ${p.resumen_sara || 'sin resumen'}`].join('\n'),
} }];
