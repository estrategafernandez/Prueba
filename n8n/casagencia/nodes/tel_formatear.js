// BuscarCitaPorTelefono · FormatearCitas
// La busqueda "q" de Google puede traer falsos positivos, asi que aqui se
// vuelve a comprobar que el telefono aparece de verdad en el evento.
const d = $('NormalizarTelefono').first().json;
const ahora = DateTime.fromISO(d.ahora_iso, { zone: ZONA });

if (!d.telefono_valido) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'telefono_invalido',
    mensaje_para_sara: 'Ese telefono no me cuadra. Pideselo otra vez al cliente, cifra a cifra.'
  } } }];
}

const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');
const buscado = d.telefono_nacional;

const citas = [];
for (const it of $input.all()) {
  const e = it.json || {};
  if (!e.start || e.status === 'cancelled') continue;
  const texto = soloDigitos(`${e.summary || ''} ${e.description || ''}`);
  if (!buscado || !texto.includes(buscado)) continue;

  const ini = e.start.dateTime
    ? DateTime.fromISO(e.start.dateTime, { zone: ZONA })
    : DateTime.fromISO(e.start.date, { zone: ZONA });
  if (!ini.isValid) continue;

  const refM = String(`${e.summary || ''} ${e.description || ''}`).match(/\b([A-Z]{2}-[A-Z0-9-]+)\b/);
  const ref = refM ? refM[1] : '';
  const asesora = resolverAsesora(ref).asesora;

  citas.push({
    fecha: ini.toFormat('yyyy-MM-dd'),
    hora: ini.toFormat('HH:mm'),
    dia: nombreDia(ini.toFormat('yyyy-MM-dd')),
    referencia: ref,
    asesora,
    pasada: ini < ahora,
    _orden: ini.toMillis()
  });
}

citas.sort((a, b) => a._orden - b._orden);
const futuras = citas.filter(c => !c.pasada);
const lista = (futuras.length ? futuras : citas).map(({ _orden, ...c }) => c);

if (!lista.length) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'sin_citas',
    mensaje_para_sara: 'No encuentro ninguna visita a nombre de ese telefono. Confirmale el numero al cliente por si lo dio distinto, y si insiste en que tiene cita, registra un mensaje para que la asesora lo compruebe.'
  } } }];
}

const describir = (c) => `${c.dia} a las ${c.hora}` +
  (c.referencia ? ` (inmueble ${c.referencia}${c.asesora ? `, con ${c.asesora}` : ''})` : '');

return [{ json: { respuesta: {
  encontrado: true,
  total: lista.length,
  citas: lista,
  mensaje_para_sara: futuras.length
    ? `El cliente tiene ${futuras.length === 1 ? 'una visita' : `${futuras.length} visitas`}: ${lista.map(describir).join('; ')}. Recuerdale que sigue pendiente de confirmacion por parte de la asesora.`
    : `Solo encuentro visitas ya pasadas: ${lista.map(describir).join('; ')}. Preguntale si quiere concertar una nueva.`
} } }];
