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

const operacion = sinAcentos(q.operacion).includes('alquil') ? 'alquiler'
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

const base = filas.filter(r =>
  (!operacion || r.operacion === operacion) &&
  (!municipio || r.municipio === municipio) &&
  (!zona || sinAcentos(r.zona).includes(zona) || sinAcentos(r.descripcion).includes(zona)) &&
  casaTipo(q.tipo, r.tipo) &&
  (!hab || r.habitaciones >= hab) &&
  (!banos || r.banos >= banos) &&
  (!pmin || r.precio >= pmin) &&
  (!pmax || r.precio <= pmax) &&
  (!smin || r.superficie >= smin) &&
  !excluir.has(r.ref.toUpperCase()));

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
lista.sort((a, b) => (aciertos(b) - aciertos(a)) ||
  (objetivo ? Math.abs(a.precio - objetivo) - Math.abs(b.precio - objetivo) : a.precio - b.precio));

if (!lista.length) {
  return salida('No hay ningun inmueble en cartera con esos criterios. No inventes: ofrecele relajar ' +
    'algun filtro (precio, habitaciones, zona) o que el equipo le avise si entra algo parecido.', { total: 0 });
}

const muestra = lista.slice(0, limite);
const cabecera = (aproximado
  ? `Ninguno cumple todo lo que pide (${extras.join(', ')}); estos son los que mas se acercan. Diselo asi.\n`
  : '') + `${lista.length} inmueble${lista.length === 1 ? '' : 's'} en cartera. `;
const consejo = lista.length > 3
  ? 'Ensenale como mucho 3, los que mejor encajen, y preguntale algo para afinar (precio, zona o algun extra).'
  : 'Ensenaselos de forma breve.';

return salida(cabecera + consejo + ' Las referencias entre corchetes son internas: no las pongas en el mensaje.\n'
  + muestra.map(r => '- ' + tarjeta(r, dirs)).join('\n'),
  { total: lista.length, referencias: muestra.map(r => r.ref) });
