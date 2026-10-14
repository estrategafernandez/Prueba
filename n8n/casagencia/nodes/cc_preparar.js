// ConfirmarCitaCalendario · PrepararDatos
const body = ($input.first().json.body) ?? {};
const ahora = DateTime.now().setZone(ZONA);

const tel = normalizarTelefono(body.telefono);
const r = resolverAsesora(body.referencia);

const fecha = String(body.fecha ?? '').trim();
const hora = String(body.hora ?? '').trim();
const fechaOk = DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: ZONA }).isValid;
const horaOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);

// Las tres preguntas de compra, que Sara hace antes de mirar la agenda. Se
// guardan en la ficha de WhatsApp del cliente (wa_leads) y van en el aviso a la
// asesora. "no facilitado" cuenta como contestada: ya se le pregunto.
const q = (v) => String(v ?? '').trim().slice(0, 200);
const compra = {
  q_tiempo_buscando: q(body.compra_tiempo_buscando),
  q_necesita_vender: q(body.compra_necesita_vender),
  q_vivienda_venta: q(body.compra_vivienda_venta),
  q_financiacion: q(body.compra_financiacion),
};
const contestadas = [
  ['Lleva buscando', compra.q_tiempo_buscando],
  ['Necesita vender', compra.q_necesita_vender],
  ['Vivienda que vende', compra.q_vivienda_venta],
  ['Financiación', compra.q_financiacion],
].filter(([, v]) => v);

return [{
  json: {
    ...compra,
    // Las de alquiler no se preguntan aqui: en alquiler no se agenda
    q_personas: '', q_ingresos: '', q_mascotas: '', q_entrada: '', q_duracion: '',
    // Los nombres de aqui abajo los lee el nodo CualificacionParaWhatsApp
    // (VALORES_CUAL en build_workflows.py): si se cambia uno, se cambia alli.
    guardar: contestadas.length > 0,
    es_alquiler: esPeticionAlquiler(body.referencia, body.tipo_transaccion),
    cualificacion_texto: contestadas.map(([k, v]) => `${k}: ${v}`).join(' · '),
    nombre: String(body.nombre ?? '').trim() || 'Sin nombre',
    telefono_e164: tel.e164,
    // En WhatsApp el telefono va sin el '+' (34600111222)
    telefono_wa: tel.digitos,
    telefono_nacional: tel.nacional,
    telefono_valido: tel.valido,
    telefono_original: tel.original,
    referencia: String(body.referencia ?? '').trim().toUpperCase(),
    tipo_transaccion: String(body.tipo_transaccion ?? '').toLowerCase(),
    fecha, hora, fecha_ok: fechaOk, hora_ok: horaOk,
    fecha_consulta: fechaOk ? fecha : ahora.toFormat('yyyy-MM-dd'),
    prefijo: r.prefijo,
    asesora: r.asesora,
    asesora_conocida: r.conocida,
    calendario: r.calendario,
    ahora_iso: ahora.toISO()
  }
}];
