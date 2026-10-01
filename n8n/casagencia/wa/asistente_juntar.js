// [WA] 2 · Asistente · JuntarMensajes  (seccion "Recolectar inputs")
// El cliente suele escribir en varios mensajes seguidos ("hola" / un audio /
// "el de la calle X"). Se han esperado 60 segundos y este turno es el del
// mensaje MAS NUEVO; aqui se juntan todos y se le pasan al agente como UNO.
//
//  1. Lo que habia en la cola de Redis (ya transcrito si era audio y descrito
//     si era imagen). Cada entrada es {id, ts, t}: con el id del mensaje de
//     Chatwoot se ordenan como los escribio y dos "ok" seguidos no se pisan.
//  2. Red de seguridad: si Chatwoot manda dos avisos casi a la vez puede meter
//     en los dos el mismo mensaje (el ultimo) y el otro no llega nunca a la
//     cola. Se miran los ultimos mensajes de la conversacion y se rescata el
//     que falte: entrante, de este mismo rato y anterior al mas nuevo de la
//     cola (los posteriores son de otro turno que todavia esta esperando).
const VENTANA_RESCATE_SEGUNDOS = 30;
const d = $('EntradaMensaje').first().json;

const leer = (x) => {
  if (x == null || x === '') return null;
  if (typeof x === 'string') {
    try { x = JSON.parse(x); } catch (e) { return { id: null, ts: 0, t: x }; }
  }
  if (typeof x !== 'object') return { id: null, ts: 0, t: String(x) };
  return { id: x.id ?? null, ts: Number(x.ts) || 0, t: String(x.t ?? '').trim() };
};
const nodo = (n) => { try { return $(n).all().map(i => i.json); } catch (e) { return []; } };

// 1. La cola
let cola = nodo('Saca los mensajes de Redis').map(j => leer(j.entrada)).filter(Boolean);
if (!cola.length) {
  // GET devuelve el mas nuevo primero (LPUSH): se le da la vuelta
  const g = nodo('Obtiene todos los Mensajes')[0]?.message;
  cola = (Array.isArray(g) ? [...g].reverse() : [g]).map(leer).filter(Boolean);
}
if (!cola.length) cola = [{ id: d.mensaje_id, ts: d.creado, t: d.contenido }];
const porId = new Map();
for (const e of cola) {
  const k = e.id != null ? 'id:' + e.id : 't:' + e.t;
  if (!porId.has(k)) porId.set(k, e);
}

// 2. Rescate de los que Chatwoot no llego a mandar
const textoDe = (m) => {
  const txt = String(m.content ?? '').trim();
  const a = (m.attachments ?? [])[0];
  if (!a) return txt;
  const tipo = String(a.file_type ?? '').toLowerCase();
  const que = tipo === 'audio' ? '[nota de voz que no se ha podido escuchar]'
    : tipo === 'image' ? '[imagen que no se ha podido ver]'
    : '[el cliente ha enviado un archivo]';
  return txt ? `${que} ${txt}` : que;
};
const rescatados = [];
const lista = nodo('MensajesDeLaConversacion')[0]?.payload;
const idsCola = [...porId.values()].map(e => Number(e.id)).filter(n => Number.isFinite(n) && n > 0);
if (Array.isArray(lista) && idsCola.length) {
  const maxId = Math.max(...idsCola);
  const tiempos = [...porId.values()].map(e => e.ts).filter(t => t > 0);
  const desde = tiempos.length ? Math.min(...tiempos) - VENTANA_RESCATE_SEGUNDOS : 0;
  const esSalida = (m) => !m.private && (m.message_type === 1 || m.message_type === 3 ||
    m.message_type === 'outgoing' || m.message_type === 'template');
  const ultimaSalida = Math.max(0, ...lista.filter(m => esSalida(m) && Number(m.id) < maxId).map(m => Number(m.id)));
  for (const m of lista) {
    const id = Number(m.id);
    const entrante = m.message_type === 0 || m.message_type === 'incoming';
    if (!entrante || m.private || porId.has('id:' + m.id)) continue;
    if (!(id < maxId && id > ultimaSalida)) continue;
    if (Number(m.created_at) < desde) continue;
    const t = textoDe(m);
    if (t) rescatados.push({ id, ts: Number(m.created_at) || 0, t });
  }
}

// En el orden en que los escribio (el id de Chatwoot crece con cada mensaje)
const todos = [...porId.values(), ...rescatados].sort((a, b) => {
  const ia = Number(a.id), ib = Number(b.id);
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia > 0 && ib > 0) return ia - ib;
  return (a.ts || 0) - (b.ts || 0);
});
const mensajes = todos.map(e => e.t).filter(Boolean);

return [{
  json: {
    mensaje: mensajes.length ? mensajes.join('\n') : d.contenido,
    numero_de_mensajes: mensajes.length || 1,
    rescatados: rescatados.length,
    ids: todos.map(e => e.id),
    telefono_e164: d.telefono_e164,
    telefono_wa: d.telefono_wa,
    nombre: d.nombre,
    conversacion_id: d.conversacion_id,
    contacto_id: d.contacto_id,
    cuenta_id: d.cuenta_id,
  }
}];
