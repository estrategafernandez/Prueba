// ===========================================================================
// CASAGENCIA · ASISTENTE DE WHATSAPP — CONFIGURACION COMUN
// ---------------------------------------------------------------------------
// Proyecto independiente del asistente telefonico: sus workflows llevan [WA] y
// no llaman nunca a los [TEL]. Comparten los MISMOS datos (el Google Sheet de
// la cartera y los calendarios de Carmen y Gisela), no el codigo en ejecucion.
//
// Se inyecta al principio de los nodos Code propios de WhatsApp.
// Editar aqui y volver a desplegar:  python3 build_whatsapp.py --deploy
// ===========================================================================
const ZONA = 'Europe/Madrid';

// --- Chatwoot (panel de conversaciones) -------------------------------------
const CHATWOOT_URL    = 'https://panel-casa-agencia.serversvisionarius.com';
const CHATWOOT_CUENTA = 1;   // "Casa Agencia Inmobiliaria"
const CHATWOOT_INBOX  = 1;   // inbox "WhatsApp" (whatsapp_cloud, +34 864 89 37 94)

// --- Meta · WhatsApp Cloud API ---------------------------------------------
// Linea +34 864 89 37 94 (Casa Agencia Inmobiliaria), verificada y conectada.
// El token NO va aqui: esta en la credencial "Meta WhatsApp Casagencia".
const META_API        = 'https://graph.facebook.com/v22.0';
const META_PHONE_ID   = '1254647111075735';
const META_WABA_ID    = '1791979752043585';

// Plantillas aprobadas. OJO con el idioma: bienvenida_alquiler y plantilla_aviso
// estan dadas de alta en INGLES ('en') aunque el texto sea en espanol. Meta
// rechaza el envio si el codigo de idioma no es exactamente el registrado.
// Las tres usan parametros por posicion: {{1}} y {{2}}.
const PLANTILLAS = {
  compra:   { nombre: 'bienvenida_compra',   idioma: 'es' },  // {{1}} nombre, {{2}} enlace del inmueble
  alquiler: { nombre: 'bienvenida_alquiler', idioma: 'en' },  // {{1}} nombre, {{2}} enlace del inmueble
  aviso:    { nombre: 'plantilla_aviso',     idioma: 'en' },  // {{1}} comercial, {{2}} el aviso (una linea)
};

// Texto exacto de cada plantilla, tal y como esta aprobada en Meta. Solo se usa
// para que en el panel se lea lo mismo que le ha llegado al cliente.
const TEXTO_PLANTILLA = {
  bienvenida_compra:
    'Hola *{{1}}*, soy Sara de Casa Agencia.\nHemos recibido tu solicitud de información por este inmueble de compra: {{2}}\n*Quieres visitar la vivienda?*',
  bienvenida_alquiler:
    'Hola *{{1}}*, soy Sara de Casa Agencia.\nHemos recibido tu solicitud de información por este inmueble de alquiler: {{2}}\n*Quieres visitar la vivienda?*',
  plantilla_aviso:
    'Hola *{{1}}*,\n*{{2}}*\nUn saludo. Tenga un buen día.',
};

// --- El equipo ---------------------------------------------------------------
// Mismo reparto que el telefono: la referencia manda.
const ASESORA_POR_PREFIJO = { BN: 'Carmen', OR: 'Carmen', CS: 'Gisela', VR: 'Gisela' };
const ASESORA_POR_MUNICIPIO = {
  'benicasim': 'Carmen', 'benicassim': 'Carmen', 'oropesa': 'Carmen', 'orpesa': 'Carmen',
  'torreblanca': 'Carmen', 'onda': 'Carmen', 'borriol': 'Carmen', 'vilafames': 'Carmen',
  'castellon': 'Gisela', 'castello': 'Gisela', 'vila-real': 'Gisela', 'villarreal': 'Gisela',
  'burriana': 'Gisela', 'borriana': 'Gisela', 'almazora': 'Gisela', 'almassora': 'Gisela',
  'alquerias': 'Gisela', 'alqueries': 'Gisela',
};
// Moviles a los que llega el aviso por WhatsApp (los mismos que usa el telefono
// para saber por que linea entra la llamada).
const EQUIPO = {
  Carmen:   { movil: '34654907386', email: 'carmen@casagencia.com' },
  Gisela:   { movil: '34690027772', email: 'gisela@casagencia.com' },
  Laurence: { movil: '34618724192', email: 'laurence@casagencia.com' },
};
const EMAIL_DIRECCION = 'paco@casagencia.com';   // copia por correo de todos los avisos

