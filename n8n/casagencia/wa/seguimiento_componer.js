// [WA] 10 · Seguimiento a quien no contesta · Componer
// La plantilla de seguimiento de Meta con {{1}} = nombre, y el cuerpo para
// mandarla por Chatwoot (asi queda en la conversacion y Sara la ve si contesta).
// Cada candidato lleva la suya segun su `tipo`: 'inmueble' (pregunto por uno
// concreto) o 'web' (nos escribio por la web, sin inmueble). Si la de un
// candidato no esta aprobada en Meta, ese no se manda y se reintenta; los demas
// salen igual.
const conf = SEGUIMIENTO;
let todas = [];
try { todas = (($('PlantillaMeta').first().json || {}).data || []); } catch (e) { todas = []; }

return $('SoloLosNuevos').all().map(i => {
  const j = i.json;
  const nombrePlantilla = j.tipo === 'web' ? conf.plantilla_web : conf.plantilla;
  const t = todas.find(p => p.name === nombrePlantilla) || {};
  const cuerpo = ((t.components || []).find(c => c.type === 'BODY') || {}).text || '{{1}}';
  const params = { 1: paramPlantilla(j.nombre, 60) };
  const contenido = cuerpo.split('{{1}}').join(params[1]);
  return { json: {
    ...j,
    plantilla: nombrePlantilla,
    aprobada: t.status === 'APPROVED',
    estado_plantilla: t.status || 'no encontrada',
    contenido,
    body_mensaje: JSON.stringify({
      content: contenido,
      message_type: 'outgoing',
      template_params: { name: nombrePlantilla, category: t.category || 'MARKETING',
                         language: t.language || conf.idioma || 'es', processed_params: params },
    }),
  } };
});
