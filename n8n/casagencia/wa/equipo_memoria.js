// [WA] 11 · Mensajes del equipo a la memoria de Sara · Preparar
// La automatizacion de Chatwoot "IA WhatsApp: mensajes del equipo a n8n" manda
// cada mensaje SALIENTE del inbox de WhatsApp. Si lo ha escrito una persona del
// equipo desde el panel (no Sara, que escribe con el usuario CHATWOOT_USUARIO_IA,
// y no una nota interna), se guarda en la memoria de Sara: asi, cuando vuelve a
// contestar (o si el bot estaba apagado), sabe lo que se ha hablado con el cliente.
const b = $input.first().json.body ?? $input.first().json;
const msg = (b.messages ?? [])[0] ?? {};
const remitente = msg.sender ?? {};
const tipoRemitente = String(msg.sender_type ?? remitente.type ?? '').toLowerCase();
const saliente = msg.message_type === 1 || msg.message_type === 'outgoing';
const deUnaPersona = tipoRemitente === 'user' && Number(msg.sender_id ?? remitente.id) !== CHATWOOT_USUARIO_IA;
const contenido = String(msg.content ?? '').trim();
const adjunto = (msg.attachments ?? [])[0] ?? null;
const tipoAdjunto = String(adjunto?.file_type ?? '').toLowerCase();
const queAdjunto = !adjunto ? '' : tipoAdjunto === 'image' ? 'una imagen' : tipoAdjunto === 'audio' ? 'una nota de voz'
  : tipoAdjunto === 'video' ? 'un vídeo' : 'un archivo';
const quien = String(remitente.available_name || remitente.name || '').trim() || 'Alguien del equipo';
const tel = normalizarTelefono(b.meta?.sender?.phone_number ?? '');

const motivos = [];
if (!saliente) motivos.push('no_es_saliente');
if (msg.private === true) motivos.push('nota_interna');
if (!deUnaPersona) motivos.push('no_lo_escribe_una_persona');
if (!contenido && !adjunto) motivos.push('vacio');
if (!tel.e164) motivos.push('sin_telefono');
if (Number(b.inbox_id ?? msg.inbox_id) !== Number(CHATWOOT_INBOX)) motivos.push('otro_inbox');

const texto = `[${quien}, del equipo de Casagencia, le ha escrito al cliente desde el panel]: ` +
  [contenido, queAdjunto ? `(ha enviado ${queAdjunto})` : ''].filter(Boolean).join(' ');
return [{ json: {
  guardar: motivos.length === 0,
  motivos,
  mensaje_id: String(msg.id ?? ''),
  conversacion_id: b.id ?? msg.conversation_id ?? null,
  quien,
  telefono_e164: tel.e164,
  memoria: JSON.stringify({ type: 'ai', content: texto, tool_calls: [], additional_kwargs: {},
                            response_metadata: {}, invalid_tool_calls: [] }),
} }];
