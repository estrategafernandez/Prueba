// [WA][SUB] AvisoEquipo · Preparar
// Un solo sitio por el que salen TODOS los avisos al equipo: visita agendada,
// recordatorio de 24 h, lead de alquiler que tiene que coger una persona, o
// cualquier cosa que Sara no pueda resolver.
//
// Sale por WhatsApp con la plantilla_aviso, directo a Meta (no por Chatwoot,
// para no abrir una conversacion de cliente con el comercial):
//   {{1}} el nombre del comercial
//   {{2}} QUE TIENE QUE HACER + el resumen de la conversacion, en una linea
// Y por correo, con el detalle completo, por si el WhatsApp no llega (las
// plantillas de marketing Meta las puede frenar).
const j = $input.first().json || {};
const r = resolverAsesora(j.referencia, j.municipio);
// Si el agente dice a quien va, manda eso; si no, el reparto por referencia/zona.
const quien = EQUIPO[String(j.destinatario ?? '').trim()] ? String(j.destinatario).trim() : r.destinatario;
const para = EQUIPO[quien];

const tel = normalizarTelefono(j.cliente_telefono);
// Conversacion de prueba: el aviso es el mismo, pero llega al que prueba.
const prueba = esPrueba(j.cliente_telefono);
const conv = Number(j.conversacion_id || 0);
const enlaceChat = conv ? `${CHATWOOT_URL}/app/accounts/${CHATWOOT_CUENTA}/conversations/${conv}` : '';

const ACCION = String(j.accion ?? 'AVISO').toUpperCase().trim();
const QUE_HACER = {
  'PRE-RESERVA': 'Esta en tu calendario como PRE-RESERVA: llama al cliente para confirmarla (o muevela)',
  'VISITA AGENDADA': 'Confirmale la visita al cliente',
  'RECORDATORIO': 'Tienes esta visita en 24 horas (pre-reservada por Sara): si aun no la has confirmado, llama al cliente',
  'LLAMADA': 'Revisa la llamada en el panel y llama al cliente si hace falta',
  'INTERVENIR': 'Entra en la conversacion de WhatsApp y decide tu',
  'AVISO': 'Revisalo y contesta al cliente',
};

const partes = [
  ACCION,
  j.cita ? String(j.cita) : '',
  j.referencia ? `Inmueble ${String(j.referencia).toUpperCase()}` : '',
  [String(j.cliente_nombre ?? '').trim(), tel.e164].filter(Boolean).join(' '),
  String(j.resumen ?? '').trim(),
  QUE_HACER[ACCION] || QUE_HACER.AVISO,
  enlaceChat ? `Chat: ${enlaceChat}` : '',
].filter(Boolean);
const aviso = paramPlantilla((prueba ? '[PRUEBA] ' : '') + partes.join(' · '), 900);

const pasarAHumano = j.pasar_a_humano === true || String(j.pasar_a_humano).toLowerCase() === 'true';
const etiquetas = [String(j.etiqueta ?? '').trim(), pasarAHumano ? ETIQUETAS.intervenir : '']
  .filter(Boolean).join(',');

return [{
  json: {
    para_nombre: quien,
    para_movil: prueba ? PRUEBAS.avisar_movil : para.movil,
    es_prueba: prueba,
    aviso,
    meta_body: {
      messaging_product: 'whatsapp',
      to: prueba ? PRUEBAS.avisar_movil : para.movil,
      type: 'template',
      template: {
        name: PLANTILLAS.aviso.nombre,
        language: { code: PLANTILLAS.aviso.idioma },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: paramPlantilla(quien, 60) },
          { type: 'text', text: aviso },
        ] }],
      },
    },
    email_para: prueba ? PRUEBAS.avisar_email : [para.email, EMAIL_DIRECCION].filter(Boolean).join(', '),
    email_asunto: `${prueba ? '[PRUEBA] ' : ''}[WhatsApp] ${ACCION}: ${String(j.referencia ?? '').toUpperCase() || 'sin inmueble'} - `
      + `${String(j.cliente_nombre ?? '').trim() || 'cliente'} - ${tel.e164 || 'sin telefono'}`,
    email_cuerpo: [
      `${ACCION} (asistente de WhatsApp)`,
      '',
      j.cita ? `Visita: ${j.cita}` : '',
      `Inmueble: ${String(j.referencia ?? '').toUpperCase() || 'sin referencia'}`,
      `Cliente: ${String(j.cliente_nombre ?? '').trim() || 'sin nombre'}`,
      `Telefono: ${tel.e164 || 'sin telefono'}`,
      '',
      'Resumen de la conversacion:',
      String(j.detalle ?? j.resumen ?? '').trim() || 'sin resumen',
      '',
      `Que hay que hacer: ${QUE_HACER[ACCION] || QUE_HACER.AVISO}.`,
      enlaceChat ? `Conversacion: ${enlaceChat}` : '',
      '',
      `Tambien se ha enviado por WhatsApp a ${quien}.`,
    ].filter(x => x !== null).join('\n'),
    conversacion_id: conv,
    etiquetas,
    pasar_a_humano: pasarAHumano,
    // Las llamadas del telefono ya mandan su propio correo: de esas, solo WhatsApp
    enviar_correo: ACCION !== 'LLAMADA',
    // Nota en el historial de eGO (contacto o lead del cliente) con lo hablado.
    // El recordatorio no (repetiria la pre-reserva) y las llamadas la ponen ellas.
    nota_ego_si: !['RECORDATORIO', 'LLAMADA'].includes(ACCION) && tel.valido,
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
