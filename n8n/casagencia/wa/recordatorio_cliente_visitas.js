// [WA] 6 / [WA] 7 · Recordatorio al cliente · Visitas
// De lo que hay en las agendas de Carmen y Gisela en la ventana, las VISITAS:
// las que llevan el telefono del cliente en el titulo ("Visita inmueble - REF //
// Cliente: X // Telefono Cliente: +34..."), sean de WhatsApp o del telefono.
const v = $('Ventana').first().json;
const conf = RECORDATORIO_CLIENTE[v.tipo];
const eventos = $input.all().map(i => i.json).filter(e => e && e.id && e.start);
const campo = (texto, nombre) => {
  const m = String(texto ?? '').match(new RegExp('^' + nombre + ':\\s*(.+)$', 'mi'));
  return m ? m[1].trim() : '';
};
const ahora = DateTime.now().setZone(ZONA);
const vistos = new Set();
const salida = [];
for (const e of eventos) {
  if (e.status === 'cancelled' || vistos.has(e.id)) continue;
  vistos.add(e.id);
  const titulo = String(e.summary ?? '');
  if (!/visita inmueble/i.test(titulo)) continue;
  const telTitulo = (titulo.match(/Telefono Cliente:\s*([+\d][\d\s]{6,})/i) || [])[1] || '';
  const tel = normalizarTelefono(telTitulo || campo(e.description, 'Telefono'));
  if (!tel.valido) continue;
  const prereserva = /PRE-RESERVA/i.test(titulo);
  if (prereserva && !RECORDAR_PRERESERVAS) continue;
  const ini = DateTime.fromISO(e.start.dateTime || e.start.date, { zone: ZONA });
  // Reservada hace muy poco (menos de 6 h para el de 24 h, 1 h para el de 2 h):
  // el recordatorio llegaria casi a la vez que la confirmacion. No se manda.
  const creada = e.created ? DateTime.fromISO(e.created, { zone: ZONA }) : null;
  if (creada && ahora.diff(creada, 'hours').hours < Math.max(1, conf.horas / 4)) continue;
  const fecha = ini.toFormat('yyyy-MM-dd');
  const hora = ini.toFormat('HH:mm');
  const hoy = ini.hasSame(ahora, 'day');
  const manana = ini.hasSame(ahora.plus({ days: 1 }), 'day');
  const referencia = ((titulo.match(/Visita inmueble\s*-\s*([A-Z0-9-]+)/i) || [])[1] || campo(e.description, 'Referencia')).toUpperCase();
  const nombre = ((titulo.match(/Cliente:\s*([^/]+?)\s*\/\//i) || [])[1] || campo(e.description, 'Cliente')).trim();
  // La asesora: la del calendario en el que esta la visita
  const correoCal = String(e.organizer?.email ?? e.creator?.email ?? '').toLowerCase();
  const asesora = Object.keys(EQUIPO).find(n => EQUIPO[n].email === correoCal)
    || campo(e.description, 'Asesora') || resolverAsesora(referencia).destinatario;
  salida.push({ json: {
    tipo: v.tipo,
    evento_id: e.id,
    telefono: tel.e164,
    nombre: nombre.replace(/^PRUEBA\s+/i, '').split(/\s+/)[0] || '',
    nombre_completo: nombre,
    referencia,
    asesora,
    fecha,
    hora,
    fecha_hora: fechaLegible(fecha, hora),
    cuando: (hoy ? 'hoy' : manana ? 'mañana ' + fechaLegible(fecha, '').trim() : fechaLegible(fecha, '').trim()) + ` a las ${hora}`,
    prereserva,
    conversacion_id: Number(campo(e.description, 'Conversacion') || 0),
    // Solo se manda si la plantilla existe y esta activo (o es un telefono de prueba)
    enviar: !!conf.plantilla && (conf.activo === true || esPrueba(tel.e164)),
  } });
}
return salida;
