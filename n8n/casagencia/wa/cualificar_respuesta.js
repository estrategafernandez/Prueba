// [WA][SUB] guardarCualificacion · Respuesta
// En alquiler: si faltan respuestas, Sara tiene que preguntarlas antes de pasar
// la conversacion al equipo. Y si el aviso al equipo no ha salido, tiene que
// saberlo: no puede decirle al cliente que el equipo ya tiene sus datos.
const p = $('Preparar').first().json;
if (!p.es_alquiler) return [{ json: { respuesta: p.respuesta } }];
const f = $('FaltaAlquiler').first().json;
if (f.faltan.length) {
  return [{ json: { respuesta: 'Respuestas guardadas, pero todavia NO se pasa al equipo: falta ' + f.faltan.join(', ')
    + '. Preguntaselo (una cosa cada vez) y vuelve a usar guardarCualificacion solo con ese dato. Aun no le digas '
    + 'que le pasas sus datos a la asesora.' } }];
}
let aviso = {};
try { aviso = $('PasarAlEquipo').first().json || {}; } catch (e) { aviso = {}; }
return [{ json: { respuesta: aviso.mensaje_registrado === true
  ? p.respuesta
  : 'Respuestas guardadas, pero el aviso al equipo NO ha salido. No le digas que ya lo tienen: dile que ha ' +
    'habido un problema tecnico y que el equipo revisara su solicitud; y vuelve a intentarlo con avisarEquipo.' } }];
