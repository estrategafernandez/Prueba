// [WA] 4 · Cartera desde eGO · Mapear
// Convierte el feed XML de eGO en filas para la tabla wa_cartera, SIN recortar
// nada. Es la diferencia con la hoja del telefono ([TEL] XMLCacheo), que corta
// la descripcion a 500 caracteres: ahi se pierden cosas que preguntan los
// clientes (plaza de parking, trastero, los honorarios de la agencia...).
//
// Ademas construye el ENLACE de la web de cada inmueble: la web de Casagencia
// abre la ficha con el id del feed sin el "05" del principio
// (0525370429 -> https://www.casagencia.com/inmueble/.../25370429).
const raiz = $input.first().json.root ?? $input.first().json;
const lista = [].concat(raiz?.property ?? []).filter(p => p && p.ref);

const TIPOS = {
  'flat': 'Piso', 'apartment': 'Apartamento', 'chalet': 'Chalet', 'semi-detached house': 'Adosado',
  'duplex': 'Dúplex', 'commercial': 'Local comercial', 'house': 'Casa', 'villa': 'Villa',
  'penthouse': 'Ático', 'studio': 'Estudio', 'land': 'Terreno', 'townhouse': 'Casa adosada',
  'bungalow': 'Bungalow', 'country house': 'Casa de campo', 'garage': 'Garaje', 'storage': 'Trastero',
  'office': 'Oficina', 'building': 'Edificio', 'plot': 'Parcela', 'warehouse': 'Nave', 'shop': 'Local comercial',
};

