// [WA][SUB] buscarInmuebles · Filtrar
// Busqueda en la cartera actual con todos los filtros que puede pedir un
// cliente por WhatsApp: operacion, municipio, zona, tipo, habitaciones, banos,
// precio minimo y maximo, superficie y extras (piscina, terraza, garaje,
// ascensor, vistas al mar...).
const q = $('Start').first().json || {};
const filas = leerCartera('LeerCartera');
const dirs = leerDirecciones('LeerDirecciones');
const salida = (texto, extra = {}) => [{ json: { respuesta: texto, ...extra } }];

if (!filas.length) {
  return salida('No he podido consultar la cartera por un problema tecnico. No inventes resultados: ' +
    'dile al cliente que lo revisas con la asesora y usa avisarEquipo.', { total: 0 });
}

// Alquiler para todo el ano (larga duracion) o temporal (por meses de invierno)
const mq = sinAcentos(q.modalidad).toLowerCase();
const modalidad = /larga|anual|todo el ano|permanente|indefinid/.test(mq) ? 'larga_duracion'
  : /tempor|invierno|meses/.test(mq) ? 'temporal' : '';
const operacion = (modalidad || sinAcentos(q.operacion).includes('alquil')) ? 'alquiler'
  : (sinAcentos(q.operacion).match(/venta|compra/) ? 'venta' : '');
// Municipio: primero los de siempre (con sus nombres en valenciano y
// abreviaturas) y, si no, cualquiera que aparezca en la cartera de hoy. La lista
// fija no basta: a veces entra un inmueble en un pueblo nuevo (Sant Joan de
// Moro, por ejemplo) y no hay que decirle al cliente que ahi no hay nada.
const municipiosCartera = [...new Set(filas.map(r => r.municipio).filter(Boolean))];
let municipio = normalizarMunicipio(q.municipio);
if (!municipio && q.municipio) {
  const t = sinAcentos(q.municipio).trim();
  municipio = municipiosCartera.find(m => sinAcentos(m).split(' / ')
    .some(nombre => nombre && (t.includes(nombre) || nombre.includes(t)))) || '';
}
const zona = sinAcentos(q.zona).trim();
const hab = aNumero(q.habitaciones_min);
const banos = aNumero(q.banos_min);
const pmin = aNumero(q.precio_min);
const pmax = aNumero(q.precio_max);
const smin = aNumero(q.superficie_min);
const extras = String(q.extras ?? '').split(/[,;]/).map(s => sinAcentos(s).trim()).filter(Boolean);
const excluir = new Set(String(q.excluir ?? '').toUpperCase().split(/[,;\s]+/).filter(Boolean));
const limite = Math.min(Math.max(Math.round(aNumero(q.limite)) || 5, 1), 8);

if (q.municipio && !municipio) {
  return salida(`"${q.municipio}" no es una zona donde Casagencia tenga cartera ahora mismo. Hay inmuebles en: ` +
    municipiosCartera.map(municipioCorto).join(', ') + '. Preguntale si le vale alguna.', { total: 0 });
}

// El presupuesto no es excluyente: si dice 800, tambien se le ensena lo que
// cuesta hasta un 30 % mas (900, 1.000), marcado como por encima.
const tope = pmax ? Math.round(pmax * 1.3) : 0;
// Si no pide un tipo concreto, solo viviendas: a quien busca casa no se le
// ensenan locales ni oficinas (si no hay ninguna vivienda, entonces si).
const VIVIENDA = /apartamento|piso|chalet|villa|duplex|town house|village house|casa|estudio|ground floor|atico|bungalow|adosad|planta baja|bajo/;
let soloViviendas = !String(q.tipo ?? '').trim();
const filtrar = (f, techo = tope) => filas.filter(r =>
  (!soloViviendas || VIVIENDA.test(sinAcentos(r.tipo))) &&
  (!operacion || r.operacion === operacion) &&
  (!modalidad || r.modalidad === modalidad) &&
  (!municipio || r.municipio === municipio) &&
  (!f.zona || sinAcentos(r.zona).includes(f.zona) || sinAcentos(r.descripcion).includes(f.zona)) &&
  casaTipo(q.tipo, r.tipo) &&
  (!f.hab || r.habitaciones >= f.hab) &&
  (!f.banos || r.banos >= f.banos) &&
  (!pmin || r.precio >= pmin) &&
  (!techo || r.precio <= techo) &&
  (!f.smin || r.superficie >= f.smin) &&
  !excluir.has(r.ref.toUpperCase()));

