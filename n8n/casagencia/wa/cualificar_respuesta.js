// [WA][SUB] guardarCualificacion · Respuesta
// En alquiler, si el aviso al equipo no ha salido, el agente tiene que saberlo:
// no puede decirle al cliente que el equipo ya tiene sus datos.
const p = $('Preparar').first().json;
if (!p.es_alquiler) return [{ json: { respuesta: p.respuesta } }];
let aviso = {};
try { aviso = $('PasarAlEquipo').first().json || {}; } catch (e) { aviso = {}; }
return [{ json: { respuesta: aviso.mensaje_registrado === true
  ? p.respuesta
  : 'Respuestas guardadas, pero el aviso al equipo NO ha salido. No le digas que ya lo tienen: dile que ha ' +
    'habido un problema tecnico y que el equipo revisara su solicitud; y vuelve a intentarlo con avisarEquipo.' } }];
