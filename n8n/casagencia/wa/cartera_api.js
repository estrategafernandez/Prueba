// [WA] 4 · Cartera desde eGO · Mapear
// Convierte lo que devuelve la API de eGO (ListRealestateByPage con los
// disponibles) en las filas de wa_cartera. Antes esto salia del feed XML de
// Janela; la API da lo mismo y mejor:
//   - los tipos y las caracteristicas vienen YA en espanol (el feed dejaba en
//     ingles "Town House", "Ground floor", "Office / Practice"...);
//   - la descripcion entera, sin recortar;
//   - el tipo de negocio, que es lo que distingue el alquiler de larga duracion
//     (2) del temporal (13), sin una segunda llamada;
//   - cuatro inmuebles mas que el feed.
// Los diccionarios (tipos, caracteristicas, zonas y municipios) llegan de los
// nodos anteriores, que son listas de la propia API.
const datos = (nodo, dentro) => {
  try {
    const j = $(nodo).first().json;
    const d = j?.datos ?? j;
    return [].concat((dentro ? d?.[dentro] : d) ?? []);
  } catch (e) { return []; }
};

const lista = datos('InmueblesEgo', 'realestatesByPageDto').filter(p => p && p.reference);
const es = (o) => String(o?.['ES-ES'] ?? o?.['EN-GB'] ?? '').trim();
const TIPO_POR_ID = Object.fromEntries(datos('TiposDeInmueble').map(t => [t.id, es(t.name)]));
const CARACT_POR_ID = Object.fromEntries(datos('CaracteristicasEgo').map(f => [f.id, es(f.name)]));
const ZONA_POR_ID = Object.fromEntries(datos('ZonasEgo').map(l => [l.id, l]));
// Municipios (nivel 3) y barrios (nivel 4), para resolver el nombre de la zona
const LUGAR_POR_ID = Object.fromEntries(datos('LugaresEgo').map(l => [l.id, String(l.name ?? '').trim()]));

// Negocio: 1 venta, 2 alquiler (larga duracion), 13 alquiler temporal, 3 traspaso.
const VENTA = 1, ALQUILER = 2, TEMPORAL = 13;

// Caracteristicas que NO se ponen en la lista: las que ya tienen su columna
// (superficie, banos, habitaciones), las que no dicen nada sin valor
// ("Conservacion", "Interior/Exterior", "Ubicacion") y las internas.
const SIN_LISTA = new Set(['Superficie Construida', 'Superficie útil', 'Baños', 'Total dormitorios',
  'Conservación', 'Interior/Exterior', 'Ubicación', 'Orientación Solar', 'Tipo de Terreno (desnivel)',
  'Acceso al terreno', 'Orientación del Terreno', 'Distancia sin asfalto hasta el terreno', 'Ancho',
  'Longitud', 'Licencia de Utilización', 'Licencia de piscina', 'Licencia Turística',
  'Número de registro para alquileres temporales', 'Precio mensual', 'Nº máximo de adultos',
  'Nº máximo de niños', 'Superficie terraza', 'Superficie garaje', 'Superficie trastero']);
// Lo que esta CERCA se dice asi: "colegio cerca", no "escuela"
const CERCA = { 'Escuela': 'colegio', 'Policía': 'comisaría', 'Comercio': 'comercios',
  'Autopista': 'autovía', 'Farmacia': 'farmacia', 'Playa': 'playa', 'Banco': 'banco', 'Hospital': 'hospital', 'Mercado': 'mercado',
  'Centro de salud': 'centro de salud', 'Centro comercial': 'centro comercial', 'Gasolinera': 'gasolinera',
  'Estación de autobuses': 'estación de autobús', 'Estación de tren': 'estación de tren',
  'Campo de golf': 'campo de golf', 'Campo deportivo': 'instalaciones deportivas', 'Taxis': 'parada de taxis',
  'Amplia Oferta de Servicios': 'muchos servicios', 'Excelentes Accesos': 'buenos accesos' };
// Las que se leen mejor con otro nombre
const RENOMBRAR = { 'Fin de la construcción': 'año construcción', 'Inicio de la construcción': '',
  'Superfície parcela': 'parcela', 'Distancia del Mar': 'distancia al mar', 'Vista al mar': 'vistas al mar',
  'Vista a la playa': 'vistas a la playa', 'Vista a la montaña': 'vistas a la montaña',
  'Vista a la ciudad': 'vistas a la ciudad', 'Total dormitorios': '',
  'Centro urbano': 'centro ciudad', 'Parques y jardines': 'zonas verdes',
  'Transportes públicos': 'transporte público', 'Piscina compartida': 'piscina comunitaria' };

function caracteristica(f) {
  const nombre = CARACT_POR_ID[f.featureId];
  if (!nombre || SIN_LISTA.has(nombre)) return '';
  if (CERCA[nombre]) return `${CERCA[nombre]} cerca`;
  // "Numero de plantas: 1" no dice nada; a partir de dos, si
  if (nombre === 'Número de plantas') {
    const n = parseInt(f.value, 10) || 0;
    return n > 1 ? `${n} plantas` : '';
  }
  const base = RENOMBRAR[nombre] !== undefined ? RENOMBRAR[nombre] : nombre.toLowerCase();
  if (!base) return '';
  const valor = String(f.value ?? '').trim();
  // Las que se cuentan se leen mejor delante: "2 cocinas", no "cocina(s) 2"
  const n = /^\d+$/.test(valor) ? parseInt(valor, 10) : 0;
  const contable = PLURAL[nombre] || (/\(s\)$/.test(nombre) ? nombre.replace(/\(s\)$/, 's').toLowerCase() : '');
  if (contable && n) return n > 1 ? `${n} ${contable}` : nombre.toLowerCase().replace(/\(s\)$/, '');
  // Sin valor o "1" (lo tiene / no lo tiene): solo el nombre. Con numero: "planta 2"
  if (!valor || valor === '1' || valor === 'true') return base;
  if (/^parcela$|^distancia al mar$|^año construcción$/.test(base) && /^\d+$/.test(valor)) {
    return base === 'parcela' ? `parcela ${valor} m²`
      : base === 'distancia al mar' ? `a ${valor} m del mar` : `${base} ${valor}`;
  }
  return `${base} ${valor}`;
}

