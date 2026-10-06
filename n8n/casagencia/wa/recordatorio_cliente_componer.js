// [WA][SUB] RecordatorioCliente · Componer
// El mensaje de la plantilla de Meta con sus {{1}}, {{2}}... rellenos segun
// RECORDATORIO_CLIENTE[tipo].parametros, y el cuerpo para mandarlo por Chatwoot
// (asi queda en la conversacion del cliente y Sara lo ve si contesta).
const j = $('Start').first().json;
const conf = RECORDATORIO_CLIENTE[j.tipo] || {};
const ficha = (() => { try { return $('FichaDelInmueble').first().json || {}; } catch (e) { return {}; } })();
const conv = Number(j.conversacion_id || 0) || (() => {
  try { return Number($('ConversacionDelContacto').first().json.conversacion_id || 0); } catch (e) { return 0; }
})();

const municipio = String(ficha.municipio ?? '').split(' / ')[0].trim();
const zonaTxt = ficha.zona && municipio ? `en ${ficha.zona} (${municipio})` : municipio ? `en ${municipio}` : '';
const inmueble = [[ficha.tipo_inmueble, zonaTxt].filter(Boolean).join(' '), j.referencia ? `ref. ${j.referencia}` : '']
  .filter(Boolean).join(' · ') || 'el inmueble';
// La direccion, de la pestana Direcciones (la que usa el telefono)
let direccion = '';
try {
  const fila = $('LeerDirecciones').all().map(i => i.json)
    .find(d => String(d.ref ?? '').trim().toUpperCase() === String(j.referencia || '').toUpperCase());
  direccion = String(fila?.direccion ?? '').trim();
} catch (e) { direccion = ''; }
const valores = {
  nombre: String(j.nombre || '').trim() || '\u{1F44B}',
  cuando: j.cuando,
  fecha_hora: j.fecha_hora,
  hora: j.hora,
  inmueble,
  direccion: direccion || (municipio ? `en ${municipio} (te confirma el punto de encuentro tu asesora)` : 'te la confirma tu asesora'),
  asesora: j.asesora || 'tu asesora',
  referencia: j.referencia || '',
};
const params = {};
(conf.parametros || []).forEach((k, i) => { params[String(i + 1)] = paramPlantilla(valores[k] ?? '', 200); });

// El texto de la plantilla, de Meta; si no responde, uno de respaldo
let cuerpo = '';
try {
  const t = (($('PlantillaMeta').first().json || {}).data || []).find(p => p.name === conf.plantilla) || {};
  cuerpo = ((t.components || []).find(c => c.type === 'BODY') || {}).text || '';
} catch (e) { cuerpo = ''; }
if (!cuerpo) cuerpo = Object.keys(params).map(k => `{{${k}}}`).join(' · ');
let contenido = cuerpo;
for (const [k, val] of Object.entries(params)) contenido = contenido.split(`{{${k}}}`).join(val);

return [{ json: {
  conversacion_id: conv,
  contenido,
  body_mensaje: JSON.stringify({
    content: contenido,
    message_type: 'outgoing',
    template_params: { name: conf.plantilla, category: 'UTILITY', language: conf.idioma || 'es', processed_params: params },
  }),
} }];
