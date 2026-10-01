// [TEL] Llamada al panel · DatosDelCliente
// Lo que OpenAI ha sacado de la transcripcion: el nombre del cliente (si lo
// dijo) y la referencia del inmueble (si la dijo). Si no ha podido, vacio.
const l = $('LeerLlamada').first().json;
let extraido = {};
try {
  const r = $('NombreEnLaTranscripcion').first().json;
  extraido = JSON.parse(r.choices?.[0]?.message?.content || '{}');
} catch (e) { extraido = {}; }
const limpio = (v) => {
  const s = String(v ?? '').trim();
  return s && !/^(null|undefined|desconocido|no lo dice|sara)$/i.test(s) ? s : '';
};
const referencia = limpio(extraido.referencia).toUpperCase();
return [{ json: {
  ...l,
  nombre: limpio(extraido.nombre).slice(0, 80),
  referencia: /^[A-Z]{2}-\d{3,5}-[A-Z]$/.test(referencia) ? referencia : '',
} }];
