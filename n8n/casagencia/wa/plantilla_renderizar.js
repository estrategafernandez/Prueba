// [WA][SUB] Enviar plantilla · RenderizarTexto
// Construye el texto que se ve en el panel y el cuerpo del mensaje de Chatwoot.
// El texto se coge de la plantilla REAL de Meta; si la API de Meta falla se usa
// el respaldo de aqui abajo para no dejar al lead sin contestar.
const norm = $('Normalizar').first().json;

// Respaldo: el texto aprobado, copiado en config.js (TEXTO_PLANTILLA).

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
if (!cuerpo) cuerpo = TEXTO_PLANTILLA[norm.plantilla] || '';

// Los parametros van por posicion, como los numera Meta: {{1}}, {{2}}, {{3}}...
// Solo se mandan los que la plantilla tiene de verdad: si se manda uno de mas,
// Meta rechaza el envio por numero de parametros. El {{3}} (si el alquiler es
// temporal o de larga duracion) solo esta en la bienvenida de alquiler.
const params = { 1: norm.param1 };
if (norm.param2 !== '') params['2'] = norm.param2;
if (norm.param3 && cuerpo.includes('{{3}}')) params['3'] = norm.param3;

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
