// [WA] 1 · Leads de la web · Decidir
// Junta el formulario, lo que ha entendido OpenAI del mensaje y, si hablaba de
// un inmueble concreto, si sigue en la cartera. Decide el primer WhatsApp.
const f = $('LeerFormulario').first().json;
let c = {};
try {
  const r = $('Clasificar').first().json;
  c = JSON.parse(r.choices?.[0]?.message?.content || '{}');
} catch (e) { c = {}; }
let inmueble = {};
try { inmueble = $('LeerInmueble').first().json || {}; } catch (e) { inmueble = {}; }
// La respuesta a lo que pregunto en el portal (solo existe si venia con pregunta)
let respuesta_pregunta = '';
try { respuesta_pregunta = String($('RespuestaALaPregunta').first().json.respuesta_pregunta || ''); }
catch (e) { respuesta_pregunta = ''; }

const referencia = String(f.referencia || c.referencia || '').toUpperCase();
// Sin mensaje pero con telefono puede ser un cliente de verdad: saludo general.
// Si viene de un portal, el tipo lo dice el propio portal (compra o alquiler) y
// no la clasificacion: el correo lleva mucha morralla del portal y pedirle a
// OpenAI que adivine ahi es jugarsela a que salga "otro" o "captacion".
const tipo = f.tipo_forzado
  || (!String(f.mensaje || '').trim() && f.se_puede_contactar ? 'sin_mensaje' : (c.tipo || 'otro'));
const enCartera = !!inmueble.ref;
const argumentos = {
  tipo,
  referencia,
  // Si dio una referencia y ya no esta en la cartera, ya no esta disponible
  disponible: referencia ? enCartera : null,
  enlace: inmueble.enlace || '',
  operacion: inmueble.tipo_transaccion || '',
  nombre: f.nombre,
  idioma: f.idioma !== 'es' ? f.idioma : (c.idioma || 'es'),
  resumen_cliente: String(c.resumen_cliente || '').slice(0, 160),
  municipio: String(c.municipio || inmueble.municipio || ''),
  respuesta_pregunta,
};
let d = decidirPrimerMensaje(argumentos);
// A TODO el que entra por el formulario de la web y deja un telefono se le
// escribe. Si de la clasificacion no sale ninguna plantilla (OpenAI no contesto,
// o metio el mensaje en "otro") antes se quedaba en "revisar" y no le escribia
// nadie: ahora le sale el saludo general y, si no era un cliente, se ve en su
// respuesta. Los de los portales ([WA] 5) no pasan por aqui.
const saludo_por_defecto = !d.plantilla && f.se_puede_contactar;
if (saludo_por_defecto) d = decidirPrimerMensaje({ ...argumentos, tipo: 'sin_mensaje' });

return [{ json: {
  ...f,
  ...d,
  referencia,
  tipo,
  saludo_por_defecto,
  municipio: c.municipio || '',
  resumen: String(c.resumen || f.mensaje || '').replace(/\s+/g, ' ').slice(0, 400),
  enlace: inmueble.enlace || '',
  resumen_cliente: String(c.resumen_cliente || '').slice(0, 160),
  // Se manda de verdad solo con MODO_LEADS = 'real' (o a un telefono de prueba)
  enviar: !!f.se_puede_contactar && !!d.plantilla && leadsEnReal(f.telefono_e164),
  // Con correo, ademas (o en vez de WhatsApp si no dejo telefono), el correo.
  // Lo que no se entiende (revisar) no: lo mira una persona.
  por_correo: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email_cliente || '')) && d.accion !== 'revisar',
  respuesta_pregunta,
  // Lo que ha escrito y lo que ya ha contestado en el portal: Sara lo tiene
  // delante en cada turno, asi que no se lo vuelve a preguntar.
  notas: (f.fuente === 'portal'
    ? [`Mensaje por ${f.portal}: ${f.mensaje_cliente || f.mensaje}`,
       ...(f.respuestas_portal || []).map(x => `- ${x}`),
       respuesta_pregunta ? `[Ya se le ha contestado: ${respuesta_pregunta}]` : ''].filter(Boolean).join('\n')
    : `Formulario de la web (${f.origen_url || 'casagencia.com'}): ${f.mensaje}`).slice(0, 1500)
    + (saludo_por_defecto ? `\n[No se ha podido clasificar el mensaje (tipo: ${tipo}): se le ha mandado el saludo general.]` : ''),
} }];
