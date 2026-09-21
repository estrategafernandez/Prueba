// BuscarDisponibilidadCalendario · PrepararDatos
// Normaliza la peticion de Retell y resuelve la asesora ANTES de tocar el calendario.
const body = ($input.first().json.body) ?? {};
const ahora = DateTime.now().setZone(ZONA);

const tel = normalizarTelefono(body.telefono);
const r = resolverAsesora(body.referencia);

const fecha = String(body.fecha ?? '').trim();
const hora = String(body.hora ?? '').trim();
const fechaOk = DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: ZONA }).isValid;
const horaOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);

return [{
  json: {
    nombre: String(body.nombre ?? '').trim(),
    telefono_e164: tel.e164,
    telefono_nacional: tel.nacional,
    telefono_valido: tel.valido,
    telefono_original: tel.original,
    referencia: String(body.referencia ?? '').trim().toUpperCase(),
    tipo_transaccion: String(body.tipo_transaccion ?? '').toLowerCase(),
    fecha, hora, fecha_ok: fechaOk, hora_ok: horaOk,
    // el nodo de calendario necesita SIEMPRE una fecha parseable
    fecha_consulta: fechaOk ? fecha : ahora.toFormat('yyyy-MM-dd'),
    prefijo: r.prefijo,
    asesora: r.asesora,
    asesora_conocida: r.conocida,
    calendario: r.calendario,
    ahora_iso: ahora.toISO()
  }
}];
