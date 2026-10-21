// [WA] 12 · Seguimiento a la hora al que se queda parado · Componer
// El mensaje con el que se le repite la pregunta, en el idioma en el que se la
// hizo Sara. No es una plantilla de Meta: el cliente escribio hace menos de
// max_horas, asi que seguimos dentro de la ventana de 24 h y vale un mensaje
// normal por Chatwoot (asi queda en la conversacion y Sara lo ve).
return $('SoloLosNuevos').all().map(i => {
  const j = i.json;
  const idioma = idiomaDePregunta(j.pregunta);
  const texto = (TEXTOS_REPETIR[idioma] || TEXTOS_REPETIR.es)(j.pregunta);
  return { json: {
    ...j,
    idioma,
    contenido: texto,
    body_mensaje: JSON.stringify({ content: texto, message_type: 'outgoing', private: false }),
  } };
});
