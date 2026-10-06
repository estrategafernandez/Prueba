// [WA] 10 · Seguimiento a quien no contesta · Componer
// La plantilla de seguimiento de Meta con {{1}} = nombre, y el cuerpo para
// mandarla por Chatwoot (asi queda en la conversacion y Sara la ve si contesta).
const conf = SEGUIMIENTO;
let t = {};
try { t = (($('PlantillaMeta').first().json || {}).data || []).find(p => p.name === conf.plantilla) || {}; } catch (e) { t = {}; }
const aprobada = t.status === 'APPROVED';
const cuerpo = ((t.components || []).find(c => c.type === 'BODY') || {}).text || '{{1}}';

return $('SoloLosNuevos').all().map(i => {
  const j = i.json;
  const params = { 1: paramPlantilla(j.nombre, 60) };
  const contenido = cuerpo.split('{{1}}').join(params[1]);
  return { json: {
    ...j,
    aprobada,
    estado_plantilla: t.status || 'no encontrada',
    contenido,
    body_mensaje: JSON.stringify({
      content: contenido,
      message_type: 'outgoing',
      template_params: { name: conf.plantilla, category: t.category || 'MARKETING',
                         language: t.language || conf.idioma || 'es', processed_params: params },
    }),
  } };
});
