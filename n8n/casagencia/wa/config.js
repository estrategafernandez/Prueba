// ===========================================================================
// CASAGENCIA · WHATSAPP — CONFIGURACION COMUN
// ---------------------------------------------------------------------------
// Se inyecta al principio de los nodos Code de los workflows [WA].
// Editar aqui y volver a desplegar:  python3 build_whatsapp.py --deploy
// ===========================================================================

// --- PENDIENTE DE DESPLIEGUE ------------------------------------------------
// Rellenar cuando esten montados Chatwoot y el numero de WhatsApp. Hasta
// entonces los workflows quedan DESACTIVADOS: no se dispara nada.
const CHATWOOT_URL    = 'https://PENDIENTE-chatwoot-casagencia';  // sin barra final
const CHATWOOT_CUENTA = 1;                                        // id de la cuenta
const CHATWOOT_INBOX  = 0;                                        // id del inbox de WhatsApp
const META_WABA_ID    = 'PENDIENTE-id-de-la-cuenta-de-whatsapp';   // waba_id de Meta
const PLANTILLA_LEAD  = 'PENDIENTE-nombre-de-la-plantilla';        // plantilla aprobada en Meta
const PLANTILLA_IDIOMA = 'es';
const BUZON_LEADS     = 'PENDIENTE@casagencia.com';                // buzon donde entran los avisos

// El token de Chatwoot y el de Meta NO viven aqui: van en las credenciales
// "Chatwoot Casagencia" y "Meta WhatsApp Casagencia" de n8n.

// --- Asesoras ---------------------------------------------------------------
// Mismo reparto que el asistente telefonico: la referencia manda.
const ASESORA_POR_PREFIJO = { BN: 'Carmen', OR: 'Carmen', CS: 'Gisela', VR: 'Gisela' };
const EMAIL_POR_ASESORA = {
  Carmen: 'carmen@casagencia.com',
  Gisela: 'gisela@casagencia.com',
  Laurence: 'laurence@casagencia.com',
};
const EMAIL_DIRECCION = 'paco@casagencia.com';   // copia de todos los avisos

// --- Portales de los que llegan los leads por correo ------------------------
// Cada uno manda el aviso con un formato distinto. `de` casa contra el
// remitente y `asunto` contra el asunto; basta con que case uno de los dos.
const PORTALES = [
  { nombre: 'Idealista',  de: /idealista\.com/i,   asunto: /idealista/i },
  { nombre: 'Fotocasa',   de: /fotocasa\.es/i,     asunto: /fotocasa/i },
  { nombre: 'Habitaclia', de: /habitaclia\.com/i,  asunto: /habitaclia/i },
  { nombre: 'Web',        de: /casagencia\.com/i,  asunto: /formulario|contacto/i },
];

// --- Etiquetas de Chatwoot --------------------------------------------------
// Con ellas Paco ve de un vistazo en que punto esta cada conversacion.
const ETIQUETAS = {
  nueva:        'ia-nueva',
  cualificando: 'ia-cualificando',
  cualificado:  'ia-cualificado',
  cita:         'ia-cita-agendada',
  alquiler:     'ia-lead-alquiler',
  humano:       'intervenir',
};

// --- Herramientas que ya existen y se reutilizan ----------------------------
// El asistente de WhatsApp NO duplica la cartera ni el calendario: usa los
// mismos webhooks que el asistente telefonico, con sus guardafuegos de
// horario, festivos y "en alquiler no se agenda".
const N8N = 'https://n8n-casagencia.serversvisionarius.com/webhook';
const TOOLS = {
  buscarInmuebles:     N8N + '/buscarinmuebles',
  buscarPorReferencia: N8N + '/buscardisponibilidadporreferencia',
  buscarPorDireccion:  N8N + '/buscarpordireccion',
  disponibilidad:      N8N + '/buscardisponibilidad',
  confirmarCita:       N8N + '/confirmarcitacalendario',
  citaPorTelefono:     N8N + '/buscarcitaportelefono',
  registrarMensaje:    N8N + '/registrarmensaje',
};

// Segundos que se espera antes de contestar, para juntar los mensajes que el
// cliente manda seguidos ("hola" / "es por el piso" / "el de la calle X").
const BUFFER_SEGUNDOS = 60;

// Lo que se le dice a un lead de alquiler: no se le agenda nada.
const MSG_ALQUILER_SIN_AGENDA =
  'En los inmuebles de alquiler la visita la concierta directamente la asesora. ' +
  'Recojo tus datos y te llama ella.';

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

function prefijoDeReferencia(ref) {
  const m = String(ref ?? '').toUpperCase().match(/[A-Z]{2}/);
  return m ? m[0] : '';
}

function resolverAsesora(ref) {
  const prefijo = prefijoDeReferencia(ref);
  const asesora = ASESORA_POR_PREFIJO[prefijo] || null;
  return {
    prefijo,
    asesora,
    conocida: !!asesora,
    email: asesora ? EMAIL_POR_ASESORA[asesora] : EMAIL_POR_ASESORA.Laurence,
  };
}

// Alquiler o compra. Mismo criterio que el asistente telefonico: basta con que
// lo diga la operacion O que la referencia acabe en -A.
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
