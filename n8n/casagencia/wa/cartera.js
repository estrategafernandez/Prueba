// ===========================================================================
// CARTERA · utilidades comunes de los nodos que leen la cartera
// ---------------------------------------------------------------------------
// La cartera de WhatsApp es la tabla wa_cartera de Postgres, que rellena cada
// hora [WA] 4 desde el MISMO feed de eGO que usa el telefono, pero completa:
// descripcion entera (la hoja del telefono la corta a 500 caracteres),
// superficie, caracteristicas en espanol y el enlace de la web de cada inmueble.
// La pestana "Direcciones" del Google Sheet (ref, direccion) la rellena la
// agencia a mano y se sigue leyendo de ahi.
// ===========================================================================
const MUNICIPIOS = [
  { valor: 'Almazora / Almassora',                       claves: ['almazora', 'almassora'] },
  { valor: 'Alquerías del Niño Perdido',                 claves: ['alquerias', 'alqueries'] },
  { valor: 'Benicasim / Benicàssim',                     claves: ['benicasim', 'benicassim', 'beni'] },
  { valor: 'Borriol',                                    claves: ['borriol'] },
  { valor: 'Burriana / Borriana',                        claves: ['burriana', 'borriana'] },
  { valor: 'Castellón de la Plana / Castelló de la Plana', claves: ['castellon', 'castello'] },
  { valor: 'Onda',                                       claves: ['onda'] },
  { valor: 'Oropesa del Mar / Orpesa',                   claves: ['oropesa', 'orpesa'] },
  { valor: 'Torreblanca',                                claves: ['torreblanca'] },
  { valor: 'Vilafamés',                                  claves: ['vilafames'] },
  { valor: 'Vila-real',                                  claves: ['vila-real', 'villarreal', 'vilareal', 'vila real'] },
];

function normalizarMunicipio(texto) {
  const t = sinAcentos(texto).trim();
  if (!t) return '';
  for (const m of MUNICIPIOS) if (m.claves.some(c => t.includes(c))) return m.valor;
  return '';
}

// Nombre corto para ensenar al cliente: "Castellón", no "Castellón de la Plana / Castelló..."
const municipioCorto = (v) => String(v ?? '').split(' / ')[0].replace(' de la Plana', '');

// Sinonimos de tipo: el cliente dice "casa" y en la hoja pone "Chalet" o "Villa".
const TIPOS = {
  piso:    ['piso', 'apartamento', 'atico', 'duplex', 'estudio', 'planta baja', 'flat'],
  casa:    ['casa', 'chalet', 'villa', 'adosad', 'bungalow', 'finca', 'unifamiliar'],
  atico:   ['atico'],
  local:   ['local', 'oficina', 'nave'],
  terreno: ['terreno', 'parcela', 'solar', 'suelo'],
  garaje:  ['garaje', 'parking', 'plaza'],
  trastero:['trastero'],
};
function casaTipo(pedido, tipoFila) {
  const p = sinAcentos(pedido).trim();
  if (!p) return true;
  const t = sinAcentos(tipoFila);
  const lista = TIPOS[p] || Object.values(TIPOS).find(l => l.some(x => p.includes(x))) || [p];
  return lista.some(x => t.includes(x));
}

const aNumero = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

function limpiarFila(r) {
  return {
    ref: String(r.ref).trim(),
    precio: aNumero(r.precio),
    operacion: String(r.tipo_transaccion ?? '').toLowerCase().includes('alquil') ? 'alquiler' : 'venta',
    tipo: String(r.tipo_inmueble ?? '').trim() || 'Inmueble',
    municipio: String(r.municipio ?? '').trim(),
    zona: String(r.zona ?? '').trim(),
    habitaciones: Math.round(aNumero(r.habitaciones)),
    banos: Math.round(aNumero(r.banos)),
    superficie: Math.round(aNumero(r.superficie)),
    caracteristicas: String(r.caracteristicas ?? '').trim(),
    descripcion: String(r.descripcion ?? '').replace(/\s+/g, ' ').trim(),
    imagen: String(r.imagen ?? '').trim(),
    enlace: String(r.enlace ?? '').trim(),
  };
}

function leerCartera(nodo) {
  return $(nodo).all().map(i => i.json).filter(r => r && r.ref).map(limpiarFila);
}

