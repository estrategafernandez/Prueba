// ===========================================================================
// LEADS ENTRANTES (web y eGO): que primer mensaje le toca a cada uno
// ---------------------------------------------------------------------------
// Se inyecta despues de config.js en los nodos que deciden la plantilla.
//
//   compra / alquiler con un inmueble DISPONIBLE -> bienvenida_compra / _alquiler
//                                                  ({{2}} = enlace del anuncio)
//   el inmueble ya NO esta disponible (vendido, reservado, retirado o fuera de
//   la cartera)                                  -> plantilla_abierta: ya no esta,
//                                                  y que Sara le ensena otros
//   compra / alquiler SIN inmueble (formulario general de la web)
//                                                -> plantilla_abierta con lo que busca
//   propietario que quiere vender o alquilar su vivienda
//                                                -> plantilla_abierta + aviso a la asesora
//   cualquier otra cosa                          -> nada: lo revisa una persona
// ===========================================================================

const TEXTOS_ABIERTA = {
  no_disponible: {
    es: (r) => `Soy Sara, IA de Casagencia. El inmueble por el que nos preguntaste${r.referencia ? ` (ref. ${r.referencia})` : ''} ya no está disponible, pero tenemos otros parecidos que te pueden encajar. ¿Quieres que te los enseñe por aquí?`,
    en: (r) => `I'm Sara, Casagencia's AI. The property you asked about${r.referencia ? ` (ref. ${r.referencia})` : ''} is no longer available, but we have similar ones that may suit you. Shall I show them to you here?`,
    fr: (r) => `Je suis Sara, l'IA de Casagencia. Le bien qui vous intéressait${r.referencia ? ` (réf. ${r.referencia})` : ''} n'est plus disponible, mais nous en avons d'autres similaires. Voulez-vous que je vous les montre ici ?`,
  },
  busqueda: {
    es: (r) => `Soy Sara, IA de Casagencia. Hemos recibido el mensaje que nos dejaste en nuestra web${r.resumen_cliente ? ` sobre ${r.resumen_cliente}` : ''}. ¿Te ayudo por aquí? Cuéntame qué buscas y te enseño lo que tenemos.`,
    en: (r) => `I'm Sara, Casagencia's AI. We received the message you left on our website${r.resumen_cliente ? ` about ${r.resumen_cliente}` : ''}. Can I help you here? Tell me what you are looking for and I'll show you what we have.`,
    fr: (r) => `Je suis Sara, l'IA de Casagencia. Nous avons bien reçu votre message sur notre site${r.resumen_cliente ? ` concernant ${r.resumen_cliente}` : ''}. Je peux vous aider ici : dites-moi ce que vous cherchez et je vous montre ce que nous avons.`,
  },
  // Segunda solicitud de la misma persona por OTRO inmueble (en pocos dias): en vez
  // de repetir la bienvenida, la plantilla abierta con este texto. Tiene que empezar
  // por uno de PREFIJOS_OTRO_INMUEBLE (config.js): asi lo reconoce el seguimiento.
  otro_inmueble: {
    es: (r) => `También he visto que te has interesado por este otro inmueble: ${r.enlace} ¿Lo quieres también visitar?`,
    en: (r) => `I've also seen that you're interested in this other property: ${r.enlace} Would you like to visit it too?`,
    fr: (r) => `J'ai aussi vu que ce bien vous intéresse : ${r.enlace} Souhaitez-vous également le visiter ?`,
  },
  propietario: {
    es: (r) => `Soy Sara, IA de Casagencia. Hemos recibido tu mensaje sobre tu vivienda${r.municipio ? ` en ${r.municipio}` : ''}. ${r.asesora} se pondrá en contacto contigo para hablarlo; si quieres, cuéntame por aquí cómo es.`,
    en: (r) => `I'm Sara, Casagencia's AI. We received your message about your property${r.municipio ? ` in ${r.municipio}` : ''}. ${r.asesora} will contact you to discuss it; meanwhile, feel free to tell me about it here.`,
    fr: (r) => `Je suis Sara, l'IA de Casagencia. Nous avons bien reçu votre message au sujet de votre bien${r.municipio ? ` à ${r.municipio}` : ''}. ${r.asesora} vous contactera pour en parler ; en attendant, vous pouvez m'en dire plus ici.`,
  },
};

// Idioma del mensaje del cliente (para la plantilla abierta). Por defecto, espanol.
function idiomaDe(texto) {
  const t = sinAcentos(texto);
  if (/\b(bonjour|je |j'|cordialement|merci|madame|monsieur|appartement|interesse)/.test(t)) return 'fr';
  if (/\b(hello|hi|dear|i am|i'm|i would|interested|thank|regards|please)\b/.test(t)) return 'en';
  return 'es';
}

const TIPOS_BUSCA = ['compra', 'alquiler', 'alquiler_temporada', 'sin_mensaje'];
const TIPOS_PROPIETARIO = ['vender_su_vivienda', 'alquilar_su_vivienda'];

// r: { tipo, referencia, disponible (true/false/null = no se sabe), enlace,
//      nombre, idioma, resumen_cliente, municipio, operacion }
function decidirPrimerMensaje(r) {
  const idioma = ['es', 'en', 'fr'].includes(r.idioma) ? r.idioma : 'es';
  const tipo = String(r.tipo || 'otro');
  const asesora = resolverAsesora(r.referencia, r.municipio).destinatario;
  const alquiler = tipo === 'alquiler' || tipo === 'alquiler_temporada' || esAlquiler(r.referencia, r.operacion);
  const nombre = String(r.nombre || '').trim().split(/\s+/)[0] || '';
  const base = { asesora, es_alquiler: alquiler, operacion: alquiler ? 'alquiler' : 'venta',
                 param1: paramPlantilla(nombre || '\u{1F44B}', 60) };
  const abierta = (clave, accion) => ({ ...base, accion, plantilla: PLANTILLAS.abierta.nombre,
    param2: paramPlantilla(TEXTOS_ABIERTA[clave][idioma]({ ...r, asesora }), 900) });

  if (TIPOS_PROPIETARIO.includes(tipo)) return abierta('propietario', 'captacion');
  if (r.referencia && r.disponible === false) return abierta('no_disponible', 'no_disponible');
  if (r.referencia && r.enlace && (TIPOS_BUSCA.includes(tipo) || tipo === 'otro' || !tipo)) {
    const p = alquiler ? PLANTILLAS.alquiler : PLANTILLAS.compra;
    return { ...base, accion: 'bienvenida', plantilla: p.nombre, param2: paramPlantilla(r.enlace, 300),
             // Si ya le escribimos por otro inmueble hace poco, sale esto en su lugar
             plantilla_tambien: PLANTILLAS.abierta.nombre,
             param2_tambien: paramPlantilla(TEXTOS_ABIERTA.otro_inmueble[idioma](r), 900) };
  }
  if (TIPOS_BUSCA.includes(tipo)) return abierta('busqueda', 'busqueda');
  return { ...base, accion: 'revisar', plantilla: '', param2: '' };
}