// Caracteristicas que se cuentan (con su plural)
const PLURAL = { 'Aseo': 'aseos', 'Balcón': 'balcones', 'Bañera': 'bañeras', 'Garaje': 'garajes',
  'Trastero': 'trasteros', 'Comedor': 'comedores', 'Despacho': 'despachos', 'Galería': 'galerías',
  'Plato de ducha': 'platos de ducha', 'Armarios empotrados': 'armarios empotrados', 'Salas': 'salas',
  'Otras salas': 'otras salas', 'Aparcamiento interior': 'plazas de garaje',
  'Aparcamiento exterior': 'plazas de aparcamiento', 'Ascensor': 'ascensores' };

const slug = (s) => sinAcentos(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const aEntero = (v) => Math.round(Number(v) || 0);

const filas = lista.map(p => {
  const negocios = [].concat(p.businesses ?? []);
  // El traspaso (3) va con su alquiler: manda el negocio "de verdad"
  const negocio = negocios.find(b => [VENTA, ALQUILER, TEMPORAL].includes(b.businessTypeId)) || negocios[0] || {};
  const tipoNegocio = Number(negocio.businessTypeId || 0);
  const venta = tipoNegocio === VENTA;
  const precio = Number(([].concat(negocio.prices ?? [])[0] || {}).value) || 0;

  const tipo = TIPO_POR_ID[p.natureTypeId] || '';
  const zonaLoc = ZONA_POR_ID[p.locationId] || {};
  // El municipio es el nivel 3 de la ficha de la zona ("Benicasim / Benicàssim")
  const municipio = LUGAR_POR_ID[zonaLoc.level3] || '';
  // La zona, la del nivel 4 ("Centro", "Pueblo", "Voramar"), como se ha hecho
  // siempre. Si eGO afina mas (nivel 5: "Hospital - Plaza del Real"), ese
  // nombre se guarda tambien para que quien lo busque por ahi lo encuentre.
  const zona = LUGAR_POR_ID[zonaLoc.level4] || String(zonaLoc.name ?? '').trim();
  const zonaFina = zonaLoc.level === 5 ? String(zonaLoc.name ?? '').trim() : '';

  const caracteristicas = [...new Set([].concat(p.features ?? []).map(caracteristica).filter(Boolean))];
  if (zonaFina && zonaFina !== zona) caracteristicas.unshift(zonaFina);
  const superficie = aEntero(p.grossArea) || aEntero(p.nettArea);

  // El id de la web lleva ocho cifras: la API lo da como numero y algunos
  // pierden el cero de delante (2352461 -> 02352461)
  const web_id = p.metabaseId ? String(p.metabaseId).padStart(8, '0') : '';
  const enlace = web_id && tipo && municipio
    ? `https://www.casagencia.com/inmueble/${slug(`${tipo} en ${venta ? 'venta' : 'alquiler'} ${municipio.split(' / ')[0]}`)}/${web_id}`
    : '';

  // La foto: la primera del inmueble, por el CDN de eGO
  const media = p.firstMedia || {};
  const imagen = media.uid && p.id
    ? `https://feedmedia.egorealestate.com/Zfeed/S5/C4338/P${p.id}/Tphoto/ID${media.uid}${media.format || '.jpg'}`
    : '';

  const descripcion = es(p.description).replace(/\r/g, '');
  // Alquiler de larga duracion o temporal: lo dice el tipo de negocio y, si no
  // es un alquiler conocido, la descripcion (como antes)
  const modalidad = venta ? ''
    : tipoNegocio === ALQUILER ? 'larga_duracion'
    : tipoNegocio === TEMPORAL ? 'temporal'
    : modalidadAlquiler('', descripcion);

  return {
    ref: String(p.reference).trim(),
    web_id,
    enlace,
    precio,
    tipo_transaccion: venta ? 'venta' : 'alquiler',
    tipo_inmueble: tipo || 'Inmueble',
    municipio,
    zona,
    habitaciones: aEntero(p.rooms),
    banos: aEntero(p.bathrooms),
    superficie,
    caracteristicas: caracteristicas.join(', '),
    descripcion,
    imagen,
    modalidad,
    // Solo las usa la hoja del telefono (wa_cartera no tiene estas columnas)
    latitud: p.gpsLat == null ? '' : String(p.gpsLat),
    longitud: p.gpsLon == null ? '' : String(p.gpsLon),
  };
});

// Sin precio es una ficha interna de la agencia, no un inmueble que ofrecer
const ofrecibles = filas.filter(f => f.precio > 0);

// Si la API falla o devuelve cuatro cosas, NO se toca la tabla: mejor una
// cartera de hace una hora que ninguna.
const conDatos = ofrecibles.filter(f => f.ref && f.tipo_inmueble !== 'Inmueble' && f.municipio);
return [{ json: {
  ok: ofrecibles.length >= 20 && conDatos.length >= ofrecibles.length * 0.9,
  total: ofrecibles.length,
  completos: conDatos.length,
  sin_precio: filas.filter(f => !(f.precio > 0)).map(f => f.ref),
  sin_enlace: ofrecibles.filter(f => !f.enlace).map(f => f.ref),
  filas: ofrecibles,
} }];