// --- Leads por correo ----------------------------------------------------------
const BUZON_LEADS = 'PENDIENTE@casagencia.com';   // PENDIENTE: el buzon donde entran
const PORTALES = [
  { nombre: 'Idealista',  de: /idealista\.com/i,   asunto: /idealista/i },
  { nombre: 'Fotocasa',   de: /fotocasa\.es/i,     asunto: /fotocasa/i },
  { nombre: 'Habitaclia', de: /habitaclia\.com/i,  asunto: /habitaclia/i },
  { nombre: 'Web',        de: /casagencia\.com/i,  asunto: /formulario|contacto/i },
];

// --- Etiquetas de Chatwoot ---------------------------------------------------
// Las mismas que Blue, creadas ya en el panel. Las tres primeras son el estado
// de la conversacion (solo una a la vez y nunca hacia atras); la cuarta se suma
// a la que haya y hace que el bot deje de contestar.
const ETIQUETAS = {
  bienvenida: '1-bienvenida_ia',   // la IA ha mandado la plantilla
  en_proceso: '2-en_proceso',      // el cliente ha contestado y la IA esta con el
  agendada:   '3-agendada_ia',     // visita agendada de verdad en el calendario
  intervenir: '4-intervenir',      // tiene que entrar una persona: la IA se calla
};
const ESTADOS = [ETIQUETAS.bienvenida, ETIQUETAS.en_proceso, ETIQUETAS.agendada];

// --- Tiempos -----------------------------------------------------------------
const BUFFER_SEGUNDOS = 60;         // se juntan los mensajes que el cliente manda seguidos
const RECORDATORIO_HORAS = 24;      // aviso al comercial antes de cada visita
// Antelacion minima para agendar desde WhatsApp. 0 = la que permita el horario.
const ANTELACION_MINIMA_HORAS = 0;

// Marca que llevan en la descripcion las visitas agendadas por WhatsApp. Con
// ella el recordatorio sabe cuales son suyas y no avisa de las del telefono.
const MARCA_ORIGEN = 'Origen: WhatsApp (Sara IA)';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function normalizarTelefono(raw) {
  let s = String(raw ?? '').trim();
  const teniaMas = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!teniaMas && s.startsWith('00')) s = s.slice(2);
  if (/^[6789]\d{8}$/.test(s)) s = '34' + s;
  return {
    e164: s ? '+' + s : '',
    wa_id: s,                                   // como lo quiere Meta: solo digitos
    nacional: s.startsWith('34') ? s.slice(2) : s,
    valido: s.length >= 8 && s.length <= 15,
  };
}

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function prefijoDeReferencia(ref) {
  const m = String(ref ?? '').toUpperCase().match(/[A-Z]{2}/);
  return m ? m[0] : '';
}

// Asesora por referencia y, si no hay, por municipio. Si no hay ninguna, Laurence.
function resolverAsesora(ref, municipio) {
  const prefijo = prefijoDeReferencia(ref);
  let asesora = ASESORA_POR_PREFIJO[prefijo] || null;
  if (!asesora && municipio) {
    const m = sinAcentos(municipio);
    for (const [clave, quien] of Object.entries(ASESORA_POR_MUNICIPIO)) {
      if (m.includes(clave)) { asesora = quien; break; }
    }
  }
  const final = asesora || 'Laurence';
  return { prefijo, asesora, conocida: !!asesora, destinatario: final, ...EQUIPO[final] };
}

// Alquiler o compra. Mismo criterio que el telefono: lo dice la operacion o la
// referencia acaba en -A.
function esAlquiler(referencia, operacion) {
  const o = String(operacion ?? '').toLowerCase();
  if (o.includes('alquiler') || o.includes('traspaso') || o.includes('rent')) return true;
  if (o.includes('venta') || o.includes('compra')) return false;
  return /-A$/i.test(String(referencia ?? '').trim());
}

function detectarPortal(remitente, asunto) {
  for (const p of PORTALES) {
    if (p.de.test(String(remitente ?? '')) || p.asunto.test(String(asunto ?? ''))) return p.nombre;
  }
  return 'Otro';
}

// Meta no admite saltos de linea, tabuladores ni mas de 4 espacios seguidos
// dentro de un parametro de plantilla: si los hay, rechaza el envio entero.
function paramPlantilla(texto, max = 700) {
  return String(texto ?? '')
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max) || '-';
}

// "2026-10-02" + "17:00" -> "jueves 2 de octubre a las 17:00"
function fechaLegible(fecha, hora) {
  const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const d = DateTime.fromFormat(String(fecha), 'yyyy-MM-dd', { zone: ZONA });
  if (!d.isValid) return `${fecha} ${hora || ''}`.trim();
  return `${DIAS[d.weekday - 1]} ${d.day} de ${MESES[d.month - 1]}` + (hora ? ` a las ${hora}` : '');
}
