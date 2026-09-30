// [WA] 3 · Recordatorio · VisitasDeWhatsApp
// De todo lo que hay en las agendas de Carmen y Gisela en la ventana, se
// quedan SOLO las visitas que agendo el asistente de WhatsApp (las del
// telefono no llevan la marca) y que aun no se han avisado.
const eventos = $input.all().map(i => i.json).filter(e => e && e.id && e.start);
const campo = (texto, nombre) => {
  const m = String(texto ?? '').match(new RegExp('^' + nombre + ':\\s*(.+)$', 'mi'));
  return m ? m[1].trim() : '';
};

const vistos = new Set();
const salida = [];
for (const e of eventos) {
  if (e.status === 'cancelled') continue;
  if (!String(e.description ?? '').includes(MARCA_ORIGEN)) continue;
  if (vistos.has(e.id)) continue;
  vistos.add(e.id);

  const ini = DateTime.fromISO(e.start.dateTime || e.start.date, { zone: ZONA });
  const desc = e.description;
  salida.push({ json: {
    evento_id: e.id,
    destinatario: campo(desc, 'Asesora'),
    referencia: campo(desc, 'Referencia'),
    cliente_nombre: campo(desc, 'Cliente'),
    cliente_telefono: campo(desc, 'Telefono'),
    conversacion_id: Number(campo(desc, 'Conversacion') || 0),
    cita: fechaLegible(ini.toFormat('yyyy-MM-dd'), ini.toFormat('HH:mm')),
    accion: 'RECORDATORIO',
    resumen: campo(desc, 'Resumen'),
  } });
}
return salida;
