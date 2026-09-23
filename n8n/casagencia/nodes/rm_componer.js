// registrarMensaje · ComponerAviso
// Arma el correo que reciben Carmen, Gisela o Laurence. Antes habia un Switch
// con tres nodos de Gmail: si el destinatario no casaba con ninguno, no
// respondia nadie y Sara se quedaba colgada. Ahora se normaliza aqui.
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

lineas.push('', '--- RESUMEN DE LA LLAMADA ---', String(b.resumen_conversacion || '-'));

if (esLeadAlquiler) {
  lineas.push('',
    'NOTA: en alquiler la IA no agenda la visita. Se le ha dicho al cliente que',
    'le llamarás tú para organizarla una vez valorado el perfil.');
}

const asunto = esLeadAlquiler
  ? `LEAD ALQUILER (sin agendar) - ${nombre} - ${tel.nacional || b.telefono || ''} - ${b.motivo || ''}`
  : `${nombre} - ${tel.nacional || b.telefono || ''} - ${b.motivo || ''}`;

return [{
  json: {
    destinatario, para, asunto,
    cuerpo: lineas.join('\n'),
    es_lead_alquiler: esLeadAlquiler,
    respuesta: {
      mensaje_registrado: true,
      destinatario,
      mensaje_para_sara: `Aviso enviado a ${destinatario}. Diselo al cliente y despidete.`
    }
  }
}];
