// [WA] 2 · Asistente · DividirRespuesta
// Un muro de texto en WhatsApp no lo lee nadie. La respuesta del agente se
// parte en mensajes cortos, como escribiria una persona, respetando los
// parrafos y sin cortar frases por la mitad.
const texto = String($input.first().json.output ?? $input.first().json.text ?? '').trim();

const LIMITE = 320;   // caracteres por mensaje
const MAXIMO = 5;     // nunca mas de 5 mensajes seguidos

const parrafos = texto.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
const trozos = [];
for (const p of parrafos) {
  if (p.length <= LIMITE) { trozos.push(p); continue; }
  // Parrafo largo: se parte por frases
  let actual = '';
  for (const frase of p.split(/(?<=[.!?])\s+/)) {
    if ((actual + ' ' + frase).trim().length > LIMITE && actual) { trozos.push(actual.trim()); actual = frase; }
    else actual = (actual + ' ' + frase).trim();
  }
  if (actual) trozos.push(actual.trim());
}

// Si salen mas de los permitidos, los ultimos se juntan en uno.
const mensajes = trozos.length <= MAXIMO
  ? trozos
  : [...trozos.slice(0, MAXIMO - 1), trozos.slice(MAXIMO - 1).join(' ')];

return mensajes.map((m, i) => ({
  json: {
    orden: i + 1,
    total: mensajes.length,
    mensaje: m,
    // pausa antes de mandarlo, para que no lleguen todos de golpe
    espera_segundos: i === 0 ? 0 : Math.min(4, 1 + Math.round(m.length / 120)),
  }
}));