// Caracteristicas del feed -> espanol. Las que no aportan nada al cliente
// (anchura, licencias internas, "no aplica"...) se descartan.
const CARACT = {
  'air conditioning': 'aire acondicionado', 'pre-installation for air conditioning': 'preinstalación de aire acondicionado',
  'alarm': 'alarma', 'aluminium windows': 'ventanas de aluminio', 'armoured door': 'puerta blindada',
  'high security door': 'puerta de seguridad', 'attic': 'buhardilla', 'autonomous heating': 'calefacción individual',
  'individual heating': 'calefacción individual', 'central heating': 'calefacción central', 'heat pump': 'bomba de calor',
  'aerothermia': 'aerotermia', 'balconies': 'balcones', 'balcony': 'balcón', 'barbecue': 'barbacoa',
  'bathtub': 'bañera', 'shower': 'ducha', 'beach': 'playa cerca', 'built-in wardrobes': 'armarios empotrados',
  'wardrobes': 'armarios', 'dressing room': 'vestidor', 'city center': 'centro ciudad', 'countryside': 'en el campo',
  'covered terrace': 'terraza cubierta', 'terrace': 'terraza', 'roof garden': 'terraza en la azotea', 'porch': 'porche',
  'dishwasher': 'lavavajillas', 'washing machine': 'lavadora', 'fridge': 'frigorífico', 'refrigerator freezer': 'frigorífico',
  'microwave': 'microondas', 'oven': 'horno', 'induction cooktop': 'placa de inducción', 'vitroceramic cooktop': 'vitrocerámica',
  'equipped kitchen': 'cocina equipada', 'kitchenette': 'cocina americana', 'double glazed': 'doble acristalamiento',
  'electric blinds': 'persianas eléctricas', 'en-suite bathroom': 'baño en suite', 'suite': 'suite',
  'guest bathroom': 'aseo de cortesía', 'half bath': 'aseo', 'fireplace': 'chimenea', 'furnished': 'amueblado',
  'garden': 'jardín', 'winter garden': 'jardín de invierno', 'garage': 'garaje', 'indoor parking': 'parking interior',
  'outdoor parking': 'parking exterior', 'parking': 'parking', 'public parking': 'parking público cerca',
  'golf course': 'campo de golf cerca', 'gymnasium': 'gimnasio', 'green areas': 'zonas verdes',
  'children\'s playground': 'parque infantil', 'playground': 'parque infantil', 'good condition': 'buen estado',
  'excellent condition': 'excelente estado', 'in use condition': 'para entrar a vivir', 'impaired mobility access': 'accesible',
  'laundry room': 'lavadero', 'lift': 'ascensor', 'natural light': 'luminoso', 'panoramic views': 'vistas panorámicas',
  'view to sea': 'vistas al mar', 'view to beach': 'vistas a la playa', 'view to mountain': 'vistas a la montaña',
  'view to city': 'vistas a la ciudad', 'pantry': 'despensa', 'pets allowed': 'se admiten mascotas', 'pharmacy': 'farmacia cerca',
  'school': 'colegio cerca', 'supermarket': 'supermercado cerca', 'shopping center': 'centro comercial cerca',
  'market': 'mercado cerca', 'hospital': 'hospital cerca', 'health center': 'centro de salud cerca',
  'public transport': 'transporte público', 'train station': 'estación de tren cerca', 'bus station': 'estación de autobús cerca',
  'highway': 'autovía cerca', 'police': 'comisaría cerca', 'bank': 'banco cerca', 'sealed complex': 'urbanización cerrada',
  'closed condominium': 'urbanización cerrada', 'solar panels': 'placas solares', 'solar hot water': 'agua caliente solar',
  'storage room': 'trastero', 'storage area': 'trastero', 'swimming pool': 'piscina', 'swimming pools': 'piscinas',
  'outdoor private swimming pool': 'piscina privada', 'outdoor shared swimming pool': 'piscina comunitaria',
  'tennis court': 'pista de tenis', 'sports court': 'pista deportiva', 'video intercom': 'videoportero',
  'wine cellar': 'bodega', 'social housing': 'vivienda de protección oficial (VPO)', 'outdoor building': 'exterior',
  'indoor building': 'interior', 'street level location': 'a pie de calle', 'on the upper floor location': 'en planta alta',
  'temporary rental licence': 'licencia de alquiler temporal', 'natural gas': 'gas natural', 'piped gas': 'gas ciudad',
  'internet connection': 'conexión a internet', 'contemporary': 'estilo contemporáneo', 'smoke extraction': 'salida de humos',
};
const CON_NUMERO = {
  'bedrooms': 'habitaciones', 'bedroom': 'habitación', 'bathrooms': 'baños', 'bathroom': 'baño',
  'half bath': 'aseo', 'garage': 'plazas de garaje', 'indoor parking': 'plazas de parking interior',
  'outdoor parking': 'plazas de parking exterior', 'lift': 'ascensor', 'floor': 'planta', 'number of floors': 'plantas',
  'living rooms': 'salones', 'living room': 'salón', 'kitchens': 'cocinas', 'kitchen': 'cocina',
  'suites': 'suites', 'terrace area': 'm² de terraza', 'garage area': 'm² de garaje', 'land area': 'm² de parcela',
  'plot': 'm² de parcela', 'distance from the sea': 'metros al mar', 'storage room': 'trasteros',
};
const SINGULAR = {
  'habitaciones': 'habitaci\u00f3n', 'ba\u00f1os': 'ba\u00f1o', 'plazas de garaje': 'plaza de garaje',
  'plazas de parking interior': 'plaza de parking interior', 'plazas de parking exterior': 'plaza de parking exterior',
  'plantas': 'planta', 'salones': 'sal\u00f3n', 'cocinas': 'cocina', 'suites': 'suite', 'trasteros': 'trastero',
};
const DESCARTAR = /^(length|width|monthly price|max no\. of|not applicable|no floor|bedding|kitchenware|water|electricity|gas|gas cylinder|cooker|electric cooker|gas stove|extractor hood|corridor|lobby|entrance hall|other room|wall|fence|usage license|swimming pool licence|at-\d|hydropneumatic|water boiler|water heater|heated towel rack|indoor parking \(|outdoor parking \(|construction started|no unpaved|asphalt|flat land|moderate land|east land|north solar|south\/west|traditional trade|wide range|taxi rank|public library|office|warehouse|annexes|building|bicycle stand|closed circuit|dining room|lunchroom|bedrooms hall|wc with|excellent access|gas station|kitchens?$)/;

const texto = (v) => (v === undefined || v === null ? '' : (typeof v === 'object' ? (v._ ?? '') : String(v))).trim();

function traducir(f) {
  const t = texto(f);
  if (!t) return '';
  const l = t.toLowerCase();
  let m = l.match(/^(\d{4})-\d{2}-\d{2}\s+construction ended$/);
  if (m) return `año de construcción ${m[1]}`;
  m = l.match(/^([\d.]+)\s+(gross|net) area$/);
  if (m) return `${Math.round(parseFloat(m[1]))} m² ${m[2] === 'gross' ? 'construidos' : 'útiles'}`;
  m = l.match(/^([\d.]+)\s+(.+)$/);
  if (m) {
    const n = parseFloat(m[1]);
    if (m[2] === 'floor') return `planta ${n}`;
    if (m[2] === 'lift') return 'ascensor';
    if (CON_NUMERO[m[2]]) return `${n} ${n === 1 ? (SINGULAR[CON_NUMERO[m[2]]] || CON_NUMERO[m[2]]) : CON_NUMERO[m[2]]}`;
    if (CARACT[m[2]]) return CARACT[m[2]];
    return DESCARTAR.test(m[2]) ? '' : t;
  }
  if (CARACT[l]) return CARACT[l];
  return DESCARTAR.test(l) ? '' : t;
}

const slug = (s) => sinAcentos(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const filas = lista.map(p => {
  const ref = texto(p.ref);
  const venta = texto(p.price_freq).toLowerCase() === 'sale';
  const tipo = TIPOS[texto(p.type).toLowerCase()] || texto(p.type);
  const municipio = texto(p.town);
  const caracteristicas = [...new Set([].concat(p.features?.feature ?? []).map(traducir).filter(Boolean))];

  // Superficie: la construida del feed y, si viene a 0, la de las caracteristicas
  let superficie = Math.round(parseFloat(texto(p.surface_area?.built)) || 0);
  if (!superficie) {
    const s = caracteristicas.find(c => /m² construidos$/.test(c)) || caracteristicas.find(c => /m² útiles$/.test(c));
    if (s) superficie = parseInt(s, 10) || 0;
  }

  const id = texto(p.id).replace(/^05/, '');
  const enlace = id
    ? `https://www.casagencia.com/inmueble/${slug(`${tipo} en ${venta ? 'venta' : 'alquiler'} ${String(municipio).split(' / ')[0]}`)}/${id}`
    : '';
  const imagenes = [].concat(p.images?.image ?? []);

  return {
    ref,
    web_id: id,
    enlace,
    precio: parseFloat(texto(p.price)) || 0,
    tipo_transaccion: venta ? 'venta' : 'alquiler',
    tipo_inmueble: tipo,
    municipio,
    zona: texto(p.location_detail),
    habitaciones: parseInt(texto(p.beds), 10) || 0,
    banos: parseInt(texto(p.baths), 10) || 0,
    superficie,
    caracteristicas: caracteristicas.join(', '),
    descripcion: texto(p.desc?.es).replace(/\r/g, ''),
    imagen: texto(imagenes[0]?.url),
  };
});

// Si el feed viene vacio o roto NO se toca la tabla: mejor una cartera de hace
// una hora que ninguna.
return [{ json: { ok: filas.length >= 20, total: filas.length, filas } }];
