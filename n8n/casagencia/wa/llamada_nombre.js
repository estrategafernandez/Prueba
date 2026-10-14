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
const ref = /^[A-Z]{2}-\d{3,5}-[A-Z]$/.test(referencia) ? referencia : '';

// QUIEN SE QUEDA LA CONVERSACION, por este orden:
//  1. Si el cliente marco el movil de una comercial, es suya.
//  2. Si no (portal, oficina, numero general), la del INMUEBLE del que han
//     hablado: las lineas de los portales las comparten las dos, asi que el
//     telefono por el que ha entrado no dice de quien es el cliente.
//  3. Si tampoco hay inmueble, lo que diga el analisis de la llamada.
const deLaReferencia = ref ? resolverAsesora(ref).destinatario : '';
const segura = l.linea_asesora || (EQUIPO[deLaReferencia] ? deLaReferencia : '');
// Para el aviso y la nota vale tambien lo que diga el analisis de la llamada
const asesora = segura || l.asesora;
// Pero la conversacion del panel SOLO se asigna si lo sabemos de verdad (1 o 2).
// Si no, se deja sin asignar: ya la asignara bien el lead del portal cuando
// llegue el correo, o la coge quien la atienda. Antes se repartian por el
// telefono por el que entraba la llamada, que no dice nada.
const porQue = l.linea_asesora ? ' (marcó su teléfono)'
  : segura ? ` (por el inmueble ${ref})` : ' (sin confirmar: lo dice el análisis de la llamada)';

return [{ json: {
  ...l,
  nombre: limpio(extraido.nombre).slice(0, 80),
  referencia: ref,
  asesora,
  agente_id: (esPrueba(l.telefono_e164) || !segura) ? 0 : agenteDe(segura),
  // La nota del panel, ya con la asesora (aqui es donde se sabe de verdad)
  nota: [l.nota, l.linea ? `Entró por: ${l.linea}` : '',
         asesora ? `Asesora: ${asesora}${porQue}` : '']
    .filter(Boolean).join('\n'),
} }];