function leerDirecciones(nodo) {
  const dirs = {};
  try {
    for (const it of $(nodo).all()) {
      const j = (it && it.json) ? it.json : {};
      if (j.ref && j.direccion) dirs[String(j.ref).trim().toUpperCase()] = String(j.direccion).trim();
    }
  } catch (e) { /* sin pestana de direcciones: se sigue sin ellas */ }
  return dirs;
}

const euros = (n, operacion) => n
  ? n.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' €' + (operacion === 'alquiler' ? '/mes' : '')
  : 'precio a consultar';

// Todo el texto donde buscar extras ("piscina", "vistas al mar"...)
const textoBuscable = (r) => sinAcentos(`${r.tipo} ${r.zona} ${r.caracteristicas} ${r.descripcion}`);

// Una linea por inmueble, para listados
function tarjeta(r, dirs) {
  const partes = [
    `${r.tipo} en ${r.zona ? r.zona + ', ' : ''}${municipioCorto(r.municipio)}`,
    r.habitaciones ? `${r.habitaciones} hab.` : '',
    r.banos ? `${r.banos} baños` : '',
    r.superficie ? `${r.superficie} m²` : '',
    euros(r.precio, r.operacion),
  ].filter(Boolean);
  const dir = dirs && dirs[r.ref.toUpperCase()];
  const destacado = r.caracteristicas.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3).join(', ');
  return `[${r.ref}] ${partes.join(' · ')}` + (dir ? ` · ${dir}` : '')
    + (destacado ? ` · ${destacado}` : '') + (r.enlace ? ` · ${r.enlace}` : '');
}

// Busca una referencia con la misma tolerancia que el telefono: exacta, luego
// prefijo + numero (se ignoran las letras intermedias y la final), luego solo numero.
function buscarReferencia(filas, texto) {
  const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const partes = s => {
    const n = norm(s);
    const pref = (n.match(/^[A-Z]{2}/) || [''])[0];
    const nums = (n.match(/\d+/g) || []).sort((a, b) => b.length - a.length);
    return { n, pref, num: nums[0] || '' };
  };
  const q = partes(texto);
  if (!q.n) return { filas: [], parecidas: [] };
  const idx = filas.map(r => ({ r, p: partes(r.ref) }));
  let m = idx.filter(x => x.p.n === q.n);
  if (!m.length && q.pref && q.num) m = idx.filter(x => x.p.pref === q.pref && x.p.num === q.num);
  if (!m.length && q.num) m = idx.filter(x => x.p.num === q.num);
  const parecidas = (!m.length && q.pref && q.num)
    ? idx.filter(x => x.p.pref === q.pref && x.p.num.length === q.num.length &&
        [...x.p.num].filter((c, i) => c !== q.num[i]).length === 1).map(x => x.r.ref).slice(0, 3)
    : [];
  return { filas: m.map(x => x.r), parecidas };
}

// La ficha COMPLETA de un inmueble, en texto, tal y como la lee el agente.
function fichaTexto(r, dirs) {
  const dir = dirs && dirs[r.ref.toUpperCase()];
  return [
    `Referencia: ${r.ref}`,
    `Operacion: ${r.operacion === 'alquiler' ? 'ALQUILER (no se agenda: se cualifica y se pasa al equipo)' : 'VENTA'}`,
    `Tipo: ${r.tipo}`,
    `Municipio: ${municipioCorto(r.municipio)}`,
    r.zona ? `Zona: ${r.zona}` : '',
    `Direccion: ${dir || 'no consta (no la deduzcas; si la pide, ofrece que se la confirme la asesora)'}`,
    `Precio: ${euros(r.precio, r.operacion)}`,
    r.superficie ? `Superficie: ${r.superficie} m\u00b2` : '',
    r.habitaciones ? `Habitaciones: ${r.habitaciones}` : '',
    r.banos ? `Ba\u00f1os: ${r.banos}` : '',
    r.caracteristicas ? `Caracteristicas: ${r.caracteristicas}` : '',
    r.descripcion ? `Descripcion del anuncio: ${r.descripcion}` : '',
    r.enlace ? `Enlace de la web (se lo puedes mandar): ${r.enlace}` : '',
    `Asesora: ${resolverAsesora(r.ref, r.municipio).destinatario}`,
  ].filter(Boolean).join('\n');
}
