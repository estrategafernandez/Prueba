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
// Todas usan parametros por posicion: {{1}} y {{2}}.
const PLANTILLAS = {
  compra:   { nombre: 'bienvenida_compra',   idioma: 'es' },  // {{1}} nombre, {{2}} enlace del inmueble
  alquiler: { nombre: 'bienvenida_alquiler', idioma: 'en' },  // {{1}} nombre, {{2}} enlace del inmueble
  aviso:    { nombre: 'plantilla_aviso',     idioma: 'en' },  // {{1}} comercial, {{2}} el aviso (una linea)
  abierta:  { nombre: 'plantilla_abierta',   idioma: 'en' },  // {{1}} nombre, {{2}} texto libre (una linea)
};

// Texto exacto de cada plantilla, tal y como esta aprobada en Meta. Solo se usa
// para que en el panel se lea lo mismo que le ha llegado al cliente.
const TEXTO_PLANTILLA = {
  bienvenida_compra:
    'Hola *{{1}}*, soy Sara de Casagencia.\nHemos recibido tu solicitud de información por este inmueble de compra: {{2}}\n*Quieres visitar la vivienda?*',
  bienvenida_alquiler:
    'Hola *{{1}}*, soy Sara de Casagencia.\nHemos recibido tu solicitud de información por este inmueble de alquiler: {{2}}\n*Quieres visitar la vivienda?*',
  plantilla_aviso:
    'Hola *{{1}}*,\n*{{2}}*\nUn saludo. Tenga un buen día.',
  plantilla_abierta:
    'Hola *{{1}}*,\n{{2}}\nUn saludo. Buen día.',
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
// La direccion: recibe TODOS los avisos por WhatsApp, ademas de la comercial.
const DIRECCION = { nombre: 'Paco', movil: '34662052387' };

// --- WhatsApp de la IA (para enlaces wa.me) -------------------------------------
// El numero de la linea de Sara, sin + ni espacios, para los botones de WhatsApp
// de la web y de los correos.
const WHATSAPP_IA = '34864893794';
const LOGO_CASAGENCIA = 'https://media.egorealestate.com/ORIGINAL/70400c69-431c-46bf-b25d-9ac843eb1b7e.png';
// Mensaje con el que llega quien pulsa la bolita de WhatsApp de casagencia.com
const MENSAJE_BOLITA_WEB = 'Hola, os acabo de ver por la web y estoy interesado en uno de vuestros inmuebles.';

// --- Recordatorio de la visita AL CLIENTE (24 h y 2 h antes) --------------------
// [WA] 6 (24 h) y [WA] 7 (2 h) miran las agendas de Carmen y Gisela cada 15
// minutos y le mandan al cliente una plantilla de Meta por su conversacion del
// panel. Todas las visitas que tengan el telefono del cliente en el titulo (las
// de WhatsApp y las del telefono). Cada visita se recuerda una sola vez.
//   plantilla:  nombre de la plantilla en Meta ('' = aun no existe: no se manda)
//   activo:     false = solo a los telefonos de prueba
//   parametros: que va en {{1}}, {{2}}... por orden. Disponibles: nombre,
//               hora_texto ("5 de la tarde"), hora ("17:00"),
//               cuando ("manana martes 7 de octubre a las 17:00" / "hoy a las 17:00"),
//               fecha_hora, inmueble, direccion, asesora, referencia
// Si la plantilla aun no esta aprobada en Meta, no se manda y se reintenta.
const RECORDATORIO_CLIENTE = {
  // "Hola {{1}}, Te recuerdo que manana a las {{2}} tenemos una visita agendada.
  //  Me confirmas tu presencia?" + boton "Si, confirmo"
  '24h': { horas: 24, plantilla: 'recordatorio_visita_24h', idioma: 'en', activo: true,
           parametros: ['nombre', 'hora_texto'] },
  // "Hola {{1}}, En 2 horas nos vemos en la visita. Te veo alli."
  '2h':  { horas: 2,  plantilla: 'recordatorio_visita_2h', idioma: 'en', activo: true,
           parametros: ['nombre'] },
};
// Tambien a las PRE-RESERVAS que la asesora aun no ha confirmado (el titulo
// sigue empezando por PRE-RESERVA). false = solo a las confirmadas.
const RECORDAR_PRERESERVAS = true;

// --- Correo a los leads que solo dejan su email ---------------------------------
// La plantilla esta en wa/correo_lead.js. Falta conectar el buzon que los va a
// mandar: hasta entonces activo = false y el correo solo se prepara y se guarda.
const CORREO_LEADS = { activo: false, remitente: '', nombre: 'Sara · Casagencia' };

// --- Leads entrantes ------------------------------------------------------------
// De la WEB salen del buzon formularioscasagencia@gmail.com (credencial "Correo
// Formulario"): solo los de web@websites.egorealestate.com. Los de los PORTALES
// ya entran en eGO y se cogen de su API ([WA] 5).
const BUZON_LEADS = 'formularioscasagencia@gmail.com';
// 'preparado': decide que mandaria y lo apunta (tabla leads_entrantes), pero NO
// manda nada. 'real': manda la plantilla. Se cambia aqui y se vuelve a desplegar.
// En produccion desde el 6-10-2026.
const MODO_LEADS = 'real';
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
  intervenir: '4-intervenir',      // tiene que entrar una persona (la IA sigue contestando: solo se calla con bot = Off)
};
const ESTADOS = [ETIQUETAS.bienvenida, ETIQUETAS.en_proceso, ETIQUETAS.agendada];
// Etiquetas que se SUMAN a las de estado (no cuentan como estado):
const ETIQUETA_VENDEDOR = 'vendedor';               // el comprador tiene que vender una vivienda
const ETIQUETA_LLAMADA  = '0-llamada_telefonica';   // la conversacion tiene llamadas del asistente telefonico

