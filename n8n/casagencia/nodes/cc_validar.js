// ConfirmarCitaCalendario · ValidarAntesDeInsertar
// SEGUNDO CORTAFUEGOS: aunque BuscarDisponibilidad haya dicho que si, aqui se
// vuelve a validar horario, festivo y ocupacion antes de escribir en la agenda.
const d = $('PrepararDatos').first().json;
const ahora = DateTime.fromISO(d.ahora_iso, { zone: ZONA });

const rechazo = (motivo, mensaje) => [{
  json: {
    ...d, puede_crear: false,
    respuesta: { cita_confirmada: false, motivo, mensaje_para_sara: mensaje }
  }
}];

if (!d.asesora_conocida) {
  return rechazo('referencia_desconocida',
    'No he podido registrar la cita porque no identifico la asesora de esa referencia. Explicaselo al cliente y registra un mensaje para que le llamen.');
}
if (!d.fecha_ok || !d.hora_ok) {
  return rechazo('formato',
    'No he podido registrar la cita porque no me cuadra la fecha o la hora. Pidele al cliente que la repita.');
}
if (!d.telefono_valido) {
  return rechazo('telefono_invalido',
    'No he podido registrar la cita porque el telefono no es valido. Pideselo otra vez, cifra a cifra.');
}

const v = validarFranja(d.fecha, d.hora, d.asesora, d.prefijo, ahora);
if (!v.valido) {
  const EXPL = {
    festivo: 'ese dia es festivo y la oficina esta cerrada',
    cerrado: 'ese dia la oficina no abre',
    fuera_horario: 'esa hora queda fuera del horario de visitas',
    pasado: 'esa fecha ya ha pasado',
    formato: 'no me cuadra la fecha o la hora'
  };
  return rechazo(v.motivo,
    `No he registrado la cita porque ${EXPL[v.motivo] || 'esa franja no es valida'}. Diselo al cliente y ofrecele otra hora dentro del horario.`);
}

const ocupados = rangosOcupados($input.all());
if (!estaLibre(d.fecha, d.hora, ocupados)) {
  return rechazo('ocupado',
    'No he registrado la cita porque esa hora acaba de ocuparse. Vuelve a consultar disponibilidad y ofrece otra hora.');
}

return [{
  json: {
    ...d,
    puede_crear: true,
    dia_texto: nombreDia(d.fecha),
    // Se guarda el telefono normalizado y ademas en formato nacional para que
    // BuscarCitaPorTelefono pueda encontrar la cita despues.
    titulo: `Visita inmueble - ${d.referencia} // Cliente: ${d.nombre} // Telefono Cliente: ${d.telefono_e164}`,
    descripcion: [
      `Cliente: ${d.nombre}`,
      `Telefono: ${d.telefono_e164}`,
      `Tel-busqueda: ${d.telefono_nacional}`,
      `Referencia: ${d.referencia}`,
      `Operacion: ${d.tipo_transaccion}`,
      `Asesora: ${d.asesora}`,
      '',
      'PRE-RESERVA creada por Sara (IA). Pendiente de confirmar con el cliente.'
    ].join('\n')
  }
}];
