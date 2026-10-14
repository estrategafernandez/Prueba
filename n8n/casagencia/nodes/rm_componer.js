// registrarMensaje · ComponerAviso
// Arma el aviso que reciben Carmen, Gisela o Laurence (y Paco) por WhatsApp,
// por [WA][SUB] AvisoEquipo. Antes salia por correo. El destinatario se
// normaliza aqui: si no casa con ninguno, va a Laurence.
const b = ($input.first().json.body) ?? {};

const BUZON = {
  Carmen: 'carmen@casagencia.com',
  Gisela: 'gisela@casagencia.com',
  Laurence: 'laurence@casagencia.com'
};
const destinatario = BUZON[b.destinatario] ? b.destinatario : 'Laurence';
const para = `${BUZON[destinatario]}, paco@casagencia.com`;

const tel = normalizarTelefono(b.telefono);
const nombre = String(b.nombre || '').trim() || 'Sin nombre';
const tipo = String(b.tipo_llamada || '').trim();
const esLeadAlquiler = tipo === 'lead_alquiler';

// Cualificacion de alquiler (solo viene en los leads de alquiler)
const cualificacion = [
  ['Nº de personas', b.alquiler_personas],
  ['Ingresos fijos / contrato', b.alquiler_ingresos],
  ['Mascotas', b.alquiler_mascotas],
  ['Fecha de entrada', b.alquiler_entrada],
  ['Duración', b.alquiler_duracion]
].filter(([, v]) => String(v || '').trim());

// Cualificacion de compra: las tres preguntas. Llegan aqui cuando la visita no
// se ha podido cerrar, para que ese trabajo no se pierda.
const cualificacionCompra = [
  ['Lleva buscando', b.compra_tiempo_buscando],
  ['Necesita vender', b.compra_necesita_vender],
  ['Vivienda que vende', b.compra_vivienda_venta],
  ['Financiación', b.compra_financiacion]
].filter(([, v]) => String(v || '').trim());

const lineas = [
  `Cliente: ${nombre}`,
  `Teléfono: ${tel.e164 || b.telefono || '-'}`,
];
if (b.email) lineas.push(`Email: ${b.email}`);
lineas.push(`Motivo: ${b.motivo || '-'}`);
if (b.urgencia) lineas.push(`Urgencia: ${b.urgencia}`);

if (cualificacion.length) {
  lineas.push('', '--- CUALIFICACIÓN DEL ALQUILER ---');
  for (const [k, v] of cualificacion) lineas.push(`${k}: ${v}`);
}

if (cualificacionCompra.length) {
  lineas.push('', '--- CUALIFICACIÓN DE LA COMPRA ---');
  for (const [k, v] of cualificacionCompra) lineas.push(`${k}: ${v}`);
}

lineas.push('', '--- RESUMEN DE LA LLAMADA ---', String(b.resumen_conversacion || '-'));

if (esLeadAlquiler) {
  lineas.push('',
    'NOTA: en alquiler la IA no agenda la visita. Se le ha dicho al cliente que',
    'le llamarás tú para organizarla una vez valorado el perfil.');
}

const asunto = esLeadAlquiler
  ? `LEAD ALQUILER (sin agendar) - ${nombre} - ${tel.nacional || b.telefono || ''} - ${b.motivo || ''}`
  : `${nombre} - ${tel.nacional || b.telefono || ''} - ${b.motivo || ''}`;

// Para el WhatsApp, lo esencial en una linea (AvisoEquipo lo recorta)
const corto = [
  esLeadAlquiler ? 'LEAD ALQUILER (sin agendar)' : '',
  String(b.motivo || '').trim(),
  b.urgencia ? `Urgencia: ${String(b.urgencia).trim()}` : '',
  cualificacion.concat(cualificacionCompra).map(([, v]) => String(v).trim()).join(' · '),
  String(b.resumen_conversacion || '').trim(),
].filter(Boolean).join(' · ');

// Lo que ha contestado el cliente por telefono se guarda tambien en su ficha de
// WhatsApp (wa_leads): asi, si luego escribe, Sara NO le vuelve a preguntar lo
// mismo. "no facilitado" tambien cuenta como contestado: ya se le pregunto.
const q = (v) => String(v ?? '').trim().slice(0, 200);
const cualificacionWa = {
  guardar: (esLeadAlquiler && cualificacion.length > 0) || cualificacionCompra.length > 0,
  // En WhatsApp el telefono va sin el '+' (34600111222)
  telefono_wa: tel.digitos,
  telefono_e164: tel.e164,
  referencia: String(b.referencia || '').trim(),
  nombre: nombre === 'Sin nombre' ? '' : nombre,
  asesora: destinatario === 'Laurence' ? '' : destinatario,
  q_personas: q(b.alquiler_personas),
  q_ingresos: q(b.alquiler_ingresos),
  q_mascotas: q(b.alquiler_mascotas),
  q_entrada: q(b.alquiler_entrada),
  q_duracion: q(b.alquiler_duracion),
  q_tiempo_buscando: q(b.compra_tiempo_buscando),
  q_necesita_vender: q(b.compra_necesita_vender),
  q_vivienda_venta: q(b.compra_vivienda_venta),
  q_financiacion: q(b.compra_financiacion),
  es_alquiler: esLeadAlquiler,
};

return [{
  json: {
    destinatario, para, asunto, cualificacion_wa: cualificacionWa,
    cuerpo: lineas.join('\n'),
    aviso: {
      accion: 'AVISO', destinatario, referencia: String(b.referencia || '').trim(), municipio: '',
      cliente_nombre: nombre === 'Sin nombre' ? '' : nombre, cliente_telefono: tel.e164 || String(b.telefono || ''),
      cita: '', resumen: corto, detalle: lineas.join('\n'), conversacion_id: 0, pasar_a_humano: false,
      etiqueta: '', origen: 'telefono',
    },
    es_lead_alquiler: esLeadAlquiler,
    respuesta: {
      mensaje_registrado: true,
      destinatario,
      mensaje_para_sara: `Aviso enviado a ${destinatario}. Diselo al cliente y despidete.`
    }
  }
}];