// --- El interruptor del bot (atributo "bot" del contacto, como en Blue) -------
// Off: la IA se calla (se cambia a mano en el panel). On o sin valor ("Select
// value"): la IA contesta. Con SOLO_CONTACTOS_CON_BOT = true solo contestaria a
// los contactos con el atributo puesto (el estandar de Blue); Casagencia quiere
// que conteste a todos menos a los que esten en Off.
const SOLO_CONTACTOS_CON_BOT = false;

// --- Asignacion de la conversacion en Chatwoot (como el reparto del telefono) -
// Id de cada comercial como agente del panel. La conversacion se asigna a la
// asesora de la referencia (BN/OR Carmen, CS/VR Gisela; si no hay, Laurence),
// salvo que ya la tenga una de ellas: un cambio hecho a mano se respeta.
const AGENTES_CHATWOOT = { Carmen: 5, Gisela: 4, Laurence: 6 };

// --- eGO (CRM) -----------------------------------------------------------------
// Comprobado con la API el 2-10-2026. Agencia 4338.
const EGO_ESTADOS = { 2: 'Disponible', 3: 'Vendido', 4: 'Reservado', 5: 'Alquilado', 7: 'Captación',
                      8: 'Retirado', 9: 'En evaluación' };
const EGO_DISPONIBLE = 2;
const EGO_PORTALES = { 701: 'Idealista', 31: 'Fotocasa', 680: 'Properstar' };
// Usuarios de eGO de cada comercial (securityUserID)
const EGO_COMERCIALES = { 88560: 'Carmen', 62597: 'Gisela', 10768: 'Laurence' };
// Llaves: en eGO solo constan las de algunos inmuebles. Con false, que no consten no
// impide ofrecer visita: se le dice a la asesora en el aviso para que lo coordine.
const LLAVES_OBLIGATORIAS = false;

// --- Avisos al equipo (solo WhatsApp) ----------------------------------------------
// Largo maximo del resumen dentro del aviso y del aviso entero. Meta corta la
// plantilla si pasa de ~1000 caracteres: asi cabe siempre y se lee de un vistazo.
const AVISO_RESUMEN_MAX = 220;
const AVISO_MAX = 600;

// --- Tiempos -----------------------------------------------------------------
const BUFFER_SEGUNDOS = 60;         // se juntan los mensajes que el cliente manda seguidos
const RECORDATORIO_HORAS = 24;      // aviso al comercial antes de cada visita
// Antelacion minima para agendar desde WhatsApp. 0 = la que permita el horario.
const ANTELACION_MINIMA_HORAS = 0;
// Llamadas del asistente telefonico: todas van al panel, pero el aviso por
// WhatsApp a la comercial solo si la llamada ha durado al menos esto.
const LLAMADA_AVISO_MIN_SEGUNDOS = 15;

// Marca que llevan en la descripcion las visitas agendadas por WhatsApp. Con
// ella el recordatorio sabe cuales son suyas y no avisa de las del telefono.
const MARCA_ORIGEN = 'Origen: WhatsApp (Sara IA)';

