// [WA] 10 · Seguimiento a quien no contesta · Candidatos
// Entran las conversaciones del panel con la etiqueta 1-bienvenida_ia (una pagina
// de Chatwoot por item). Sale una por cada cliente al que toca mandarle el
// seguimiento ahora (SEGUIMIENTO en wa/config.js):
//  - estamos en horario comercial (de 9:00 a 19:00, hora de Espana);
//  - lo ultimo de la conversacion es la plantilla de bienvenida: ni el cliente ha
//    contestado ni nadie del equipo le ha escrito despues (y si ya se le mando el
//    seguimiento, lo ultimo es el seguimiento, asi que tampoco sale);
//  - la bienvenida es de hace 12 h o mas (y no de hace mas de max_horas);
//  - el bot no esta en Off.
// Que este CERRADA en el panel no lo impide: si la asesora le hubiera escrito,
// su mensaje seria lo ultimo y ya no saldria por la regla de arriba. Cerrarla
// sin escribirle es ordenar el panel, no renunciar al lead.
// Sale `tipo`: 'inmueble' (pregunto por uno concreto) o 'web' (nos escribio por
// la web, sin inmueble); cada uno lleva su plantilla de seguimiento.
const conf = SEGUIMIENTO;
const ahora = DateTime.now().setZone(ZONA);
if (!conf.activo || ahora.hour < conf.desde || ahora.hour >= conf.hasta) return [];

const ahoraSeg = Math.floor(ahora.toSeconds());
const convs = $input.all().flatMap(i => [].concat(i.json?.data?.payload || []));
const vistas = new Set();
const salida = [];
for (const c of convs) {
  if (!c || !c.id || vistas.has(c.id)) continue;
  vistas.add(c.id);
  if (!(c.labels || []).includes(ETIQUETAS.bienvenida)) continue;
  const contacto = c.meta?.sender || {};
  if (String(contacto.custom_attributes?.bot ?? '').trim().toLowerCase() === 'off') continue;

  const m = c.last_non_activity_message || {};
  const plantilla = m.additional_attributes?.template_params || {};
  // Saliente, no nota interna, y que sea una plantilla de bienvenida (o el
  // "Tambien he visto que te has interesado por este otro inmueble", que es la
  // bienvenida de una segunda solicitud)
  const p = plantilla.processed_params || {};
  const texto2 = String((p.body || p)['2'] ?? '');
  const abierta = plantilla.name === PLANTILLAS.abierta.nombre;
  // Un lead de la web no pregunto por ningun inmueble: su seguimiento es otro
  const esWeb = abierta && PREFIJOS_LEAD_WEB.some(x => texto2.startsWith(x));
  const esBienvenida = /^bienvenida/.test(String(plantilla.name || ''))
    || (abierta && PREFIJOS_OTRO_INMUEBLE.some(x => texto2.startsWith(x)));
  // Las demas plantillas abiertas (captacion de propietarios, "ya no esta
  // disponible") no se persiguen: el seguimiento no tendria sentido
  if (m.message_type !== 1 || m.private || !(esBienvenida || esWeb)) continue;
  const horas = (ahoraSeg - Number(m.created_at || 0)) / 3600;
  if (horas < conf.horas || horas > conf.max_horas) continue;

  const tel = normalizarTelefono(contacto.phone_number);
  if (!tel.e164) continue;
  // El mismo nombre que se le puso en la bienvenida; si no, el de pila del contacto
  const deLaBienvenida = String((p.body || p)['1'] ?? '').trim();
  const dePila = String(contacto.name ?? '').trim().split(/\s+/)[0];
  const nombre = (deLaBienvenida && deLaBienvenida !== '-') ? deLaBienvenida
    : (/^[\p{L}][\p{L}'-]*$/u.test(dePila) ? dePila : '\u{1F44B}');

  salida.push({ json: {
    conversacion_id: c.id,
    // Clave para no mandarlo dos veces: la bienvenida a la que sigue
    evento_id: `bienvenida:${m.id}`,
    telefono: tel.e164,
    nombre,
    bienvenida: plantilla.name,
    tipo: esWeb ? 'web' : 'inmueble',
    horas_desde_bienvenida: Math.round(horas * 10) / 10,
  } });
}
return salida;
