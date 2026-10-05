// [WA] 2 · Asistente · EntradaMensaje  (seccion "Llega el mensaje de WhatsApp")
// Chatwoot avisa de cada mensaje del cliente. Aqui se saca todo lo que hace
// falta del payload y se decide si es un mensaje que la IA debe atender. Los
// filtros del bot (como en Blue) van despues, en sus propios nodos IF.
//
// Chatwoot manda dos formas distintas de payload segun como este configurado:
//   A) webhook de cuenta  -> llega el MENSAJE, con la conversacion anidada
//   B) automatizacion o agent bot -> llega la CONVERSACION, con su ultimo
//      mensaje en "messages". Es lo que usa Casagencia: la regla "IA WhatsApp:
//      mensajes del cliente a n8n" (send_webhook_event), igual que Blue.
// Se aceptan las dos, para que no dependa de como este montado.
const raw = $input.first().json;
const b = raw.body ?? raw;

const esFormaConversacion = Array.isArray(b.messages);
const conv = esFormaConversacion ? b : (b.conversation ?? {});
const msg = esFormaConversacion ? (b.messages[b.messages.length - 1] ?? {}) : b;

const evento = String(b.event ?? '');
const contenido = String(msg.content ?? b.content ?? '').trim();

// El tipo llega como texto ('incoming') o como numero (0 = entrante).
const tipoBruto = msg.message_type ?? b.message_type;
const esEntrante = tipoBruto === 0 || tipoBruto === '0' || String(tipoBruto) === 'incoming';
const esPrivado = msg.private === true;

const quien = conv.meta?.sender ?? msg.sender ?? b.sender ?? {};
const tel = normalizarTelefono(quien.phone_number ?? quien.identifier ?? '');

// --- Lo que trae: texto, nota de voz, imagen u otra cosa ----------------------
// WhatsApp manda un solo adjunto por mensaje; el texto que lo acompana (el pie
// de una foto) llega en "content".
const adjunto = (msg.attachments ?? [])[0] ?? null;
const tipoAdjunto = String(adjunto?.file_type ?? '').toLowerCase();
let tipo = 'text';
let descripcionAdjunto = '';
if (adjunto) {
  if (tipoAdjunto === 'audio') tipo = 'audio';
  else if (tipoAdjunto === 'image') tipo = 'image';
  else {
    tipo = 'otro';
    const titulo = String(adjunto.fallback_title ?? '').trim();
    if (tipoAdjunto === 'video') descripcionAdjunto = '[el cliente ha enviado un vídeo]';
    else if (tipoAdjunto === 'location') {
      const lat = adjunto.coordinates_lat, lon = adjunto.coordinates_long;
      descripcionAdjunto = '[el cliente ha enviado una ubicación' + (titulo ? ': ' + titulo : '') +
        (lat != null && lon != null ? ` (${lat}, ${lon})` : '') + ']';
    } else if (tipoAdjunto === 'contact') {
      descripcionAdjunto = '[el cliente ha compartido un contacto' + (titulo ? ': ' + titulo : '') + ']';
    } else if (tipoAdjunto === 'file') {
      descripcionAdjunto = '[el cliente ha enviado un documento' +
        (adjunto.extension ? ' (' + String(adjunto.extension).replace(/^\./, '') + ')' : '') + ']';
    } else {
      descripcionAdjunto = '[el cliente ha enviado un archivo que no se puede leer]';
    }
  }
}

// --- Interruptores del bot (los usa la seccion "Filtrar si el bot...") -------
// Como en Blue: el atributo "bot" del CONTACTO. Off: la IA se calla. On o sin
// valor ("Select value"): contesta (SOLO_CONTACTOS_CON_BOT en config.js).
const atributosContacto = quien.custom_attributes ?? msg.sender?.custom_attributes ?? {};
const atributosConversacion = conv.custom_attributes ?? {};
const bot = String(atributosContacto.bot ?? atributosConversacion.bot ?? '').trim();
const botAsignado = !SOLO_CONTACTOS_CON_BOT || bot !== '';
const botEncendido = bot.toLowerCase() !== 'off';
const etiquetas = (conv.labels ?? b.labels ?? []).map(String);
const intervenida = etiquetas.includes(ETIQUETAS.intervenir) || etiquetas.includes('intervenir');

// Los moviles del equipo: los avisos les llegan desde esta misma linea, y si
// Carmen contesta "ok" al aviso, eso entra aqui. El bot no le contesta nunca.
const esDelEquipo = Object.values(EQUIPO).some(p => p.movil === tel.wa_id);

// Motivos por los que esto NO es un mensaje del cliente que atender
const motivos = [];
// La automatizacion de Chatwoot lo manda como 'automation_event.message_created'
if (evento && !/(^|\.)message_created$/.test(evento)) motivos.push('evento_no_mensaje');
if (!esEntrante || esPrivado) motivos.push('mensaje_saliente');   // lo escribio la agencia
if (!contenido && !adjunto) motivos.push('mensaje_vacio');
if (!tel.valido) motivos.push('telefono_invalido');
if (esDelEquipo) motivos.push('numero_del_equipo');
if (String(conv.status ?? b.status ?? '') === 'resolved') motivos.push('conversacion_resuelta');
const procesar = motivos.length === 0;
// Y los del bot, para que se vea en la ejecucion por que no ha contestado
if (!botAsignado) motivos.push('bot_sin_seleccionar');
if (!botEncendido) motivos.push('bot_apagado');

// Identificador del mensaje: con el se reconocen los avisos repetidos de Chatwoot
// y se distinguen dos mensajes iguales ("ok", "ok") en la cola de Redis.
const mensajeId = msg.id ?? msg.source_id ?? `${conv.id}-${msg.created_at}-${contenido.slice(0, 40)}`;
const creado = Number(msg.created_at) || Math.floor(Date.now() / 1000);

return [{
  json: {
    procesar,
    bot_asignado: botAsignado,
    bot_encendido: botEncendido,
    intervenida,
    contestar: motivos.length === 0,
    motivos,
    bot: bot || null,
    mensaje_id: mensajeId,
    creado,
    tipo,                                   // text | audio | image | otro
    tipo_adjunto: tipoAdjunto || null,
    adjunto_url: adjunto?.data_url ?? '',
    descripcion_adjunto: descripcionAdjunto,
    contenido,
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    nombre: String(quien.name ?? '').trim(),
    conversacion_id: conv.id ?? msg.conversation_id ?? null,
    contacto_id: quien.id ?? null,
    cuenta_id: b.account?.id ?? conv.account_id ?? CHATWOOT_CUENTA,
    etiquetas,
    // Redis: una cola por telefono, y una marca por mensaje para no tratarlo dos veces
    clave_buffer: 'wa:buffer:' + tel.wa_id,
    clave_visto: 'wa:visto:' + mensajeId,
  }
}];
