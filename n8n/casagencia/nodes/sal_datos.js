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

// Como se presenta: "ia" en MINUSCULAS y "casa agencia" separado. Escrito "IA"
// la voz lo leia como una sigla, muy marcado; asi lo dice de corrido, como una
// palabra (Paco, 01/11/2026). Sin articulo delante: "Sara, ia de...", nunca "la ia".
const CORTO = 'soy Sara, ia de casa agencia';

// Numeros propios de Casagencia. Comprobado contra las llamadas reales:
// el movil de Carmen acaba atendiendo inmuebles BN/OR y el de Gisela CS/VR.
const LINEAS = {
  // moviles de las comerciales
  '654907386': { quien: 'Carmen',   saludo: 'soy Sara, ia de Carmen, asesora comercial de casa agencia' },
  '690027772': { quien: 'Gisela',   saludo: 'soy Sara, ia de Gisela, asesora comercial de casa agencia' },
  '618724192': { quien: 'Laurence', saludo: 'soy Sara, ia de Laurence, directora de casa agencia inmobiliaria en Benicassim y Castellón' },
  // oficinas
  '964300986': { quien: 'oficina Benicassim', saludo: 'soy Sara, ia de la oficina de Benicassim' },
  '964742549': { quien: 'oficina Castellon',  saludo: 'soy Sara, ia de la oficina de Castellón' },
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

// Cuanto espera Sara antes de saludar. Las lineas de portal traen un aviso grabado
// ("Llamada de idealista", unos 3 s) que no hay que pisar. Las demas no: si Sara
// espera, el cliente oye silencio, dice "¿Si? ¿Digame?" y eso le tapa el saludo.
// El 30/10 a las 10:36 se quedo asi 10 s callada y colgaron ("la IA no contesta").
// Un numero desviado que no conocemos podria ser un portal: espera larga, como antes.
const ESPERA_DIRECTA_MS = 800;
const ESPERA_PORTAL_MS = 3500;
const esperaLarga = !!linea.portal || (!!marcado && !LINEAS[marcado]);
const espera_saludo_ms = esperaLarga ? ESPERA_PORTAL_MS : ESPERA_DIRECTA_MS;

const tel = normalizarTelefono(entrante.from_number ?? '');
// Dicho de tres y luego de dos en dos, como lo lee Sara en voz alta
const hablado = /^\d{9}$/.test(tel.nacional)
  ? tel.nacional.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4')
  : (tel.nacional || '');

// La respuesta a Retell, en su formato (call_inbound). agent_override cambia la
// espera SOLO en esta llamada; si algo no vale, Retell puede rechazar la llamada,
// asi que va exactamente lo documentado y nada mas.
const respuesta = { call_inbound: {
  dynamic_variables: {
    saludovariable: linea.saludo,
    telefono_cliente: tel.e164 || '',
    telefono_cliente_hablado: hablado,
  },
  agent_override: { agent: { begin_message_delay_ms: espera_saludo_ms } },
} };

return [{
  json: {
    respuesta,
    espera_saludo_ms,
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
