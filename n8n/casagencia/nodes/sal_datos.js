// SaludoInicial · ComponerSaludo
// Decide el saludo segun a que numero MARCO el cliente, y deja su telefono a
// mano para que Sara no tenga que pedirselo cifra a cifra.
//
// Antes esto era un Switch de 8 salidas con 8 nodos de texto, y tenia tres
// fallos: la salida de Carmen estaba cableada al texto de Gisela; una llamada
// sin cabecera de desvio no casaba con ninguna rama y nadie respondia; y se
// leia el PRIMER numero de la cadena de desvios, que siempre es el de Twilio,
// asi que todas las llamadas sonaban a "general".
const body = $input.first().json.body ?? $input.first().json;
const entrante = body?.call_inbound ?? {};
const cab = entrante.custom_sip_headers ?? {};

const CORTO = 'soy Sara, la IA de Casa Agencia';

// Numeros propios de Casagencia. Comprobado contra las llamadas reales:
// el movil de Carmen acaba atendiendo inmuebles BN/OR y el de Gisela CS/VR.
const LINEAS = {
  // moviles de las comerciales
  '654907386': { quien: 'Carmen',   saludo: 'soy Sara, la IA de Carmen, asesora comercial de Casagencia' },
  '690027772': { quien: 'Gisela',   saludo: 'soy Sara, la IA de Gisela, asesora comercial de Casagencia' },
  '618724192': { quien: 'Laurence', saludo: 'soy Sara, la IA de Laurence, directora de Casagencia Inmobiliaria en Benicassim y Castellón' },
  // oficinas
  '964300986': { quien: 'oficina Benicassim', saludo: CORTO + ', está llamando a la oficina de Benicassim' },
  '964742549': { quien: 'oficina Castellon',  saludo: CORTO + ', está llamando a la oficina de Castellón' },
  // numero general
  '864893794': { quien: 'general', saludo: CORTO },
  // lineas de portales: el cliente llama por un anuncio, no conoce a la
  // comercial, asi que saludo generico. Traen un aviso grabado del portal
  // antes de que hable la persona.
  '864870199': { quien: 'Idealista', saludo: CORTO, portal: true },
  '936060117': { quien: 'Fotocasa',  saludo: CORTO, portal: true },
  '864870288': { quien: 'portal sin identificar', saludo: CORTO, portal: true },
};

// La cabecera Diversion lista los desvios del MAS RECIENTE al ORIGINAL:
//   "general <- Carmen <- Idealista" = el cliente marco el numero de Idealista,
//   que desvio al movil de Carmen, que desvio a Twilio.
// El ultimo es, por tanto, el numero que marco el cliente: ese manda el saludo.
const numeros = [...String(cab.diversion ?? '').matchAll(/sip:\+?(\d+)@/g)]
  .map(m => m[1].replace(/^34/, ''));
const marcado = numeros.length ? numeros[numeros.length - 1] : null;
// En una llamada de portal, el numero del medio es la linea de la comercial
// por la que ha entrado. Se guarda por si hace falta para enrutar o depurar.
const linea_comercial = numeros.length > 2 ? numeros[numeros.length - 2] : null;

// Si el numero no es de los nuestros, saludo generico: nunca dejar al cliente
// sin saludo, que es lo que pasaba antes.
const linea = (marcado && LINEAS[marcado]) || { quien: 'desconocido', saludo: CORTO };

const tel = normalizarTelefono(entrante.from_number ?? '');
// Dicho de tres y luego de dos en dos, como lo lee Sara en voz alta
const hablado = /^\d{9}$/.test(tel.nacional)
  ? tel.nacional.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4')
  : (tel.nacional || '');

return [{
  json: {
    saludo: linea.saludo,
    numero_marcado: marcado,
    linea: linea.quien,
    es_portal: !!linea.portal,
    linea_comercial: linea_comercial && LINEAS[linea_comercial] ? LINEAS[linea_comercial].quien : linea_comercial,
    from_number: entrante.from_number ?? null,
    telefono_cliente: tel.e164 || '',
    telefono_cliente_hablado: hablado,
  }
}];
