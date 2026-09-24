// BuscarPorDireccion · EmparejarDireccion
// El feed XML de Janela NO trae la calle: solo municipio, zona, CP y coordenadas,
// y la web de Casagencia tampoco la publica. Por eso hay una pestana "Direcciones"
// en la hoja de calculo, que la agencia rellena a mano y que XMLCacheo nunca pisa.
// Por eso se extraen los TOPONIMOS del texto de cada inmueble: los nombres que
// van detras de una palabra de via ("calle X", "plaza Y", "urbanizacion Z").
// Comparar contra toponimos, y no contra el texto entero, evita que "Roma"
// case dentro de "aroma" o que "playa" convierta media cartera en candidata.
// Si algun dia se anade una columna "direccion" a la hoja, se usa automaticamente
// y con el peso mas alto, sin tocar este codigo.
const body = ($('Webhook').first().json.body) ?? {};
const consulta = String(body.direccion ?? '').trim();
const municipioPedido = String(body.municipio ?? '').trim();
const operacionPedida = String(body.operacion ?? '').trim().toLowerCase();

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Palabras de via: introducen un nombre de calle, no forman parte de el.
const VIA = 'calle|carrer|avenida|avinguda|avda|av|plaza|placa|pza|plza|paseo|passeig|' +
            'ronda|camino|cami|travesia|urbanizacion|urb|partida|grupo|poligono|barrio|sector';
// Palabras que cortan el nombre de la via.
const CORTE = new Set([
  'y', 'o', 'a', 'en', 'con', 'de', 'del', 'la', 'el', 'los', 'las', 'que', 'es',
  'esta', 'este', 'se', 'su', 'sus', 'por', 'para', 'un', 'una', 'al', 'desde',
  'hasta', 'muy', 'mas', 'minutos', 'metros', 'km', 'esquina', 'junto', 'cerca',
  'situado', 'situada', 'ubicado', 'ubicada', 'donde', 'tiene', 'cuenta', 'dispone'
]);
// Palabras que no distinguen un inmueble de otro dentro de la consulta.
const RUIDO = new Set([
  'calle', 'c', 'carrer', 'avenida', 'avda', 'av', 'avinguda', 'plaza', 'placa',
  'pza', 'plza', 'paseo', 'passeig', 'ronda', 'camino', 'cami', 'travesia',
  'urbanizacion', 'urb', 'partida', 'grupo', 'poligono', 'barrio', 'sector',
  'numero', 'num', 'n', 'piso', 'puerta', 'pta', 'escalera', 'esc', 'bajo', 'sn',
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'con', 'a', 'al', 'es', 'esta',
  'un', 'una', 'mi', 'su', 'por', 'llamo', 'vi', 'uno', 'busco', 'quiero', 'era',
  'inmueble', 'vivienda', 'casa', 'chalet', 'apartamento', 'local', 'sobre'
]);

// Extrae los nombres de via de un texto ya normalizado.
const reVia = new RegExp('\\b(?:' + VIA + ')\\s+(?:de\\s+(?:la\\s+|los\\s+|las\\s+)?|del\\s+)?' +
                         '([a-z0-9]+(?:\\s+[a-z0-9]+){0,2})', 'g');
function toponimos(texto) {
  const out = [];
  let m;
  reVia.lastIndex = 0;
  while ((m = reVia.exec(texto)) !== null) {
    const palabras = [];
    for (const w of m[1].split(' ')) {
      // La palabra de corte solo corta a partir de la segunda: hay vias que
      // empiezan por una ("calle En Medio", "urbanizacion La Coma").
      if ((palabras.length && CORTE.has(w)) || /^\d{3,}$/.test(w)) break;
      palabras.push(w);
    }
    // se descarta el numero de portal final: "alloza 12" -> "alloza"
    while (palabras.length > 1 && /^\d+$/.test(palabras[palabras.length - 1])) palabras.pop();
    if (palabras.length && !(palabras.length === 1 && palabras[0].length < 3)) {
      out.push(palabras.join(' '));
    }
  }
  return out;
}

let tokens = norm(consulta).split(' ').filter(t => t && !RUIDO.has(t));
let palabras = tokens.filter(t => /[a-z]/.test(t) && t.length >= 3);

// Hay calles que se llaman como una via ("Carrer Paseo", "Avenida Gran Via"):
// si al quitar las palabras de via no queda nada, se conservan. Pero solo si
// quedan DOS o mas: un "calle" suelto no es una direccion.
if (!palabras.length) {
  const todas = norm(consulta).split(' ').filter(Boolean);
  const rescate = todas.filter(t => /[a-z]/.test(t) && t.length >= 3 && !CORTE.has(t));
  if (rescate.length >= 2) { tokens = todas; palabras = rescate; }
}
const numeros = tokens.filter(t => /^\d+$/.test(t));

if (!palabras.length) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'consulta_vacia',
    mensaje_para_sara: 'No he entendido la direccion. Pidele al cliente que repita el nombre de la calle.'
  } } }];
}

const filas = $('LeerInmuebles').all().map(i => i.json).filter(r => r && r.ref);

// Si la hoja no ha respondido, NO es que el inmueble no exista: es una
// incidencia. Decirle al cliente "no lo tengo" cuando en realidad fallo la
// lectura es peor que reconocer el problema.
if (!filas.length) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'error_datos',
    mensaje_para_sara: 'No he podido consultar la cartera por un problema tecnico. NO le digas al cliente que ese inmueble no existe. Discupate, pidele la referencia del anuncio si la tiene, y si no, registra un mensaje para que la asesora le llame.'
  } } }];
}

