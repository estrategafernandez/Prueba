// [EGO][SUB] NotaEnEgo · Preparar
// Solo se escribe en eGO con MODO_LEADS = 'real' (o con un telefono de prueba).
const j = $input.first().json || {};
const tel = normalizarTelefono(j.telefono);
const texto = String(j.texto || '').trim().slice(0, 3800);
return [{ json: {
  nueve: tel.nacional.slice(-9),
  texto,
  escribir: tel.valido && !!texto && leadsEnReal(tel.e164),
  // Tipo de historial en eGO (ListNoteType): 84 WhatsApp, 115 Llamada
  tipo_historial: String(j.tipo || '').toLowerCase() === 'llamada' ? 115 : 84,
  modo: MODO_LEADS,
  prueba: esPrueba(tel.e164),
} }];
