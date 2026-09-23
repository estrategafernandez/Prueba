// BuscarDisponibilidadCalendario · CalcularDisponibilidad
// Unico punto donde se decide si hay hueco. Aplica, por este orden:
//   1) asesora conocida   2) formato   3) fecha pasada   4) festivo
//   5) dia cerrado        6) horario de oficina          7) ocupacion real
const d = $('PrepararDatos').first().json;
const ahora = DateTime.fromISO(d.ahora_iso, { zone: ZONA });
const salida = (o) => [{ json: { respuesta: o } }];

if (!d.asesora_conocida) {
  return salida({
    disponible: false, motivo: 'referencia_desconocida',
    mensaje_para_sara: 'No consigo identificar a que asesora corresponde esa referencia. Confirma la referencia con el cliente; si sigue sin cuadrar, registra un mensaje para que le llamen.'
  });
}
if (esPeticionAlquiler(d.referencia, d.tipo_transaccion)) {
  return salida({
    disponible: false, motivo: 'alquiler_sin_agenda', asesora: d.asesora,
    mensaje_para_sara: MSG_ALQUILER_SIN_AGENDA
  });
}
if (!d.fecha_ok || !d.hora_ok) {
  return salida({
    disponible: false, motivo: 'formato',
    mensaje_para_sara: 'No he entendido bien la fecha o la hora. Pidele al cliente que la repita.'
  });
}

const ocupados = rangosOcupados($input.all());
const v = validarFranja(d.fecha, d.hora, d.asesora, d.prefijo, ahora);
const libre = estaLibre(d.fecha, d.hora, ocupados);

if (v.valido && libre) {
  return salida({
    disponible: true, motivo: 'ok', asesora: d.asesora,
    fecha: d.fecha, hora: d.hora, dia: nombreDia(d.fecha),
    mensaje_para_sara: `Hay hueco el ${nombreDia(d.fecha)} a las ${d.hora}. Confirmalo con el cliente y, si acepta, crea la cita.`
  });
}

// ---- Alternativas: primero el mismo dia (las mas cercanas a la hora pedida),
// ---- y si no hay, los siguientes dias laborables.
const pedida = DateTime.fromFormat(`${d.fecha} ${d.hora}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
const cercania = (h) =>
  Math.abs(DateTime.fromFormat(`${d.fecha} ${h}`, 'yyyy-MM-dd HH:mm', { zone: ZONA })
    .diff(pedida).as('minutes'));

const alternativas = huecosDelDia(d.fecha, d.asesora, d.prefijo, ocupados, ahora)
  .sort((a, b) => cercania(a) - cercania(b))
  .slice(0, 3)
  .map(h => ({ fecha: d.fecha, hora: h, dia: nombreDia(d.fecha) }));

if (alternativas.length < 3) {
  let f = DateTime.fromFormat(d.fecha, 'yyyy-MM-dd', { zone: ZONA });
  for (let i = 0; i < 7 && alternativas.length < 3; i++) {
    f = f.plus({ days: 1 });
    const fs = f.toFormat('yyyy-MM-dd');
    for (const h of huecosDelDia(fs, d.asesora, d.prefijo, ocupados, ahora)) {
      alternativas.push({ fecha: fs, hora: h, dia: nombreDia(fs) });
      if (alternativas.length >= 3) break;
    }
  }
}

const EXPLICACION = {
  festivo: 'ese dia es festivo y la oficina esta cerrada',
  cerrado: 'ese dia la oficina no abre',
  fuera_horario: 'esa hora queda fuera del horario de visitas',
  pasado: 'esa fecha ya ha pasado',
  ocupado: 'esa hora ya esta ocupada'
};
const motivo = v.valido ? 'ocupado' : v.motivo;
const porque = EXPLICACION[motivo] || 'no es posible a esa hora';

const listado = alternativas.map(a => `${a.dia} a las ${a.hora}`).join('; ');
const mensaje = alternativas.length
  ? `No puede ser: ${porque}. Diselo al cliente con naturalidad y ofrecele SOLO estas opciones: ${listado}. No inventes otras horas.`
  : `No puede ser: ${porque}, y no me quedan huecos en los proximos dias. Pidele al cliente otra fecha o registra un mensaje para que la asesora le llame.`;

return salida({
  disponible: false, motivo, asesora: d.asesora,
  fecha: d.fecha, hora: d.hora, alternativas,
  horario_asesora: bloquesDelDia(d.fecha, d.asesora),
  mensaje_para_sara: mensaje
});
