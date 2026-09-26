// [WA][SUB] · RespuestaParaElAgente
// Los webhooks del asistente telefonico contestan con un objeto que ya trae
// 'mensaje_para_sara': la instruccion de que hacer. Al agente de WhatsApp se le
// da eso mismo, en texto plano, para que no tenga que interpretar JSON.
let r = $input.first().json;
if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = { texto: r }; } }
if (r && typeof r.data === 'string') { try { r = JSON.parse(r.data); } catch (e) { /* se deja */ } }
r = r?.respuesta ?? r ?? {};

const partes = [];
if (r.mensaje_para_sara) partes.push(String(r.mensaje_para_sara));

// Los datos utiles que no siempre caben en el mensaje
const extra = {};
for (const k of ['encontrado', 'fiabilidad', 'disponible', 'alternativas', 'cita_confirmada',
                 'motivo', 'referencia', 'asesora', 'fecha', 'hora', 'inmuebles', 'citas',
                 'total', 'mensaje_registrado', 'evento_id', 'inmueble']) {
  if (r[k] !== undefined && r[k] !== null && r[k] !== '') extra[k] = r[k];
}
if (Object.keys(extra).length) partes.push('Datos: ' + JSON.stringify(extra));

if (!partes.length) partes.push('La herramienta no ha devuelto nada. No te inventes el dato: ' +
  'dile al cliente que lo comprueba la asesora y deja un aviso.');

return [{ json: { respuesta: partes.join('\n') } }];
