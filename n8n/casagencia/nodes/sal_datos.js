// SaludoInicial · ComponerSaludo
// Decide el saludo segun a que numero ha llamado el cliente y deja su telefono
// a mano para que Sara no tenga que pedirselo cifra a cifra.
//
// Antes esto era un Switch de 8 salidas con 8 nodos de texto. Tenia dos fallos:
// la salida de Carmen estaba cableada al texto de Gisela, y una llamada sin
// cabecera de desvio no casaba con ninguna rama, asi que no respondia nadie y
// el asistente arrancaba sin saludo.
const body = $input.first().json.body ?? $input.first().json;
const entrante = body?.call_inbound ?? {};
const cab = entrante.custom_sip_headers ?? {};

const CORTO = 'soy Sara, la IA de Casa Agencia';
const SALUDOS = {
  '654907386': 'soy Sara, la IA de Carmen, asesora comercial de Casagencia',
  '690027772': 'soy Sara, la IA de Gisela, asesora comercial de Casagencia',
  '618724192': 'soy Sara, la IA de Laurence, directora de Casagencia Inmobiliaria en Benicassim y Castellón',
  '864893794': CORTO,                                            // numero general
  '964742549': CORTO + ', está llamando a la oficina de Castellón',
  '864870199': CORTO,                                            // Idealista
  '964300986': CORTO + ', está llamando a la oficina de Benicassim',
  '936060117': CORTO,                                            // Fotocasa
};

// El Diversion trae la cadena de desvios: primero el numero de Twilio y DESPUES
// el numero original que desvio (el de la comercial o el de la oficina). Hay que
// quedarse con el ultimo; si no, todas las llamadas suenan a "general".
const diversion = String(cab.diversion ?? '');
const numeros = [...diversion.matchAll(/sip:\+?(\d+)@/g)].map(m => m[1]);
const e164 = numeros.length ? numeros[numeros.length - 1] : null;
const nacional = e164 ? e164.replace(/^34/, '') : null;

// Si no reconocemos el numero, saludo generico: nunca dejar al cliente sin saludo.
const saludo = (nacional && SALUDOS[nacional]) || CORTO;

const tel = normalizarTelefono(entrante.from_number ?? '');
// Dicho de tres y de dos en dos, como lo lee Sara en voz alta
const hablado = /^\d{9}$/.test(tel.nacional)
  ? tel.nacional.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4')
  : (tel.nacional || '');

return [{
  json: {
    saludo,
    numero_desviado: nacional,
    from_number: entrante.from_number ?? null,
    telefono_cliente: tel.e164 || '',
    telefono_cliente_hablado: hablado,
  }
}];
