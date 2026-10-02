// [WA][SUB] AvisoEquipo · Preparar
// Un solo sitio por el que salen TODOS los avisos al equipo, del asistente de
// WhatsApp y del asistente telefonico: pre-reserva, recordatorio de 24 h,
// llamada recibida, recado, lead de alquiler que tiene que coger una persona,
// o cualquier cosa que Sara no pueda resolver.
//
// SOLO por WhatsApp (sin correo), con la plantilla_aviso, directo a Meta (no por
// Chatwoot, para no abrir una conversacion de cliente con el comercial), a la
// comercial que toca Y a Paco (DIRECCION):
//   {{1}} el nombre de quien lo recibe
//   {{2}} de donde viene (telefono o WhatsApp) + que + quien + resumen CORTO +
//         que tiene que hacer + enlace al chat, en una linea
const j = $input.first().json || {};
const r = resolverAsesora(j.referencia, j.municipio);
// Si el agente dice a quien va, manda eso; si no, el reparto por referencia/zona.
const quien = EQUIPO[String(j.destinatario ?? '').trim()] ? String(j.destinatario).trim() : r.destinatario;
const para = EQUIPO[quien];

const tel = normalizarTelefono(j.cliente_telefono);
// Conversacion de prueba: el aviso es el mismo, pero llega solo al que prueba.
const prueba = esPrueba(j.cliente_telefono);
const conv = Number(j.conversacion_id || 0);
const enlaceChat = conv ? `${CHATWOOT_URL}/app/accounts/${CHATWOOT_CUENTA}/conversations/${conv}` : '';

const ACCION = String(j.accion ?? 'AVISO').toUpperCase().trim();
// De donde viene el aviso: del asistente telefonico o del de WhatsApp
const telefonico = /^tel/i.test(String(j.origen ?? '')) || ACCION === 'LLAMADA';
const ORIGEN = telefonico ? '📞 ASISTENTE TELEFÓNICO' : '💬 ASISTENTE WHATSAPP';

const QUE_HACER = {
  'PRE-RESERVA': 'Llámale para confirmarla o muévela en tu calendario',
  'VISITA AGENDADA': 'Confírmale la visita',
  'RECORDATORIO': 'Visita en 24 h: si no la has confirmado, llámale',
  'LLAMADA': 'Revisa la llamada en el panel y llámale si hace falta',
  'INTERVENIR': 'Entra en el chat de WhatsApp y llévalo tú',
  'AVISO': telefonico ? 'Devuélvele la llamada' : 'Revísalo y contéstale',
};
const queHacer = QUE_HACER[ACCION] || QUE_HACER.AVISO;

const partes = [
  `${prueba ? '[PRUEBA] ' : ''}${ORIGEN} · ${ACCION}`,
  j.cita ? String(j.cita) : '',
  j.referencia ? `Inmueble ${String(j.referencia).toUpperCase()}` : '',
  [String(j.cliente_nombre ?? '').trim(), tel.e164].filter(Boolean).join(' '),
  recortar(j.resumen, AVISO_RESUMEN_MAX),
  queHacer,
  enlaceChat ? `Chat: ${enlaceChat}` : '',
].filter(Boolean);
const aviso = paramPlantilla(partes.join(' · '), AVISO_MAX);

const plantilla = (nombre, movil) => ({
  messaging_product: 'whatsapp',
  to: movil,
  type: 'template',
  template: {
    name: PLANTILLAS.aviso.nombre,
    language: { code: PLANTILLAS.aviso.idioma },
    components: [{ type: 'body', parameters: [
      { type: 'text', text: paramPlantilla(nombre, 60) },
      { type: 'text', text: aviso },
    ] }],
  },
});
// A la comercial y a Paco. En pruebas, un solo mensaje al que prueba.
const destinos = prueba
  ? [{ nombre: `${quien} y ${DIRECCION.nombre}`, movil: PRUEBAS.avisar_movil }]
  : [{ nombre: quien, movil: para.movil },
     ...(DIRECCION.movil && DIRECCION.movil !== para.movil ? [{ nombre: DIRECCION.nombre, movil: DIRECCION.movil }] : [])];

const pasarAHumano = j.pasar_a_humano === true || String(j.pasar_a_humano).toLowerCase() === 'true';
const etiquetas = [String(j.etiqueta ?? '').trim(), pasarAHumano ? ETIQUETAS.intervenir : '']
  .filter(Boolean).join(',');

return [{
  json: {
    para_nombre: quien,
    para_movil: destinos[0].movil,
    destinos: destinos.map(d => d.nombre),
    es_prueba: prueba,
    origen: telefonico ? 'telefono' : 'whatsapp',
    aviso,
    envios: destinos.map(d => ({ para: d.nombre, meta_body: plantilla(d.nombre, d.movil) })),
    conversacion_id: conv,
    etiquetas,
    pasar_a_humano: pasarAHumano,
    // Nota en el historial de eGO (contacto o lead del cliente) con lo hablado.
    // Solo los de WhatsApp: el recordatorio repetiria la pre-reserva y las
    // llamadas ya ponen su propia nota ([TEL] Llamada al panel).
    nota_ego_si: !telefonico && ACCION !== 'RECORDATORIO' && tel.valido,
    nota_ego: [
      [
        `WhatsApp · Sara (IA de Casagencia) · ${ACCION}${prueba ? ' [PRUEBA]' : ''}`,
        j.cita ? `Visita: ${j.cita}` : '',
        j.referencia ? `Inmueble: ${String(j.referencia).toUpperCase()}` : '',
        `Asesora: ${quien}`,
      ].filter(Boolean).join('\n'),
      String(j.detalle ?? j.resumen ?? '').trim() || 'sin resumen',
      enlaceChat ? `Conversacion: ${enlaceChat}` : '',
    ].filter(Boolean).join('\n\n'),
    cliente_telefono_e164: tel.e164,
    // La conversacion se asigna en el panel a la asesora de la referencia (o a
    // quien va el aviso si no hay referencia). En pruebas no se toca.
    agente_id: prueba ? 0 : agenteDe(r.conocida ? r.destinatario : quien),
  }
}];