// Si con todo lo pedido no sale nada, se van quitando los filtros secundarios
// (superficie y banos, luego la zona, luego una habitacion menos) y se avisa de
// cuales. Operacion, municipio, tipo y precio no se tocan nunca: son lo que el
// cliente de verdad quiere. Asi nunca se le dice "no hay nada" cuando si hay.
const PASOS = [
  { quitado: [], f: { zona, hab, banos, smin } },
  { quitado: ['superficie', 'banos'], f: { zona, hab } },
  { quitado: ['superficie', 'banos', 'zona'], f: { hab } },
  { quitado: ['superficie', 'banos', 'zona', 'una habitacion menos'], f: { hab: hab > 1 ? hab - 1 : 0 } },
];
let base = [], relajado = [], pasoUsado = PASOS[0];
for (const intento of soloViviendas ? [true, false] : [false]) {
  soloViviendas = intento;
  for (const paso of PASOS) {
    base = filtrar(paso.f);
    relajado = paso.quitado;
    pasoUsado = paso;
    if (base.length) break;
  }
  if (base.length) break;
}
// Ni con el margen: los mas baratos que haya, aunque se pasen de su presupuesto
let sinTope = false;
if (!base.length && pmax) {
  base = filtrar(PASOS[0].f, 0);
  sinTope = base.length > 0;
}
// Pocas opciones dentro del margen: se completa hasta 3 con las siguientes mas
// baratas, hasta el doble de su presupuesto (si dice 800 y hay de 1.000 y
// 1.100, se le ensenan las dos; uno de 5.500, no)
if (pmax && !sinTope && base.length && base.length < 3) {
  const ya = new Set(base.map(r => r.ref));
  base = base.concat(filtrar(pasoUsado.f, pmax * 2).filter(r => !ya.has(r.ref))
    .sort((a, b) => a.precio - b.precio).slice(0, 3 - base.length));
}
for (const r of base) r.encima = !!pmax && r.precio > pmax;

const aciertos = (r) => extras.filter(e => textoBuscable(r).includes(e)).length;
let lista = extras.length ? base.filter(r => aciertos(r) === extras.length) : base;
let aproximado = false;
if (!lista.length && extras.length) {
  // Nada cumple TODOS los extras: se ensenan los que cumplen mas, avisando.
  lista = base.filter(r => aciertos(r) > 0);
  aproximado = lista.length > 0;
}

// Orden: mas extras cumplidos, y luego el precio mas cercano a su presupuesto.
const objetivo = pmax || pmin || 0;
lista.sort((a, b) => (aciertos(b) - aciertos(a)) || (a.encima - b.encima) ||
  (objetivo ? Math.abs(a.precio - objetivo) - Math.abs(b.precio - objetivo) : a.precio - b.precio));

if (!lista.length) {
  return salida('No hay ningun inmueble en cartera con esos criterios' +
    (modalidad ? ` (${MODALIDAD_TEXTO[modalidad]})` : '') + (municipio ? ` en ${municipioCorto(municipio)}` : '') +
    '. No inventes: ofrecele mirar en otro municipio o con otro tipo, o que el equipo le avise si entra algo.',
    { total: 0 });
}

const muestra = lista.slice(0, limite);
const cabecera = (sinTope
  ? `No hay nada por debajo de ${pmax} €; estos son los mas economicos que hay. Diselo con el precio.\n` : '')
  + (lista.some(r => r.encima) && !sinTope
  ? `Los marcados POR ENCIMA DE SU PRESUPUESTO se pasan de los ${pmax} € que dijo: ensenaselos igualmente, diciendole el precio.\n` : '')
  + (relajado.length
  ? `No hay nada con TODO lo que pide; quitando ${relajado.join(', ')}, esto es lo mas parecido. Diselo asi.\n`
  : '') + (aproximado
  ? `Ninguno cumple todo lo que pide (${extras.join(', ')}); estos son los que mas se acercan. Diselo asi.\n`
  : '') + `${lista.length} inmueble${lista.length === 1 ? '' : 's'} en cartera. `;
const consejo = lista.length > 3
  ? 'Ensenale como mucho 3, los que mejor encajen, y preguntale algo para afinar (precio, zona o algun extra).'
  : 'Ensenaselos de forma breve.';

return salida(cabecera + consejo + ' Las referencias entre corchetes son internas: no las pongas en el mensaje.\n'
  + muestra.map(r => '- ' + tarjeta(r, dirs)).join('\n'),
  { total: lista.length, referencias: muestra.map(r => r.ref) });
