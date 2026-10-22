// [WA] 5 · Leads de eGO · ComponerVuelta
// El cliente vuelve a preguntar por el MISMO inmueble antes de 30 dias y el
// inmueble sigue igual que la vez anterior (si hubiera cambiado de estado, el
// alta lo habria dado por nuevo y le habria salido "ya no esta disponible").
// No se le repite la bienvenida: se le manda la plantilla abierta preguntandole
// que necesita, para que la conversacion se reabra y conteste una persona.
const d = $('Decidir').item.json;
const idioma = ['es', 'en', 'fr'].includes(d.idioma) ? d.idioma : 'es';
const nombre = String(d.nombre || '').trim().split(/\s+/)[0] || '';

return [{ json: {
  ...d,
  plantilla: PLANTILLAS.abierta.nombre,
  param1: paramPlantilla(nombre || '\u{1F44B}', 60),
  param2: paramPlantilla(TEXTOS_ABIERTA.vuelve_a_preguntar[idioma](d), 900),
  // La plantilla abierta no tiene {{3}}
  param3: '',
  accion: 'vuelve_a_preguntar',
  // Para el aviso a la asesora
  resumen_vuelta: `Ha vuelto a preguntar por ${d.referencia || 'un inmueble'}`
    + (d.estado_inmueble ? ` (${d.estado_inmueble})` : '') + ` desde ${d.portal || 'un portal'}`,
} }];
