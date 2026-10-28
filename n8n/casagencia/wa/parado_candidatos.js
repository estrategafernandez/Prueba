// [WA] 12 · Seguimiento a la hora al que se queda parado · Candidatos
// Entran las conversaciones del panel con la etiqueta 2-en_proceso (una pagina
// de Chatwoot por item). Sale una por cada cliente al que hay que repetirle la
// pregunta ahora (SEGUIMIENTO_PARADO en wa/config.js):
//  - estamos en horario comercial (de 9:00 a 19:00, hora de Espana);
//  - lo ultimo de la conversacion es una pregunta que escribio SARA (no una
//    plantilla, no una nota interna, no el cliente y no una persona del equipo);
//  - lleva sin contestar `horas` o mas (y menos de max_horas, para no escribir
//    fuera de la ventana de 24 h de WhatsApp);
//  - el bot no esta en Off y la conversacion no la lleva ya una persona
//    (4-intervenir).
// Que este cerrada en el panel no lo impide, igual que en el seguimiento de las
// 12 h: si alguien le hubiera escrito, su mensaje seria lo ultimo y no saldria.
const conf = SEGUIMIENTO_PARADO;
const ahora = DateTime.now().setZone(ZONA);
if (!conf.activo || ahora.hour < conf.desde || ahora.hour >= conf.hasta) return [];

const ahoraSeg = Math.floor(ahora.toSeconds());
const convs = $input.all().flatMap(i => [].concat(i.json?.data?.payload || []));
const vistas = new Set();
const salida = [];
for (const c of convs) {
  if (!c || !c.id || vistas.has(c.id)) continue;
  vistas.add(c.id);
  const etiquetas = c.labels || [];
  if (!etiquetas.includes(ETIQUETAS.en_proceso)) continue;
  // Si ya la lleva una persona, no se le repite nada
  if (etiquetas.includes(ETIQUETAS.intervenir)) continue;
  const contacto = c.meta?.sender || {};
  if (String(contacto.custom_attributes?.bot ?? '').trim().toLowerCase() === 'off') continue;

  const m = c.last_non_activity_message || {};
  if (m.message_type !== 1 || m.private) continue;
  // Si esa pregunta no le llego, repetirsela tampoco va a llegar
  if (m.status === 'failed') continue;
  // Tiene que haberla escrito Sara: si fue una persona del equipo, ya esta
  // encima de la conversacion y no pintamos nada
  const quien = String(m.sender_type ?? m.sender?.type ?? '').toLowerCase();
  if (quien === 'user' && Number(m.sender_id ?? m.sender?.id ?? 0) !== CHATWOOT_USUARIO_IA) continue;
  // Y tiene que ser una pregunta suya, no una plantilla ni una despedida
  const texto = String(m.content ?? '').trim();
  const esPlantilla = !!(m.additional_attributes?.template_params?.name);
  if (esPlantilla || !texto || !/[?？]/.test(texto)) continue;

  const horas = (ahoraSeg - Number(m.created_at || 0)) / 3600;
  if (horas < conf.horas || horas > conf.max_horas) continue;

  const tel = normalizarTelefono(contacto.phone_number);
  if (!tel.e164) continue;

  // Se le llama por su nombre de pila. Si el contacto no tiene nombre (o es su
  // propio telefono), va vacio y el mensaje sale sin nombre.
  const dePila = String(contacto.name ?? '').trim().split(/\s+/)[0];
  const nombre = /^[\p{L}][\p{L}'-]*$/u.test(dePila) ? dePila : '';

  salida.push({ json: {
    conversacion_id: c.id,
    // Clave para no repetirla dos veces: la pregunta que se quedo sin contestar
    evento_id: `parado:${m.id}`,
    telefono: tel.e164,
    nombre,
    pregunta: texto,
    horas_parado: Math.round(horas * 10) / 10,
  } });
}
return salida;