// --- Pruebas -----------------------------------------------------------------
// Con estos telefonos el asistente funciona IGUAL que con un cliente, pero:
//   - los avisos van al que prueba (no a Carmen, Gisela ni Paco), con [PRUEBA];
//   - con PRUEBAS_AGENDA_REAL = false las visitas NO se escriben en la agenda
//     real (se consulta de verdad, pero la reserva se simula). Con true se
//     escriben como cualquier otra, con [PRUEBA] delante del titulo.
// Se rellena AL DESPLEGAR desde wa/pruebas.local.json (no esta en git), para no
// guardar telefonos personales en el repositorio.
// Desde la salida (6-10-2026) el calendario esta activo para todos, pruebas incluidas.
const PRUEBAS_AGENDA_REAL = true;
const PRUEBAS = /*PRUEBAS*/{ telefonos: [], avisar_movil: '', avisar_email: '' }/*FIN_PRUEBAS*/;

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

// De varias referencias posibles (la de la cartera, la que manda el agente, la
// del lead de ese telefono), la primera que tiene comercial (BN/OR -> Carmen,
// CS/VR -> Gisela). Asi un numero de enlace ("26699629-A") nunca deja el aviso
// sin comercial si hay otra referencia buena.
function referenciaBuena(...candidatas) {
  const limpias = candidatas.map(x => String(x ?? '').toUpperCase().trim()).filter(Boolean);
  return limpias.find(x => ASESORA_POR_PREFIJO[prefijoDeReferencia(x)]) || limpias[0] || '';
}

// Como se le nombra al cliente a quien se encarga: la asesora de la zona por su
// nombre (Carmen o Gisela). Laurence es de la oficina, no "asesora de la zona".
function quienSeEncarga(nombre, zona) {
  const n = String(nombre ?? '').trim();
  const z0 = String(zona ?? '').split(' / ')[0].trim();
  const z = /^benicasim$/i.test(z0) ? 'Benicàssim' : z0;
  if (['Carmen', 'Gisela'].includes(n)) return `${n}, la asesora de la zona${z ? ' de ' + z : ''}`;
  return n ? `${n}, de nuestro equipo` : 'nuestro equipo';
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
  // La referencia manda: en Casagencia las que acaban en -A son de alquiler y las
  // de -V de venta. eGO a veces marca "Venta" una solicitud de Idealista de un
  // piso de alquiler (BN-C-126-A, 6-10-2026).
  const ref = String(referencia ?? '').trim();
  if (/-A$/i.test(ref)) return true;
  if (/-V$/i.test(ref)) return false;
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

// Recorta un texto a `max` caracteres sin partir palabras (y con … si sobra).
function recortar(texto, max) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return (espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,.;:·-]+$/, '') + '…';
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

// "17:00" -> "5 de la tarde", "10:30" -> "10 y media de la mañana", "12:15" ->
// "12 y cuarto del mediodía". Para las plantillas que dicen "a las {{2}}".
function horaTexto(hora) {
  const m = String(hora ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(hora ?? '');
  const h = Number(m[1]), min = Number(m[2]);
  if (h === 13 || h === 1) return `${m[1].padStart(2, '0')}:${m[2]}`;   // "a las una" no encaja
  const h12 = h % 12 || 12;
  const franja = h < 6 ? 'de la madrugada' : h < 12 ? 'de la mañana' : h === 12 ? 'del mediodía'
    : h < 21 ? 'de la tarde' : 'de la noche';
  const minutos = min === 0 ? '' : min === 30 ? ' y media' : min === 15 ? ' y cuarto' : `:${m[2]}`;
  return `${h12}${minutos} ${franja}`;
}

// "Si, tengo que vender el mio" -> true. "No", "no necesito" -> false.
function esAfirmativo(texto) {
  const t = sinAcentos(texto).trim();
  if (!t || /^(no\b|nop|para nada|ninguna|nada)/.test(t) || /\bno (necesito|tengo|hace falta)\b/.test(t)) return false;
  return /^(si\b|sí\b|claro|por supuesto|correcto|exacto)/.test(t) ||
    /\b(tengo|necesito|debo|tendria|tendre|hay) que vender\b|\bnecesito vender\b|\bvender (primero|antes|mi|el|la)\b/.test(t);
}

// Id del agente de Chatwoot de un comercial ('Carmen' -> 5). 0 si no tiene.
function agenteDe(nombre) {
  return Number(AGENTES_CHATWOOT[String(nombre ?? '').trim()] || 0);
}

function esPrueba(telefono) {
  const t = normalizarTelefono(telefono).wa_id;
  return !!t && (PRUEBAS.telefonos || []).includes(t);
}

// Lo nuevo de leads y eGO (primer WhatsApp a los leads, notas en eGO) solo
// actua de verdad con MODO_LEADS = 'real'; con los telefonos de prueba, siempre.
function leadsEnReal(telefono) {
  return MODO_LEADS === 'real' || esPrueba(telefono);
}