// Direcciones introducidas a mano por la agencia (pestana "Direcciones").
// Si la pestana no existe o esta vacia, la busqueda sigue funcionando igual.
const manual = {};
try {
  for (const it of $('LeerDirecciones').all()) {
    const j = (it && it.json) ? it.json : {};
    if (j.ref && j.direccion) manual[String(j.ref).trim().toUpperCase()] = String(j.direccion);
  }
} catch (e) { /* sin pestana de direcciones */ }

const casaPalabra = (aguja, pajar) => new RegExp('\\b' + aguja + '[a-z]{0,3}\\b').test(pajar);

const puntuar = (r) => {
  // La direccion manual se compara entera Y por toponimos: asi vale tanto
  // "Calle Mestre Falla 39" como "Mestre Falla 39" sin palabra de via.
  const dir = norm(manual[String(r.ref).trim().toUpperCase()] || r.direccion || '');
  // Campos que de verdad indican DONDE esta el inmueble.
  const campos = [
    [dir ? [dir, ...toponimos(dir)] : [], 8],  // direccion puesta a mano: manda
    [[norm(r.zona)], 4],                       // zona del CRM: "Voramar", "Marina d'Or"
    [toponimos(norm(r.descripcion)), 3]        // "en la plaza Fadrell", "calle Alloza"
  ];
  let total = 0;
  const casan = [];
  for (const p of palabras) {
    let mejor = 0;
    for (const [lista, peso] of campos) {
      if (lista.some(t => t && casaPalabra(p, t))) { mejor = Math.max(mejor, peso); }
    }
    if (mejor) { total += mejor; casan.push(p); }
  }
  if (casan.length) {
    const todo = campos.flatMap(([lista]) => lista).join(' ');
    for (const n of numeros) {
      if (new RegExp('\\b' + n + '\\b').test(todo)) { total += 2; break; }
    }
  }
  return { total, casan: [...new Set(casan)] };
};

let candidatos = filas.map(r => ({ r, ...puntuar(r) }));

if (municipioPedido) {
  const m = norm(municipioPedido);
  const conMun = candidatos.filter(c => {
    const mun = norm(c.r.municipio);
    return m.split(' ').some(w => w.length > 3 && mun.includes(w));
  });
  if (conMun.length) candidatos = conMun;
}
if (operacionPedida) {
  const conOp = candidatos.filter(c => norm(c.r.tipo_transaccion).includes(norm(operacionPedida)));
  if (conOp.length) candidatos = conOp;
}

const MIN = 3;
candidatos = candidatos.filter(c => c.casan.length > 0 && c.total >= MIN)
  .sort((a, b) => b.total - a.total);

// Consulta demasiado vaga ("el centro", "cerca de la playa"): encaja media
// cartera y ninguno destaca. Pero si UNO gana con claridad, no es vaga: es una
// direccion buena que ademas comparte palabras con otras muchas.
// Basta con que el mejor puntue alto: eso significa que hay una direccion de
// verdad detras. Que empaten dos no es vaguedad, es que hay dos inmuebles en
// la misma calle, y ahi lo correcto es ensenar los dos y preguntar.
const hayGanador = candidatos.length > 0 && candidatos[0].total >= 8;

if (candidatos.length > 6 && !hayGanador) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'demasiado_generico',
    mensaje_para_sara: 'Con esa direccion me encajan demasiados inmuebles. Pidele la calle exacta con el numero. Si todavia no le has preguntado por la referencia del anuncio, pidesela tambien; si ya te ha dicho que no la tiene, no insistas. NO le leas un listado.'
  } } }];
}

candidatos = candidatos.slice(0, 3);

if (!candidatos.length) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'sin_coincidencias',
    mensaje_para_sara: 'No localizo ningun inmueble por esa direccion. Dile al cliente que por la calle no te aparece. Si todavia no le has preguntado por la referencia del anuncio, pidesela ahora; si ya te ha dicho que no la tiene, NO se la vuelvas a pedir: ofrecele buscar por municipio y caracteristicas, o registrar un mensaje para que la asesora localice el inmueble y le llame. NO le leas un listado de inmuebles que no ha pedido.'
  } } }];
}

const fmt = (c) => {
  const r = c.r;
  const precio = r.precio ? `${Number(r.precio).toLocaleString('es-ES')} euros` : 'precio a consultar';
  const dir = manual[String(r.ref).trim().toUpperCase()] || r.direccion || '';
  return `${r.tipo_inmueble || 'Inmueble'} en ${dir || r.zona || r.municipio}, referencia ${r.ref}, ` +
         `${r.habitaciones || '?'} habitaciones, ${precio} (${r.tipo_transaccion})`;
};

// Fiable cuando solo encaja uno, o cuando el primero le saca mucha ventaja al
// segundo (ej. 18 contra 3): en ese caso Sara puede confirmarlo directamente.
const fiable = candidatos[0].total >= 6 &&
  (candidatos.length === 1 || candidatos[0].total >= candidatos[1].total * 2);

return [{ json: { respuesta: {
  encontrado: true,
  fiabilidad: fiable ? 'alta' : 'media',
  coincidencias: candidatos.map(c => ({
    ref: c.r.ref, municipio: c.r.municipio, zona: c.r.zona,
    direccion: manual[String(c.r.ref).trim().toUpperCase()] || c.r.direccion || '',
    tipo: c.r.tipo_inmueble, precio: c.r.precio,
    operacion: c.r.tipo_transaccion, habitaciones: c.r.habitaciones,
    puntuacion: c.total
  })),
  mensaje_para_sara: fiable
    ? `Creo que es este: ${fmt(candidatos[0])}. Confirmaselo al cliente antes de seguir.`
    : `Por esa direccion me encajan estos, pero no es seguro: ${candidatos.map(fmt).join(' | ')}. Preguntale al cliente cual es el suyo antes de dar nada por hecho.`
} } }];
