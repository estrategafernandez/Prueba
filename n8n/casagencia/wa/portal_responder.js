// [WA][SUB] LeadDeLaWeb · RespuestaALaPregunta
// Lo que ha preguntado el cliente en el portal, contestado con la ficha del
// inmueble delante. Es lo que va en el PRIMER mensaje: si no, le llega una
// bienvenida generica que no tiene nada que ver con lo que ha preguntado.
//
// Solo se usa si hay pregunta Y ficha. Si OpenAI falla o contesta cualquier
// cosa, se devuelve vacio y el lead sigue su camino con la bienvenida de
// siempre: una pregunta sin contestar es mejor que un lead sin contactar.
const f = $('LeerFormulario').first().json;
let ficha = {};
try { ficha = $('LeerInmueble').first().json || {}; } catch (e) { ficha = {}; }

let texto = '';
try {
  const r = $input.first().json || {};
  texto = String(r.choices?.[0]?.message?.content ?? '').trim();
} catch (e) { texto = ''; }

// Lo que no sirve: vacio, demasiado largo para una plantilla, o la excusa de
// que no lo sabe (para eso ya esta la bienvenida normal).
const NO_SABE = /^(no (lo )?(se|puedo|dispongo)|lo siento|no tengo|no consta|no aparece|sin datos)/i;
if (texto.length > 700 || NO_SABE.test(sinAcentos(texto))) texto = '';

return [{
  json: {
    // El texto para {{2}} de la plantilla abierta, en una linea
    respuesta_pregunta: paramPlantilla(texto, 700).replace(/^-$/, ''),
    tenia_pregunta: !!(String(f.pregunta || '').trim() || String(f.mensaje_cliente || '').trim()),
    con_ficha: !!ficha.ref,
  }
}];
