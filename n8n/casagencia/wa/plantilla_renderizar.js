// [WA][SUB] Enviar plantilla · RenderizarTexto
// Construye el texto que se ve en el panel y el cuerpo del mensaje de Chatwoot.
// El texto se coge de la plantilla REAL de Meta; si la API de Meta falla se usa
// el respaldo de aqui abajo para no dejar al lead sin contestar.
const norm = $('Normalizar').first().json;

// Respaldo: el mismo texto que se apruebe en Meta. Al cambiar la plantilla,
// cambiar tambien este texto para que el panel muestre lo que se ha enviado.
const RESPALDO = {};
const RESPALDO_GENERICO =
  'Hola {{1}}, soy Sara, la asistente virtual de Casagencia. ' +
  'Nos has dejado una solicitud de informacion sobre el inmueble {{2}}. ' +
  '¿Te va bien que te haga un par de preguntas por aqui para ayudarte mejor?';

let cuerpo = null;
try {
  const respuesta = $input.first().json || {};
  const plantillas = respuesta.data || [];
  const plantilla = plantillas.find(t => t.name === norm.plantilla && t.language === norm.idioma)
                 || plantillas[0];
  cuerpo = plantilla.components.find(c => c.type === 'BODY').text;
} catch (e) {
  cuerpo = null;
}
if (!cuerpo) cuerpo = RESPALDO[norm.plantilla] || RESPALDO_GENERICO;

// Los parametros van por posicion, como los numera Meta: {{1}}, {{2}}...
const params = { 1: norm.param1 };
if (norm.param2 !== '') params['2'] = norm.param2;

let contenido = cuerpo;
for (const [clave, valor] of Object.entries(params)) {
  contenido = contenido.split('{{' + clave + '}}').join(valor);
}

const conversacionId = $('ConversacionLista').first().json.conversacion_id;

return [{
  json: {
    conversacion_id: conversacionId,
    contenido,
    body_mensaje: JSON.stringify({
      content: contenido,
      message_type: 'outgoing',
      template_params: {
        name: norm.plantilla,
        category: 'MARKETING',
        language: norm.idioma,
        processed_params: params,
      },
    }),
  }
}];
