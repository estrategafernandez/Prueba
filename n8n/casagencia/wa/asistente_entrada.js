// [WA] 2 · Asistente · EntradaMensaje
// Chatwoot avisa por webhook de cada mensaje. Aqui se decide si el bot debe
// contestar y se deja el mensaje listo para el buffer de Redis.
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

const quien = conv.meta?.sender ?? msg.sender ?? b.sender ?? {};
const tel = normalizarTelefono(quien.phone_number ?? quien.identifier ?? '');

// Interruptores de mano: la etiqueta 4-intervenir y el atributo bot=Off.
const etiquetas = (conv.labels ?? b.labels ?? []).map(String);
const atributos = conv.custom_attributes ?? b.custom_attributes ?? {};
const botApagado = String(atributos.bot ?? 'On').toLowerCase() === 'off';
const intervenida = etiquetas.includes(ETIQUETAS.intervenir) || etiquetas.includes('intervenir');

// Los moviles del equipo: los avisos les llegan desde esta misma linea, y si
// Carmen contesta "ok" al aviso, eso entra aqui. El bot no le contesta nunca.
const esDelEquipo = Object.values(EQUIPO).some(p => p.movil === tel.wa_id);

// Motivos por los que el bot NO debe contestar
const motivos = [];
// La automatizacion de Chatwoot lo manda como 'automation_event.message_created'
if (evento && !/(^|\.)message_created$/.test(evento)) motivos.push('evento_no_mensaje');
if (!esEntrante) motivos.push('mensaje_saliente');            // lo escribio la agencia
if (!contenido) motivos.push('sin_texto');                    // audio o imagen: lo ve una persona
if (!tel.valido) motivos.push('telefono_invalido');
if (intervenida) motivos.push('conversacion_intervenida');
if (esDelEquipo) motivos.push('numero_del_equipo');
if (botApagado) motivos.push('bot_apagado');
if (String(conv.status ?? b.status ?? '') === 'resolved') motivos.push('conversacion_resuelta');

return [{
  json: {
    contestar: motivos.length === 0,
    motivos,
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    nombre: String(quien.name ?? '').trim(),
    contenido,
    conversacion_id: conv.id ?? msg.conversation_id ?? null,
    contacto_id: quien.id ?? null,
    cuenta_id: b.account?.id ?? conv.account_id ?? CHATWOOT_CUENTA,
    etiquetas,
    // clave del buffer de Redis: una cola por telefono
    clave_buffer: 'wa:buffer:' + tel.wa_id,
  }
}];
