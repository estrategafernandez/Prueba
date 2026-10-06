// buscarInmuebles · FiltrarYFormatear
// Filtra la hoja Inmuebles con lo que manda Retell y le devuelve el texto para
// leerlo en la llamada. Igual que en WhatsApp:
//  - Alquiler de LARGA DURACION (todo el ano) o TEMPORAL (por meses de invierno):
//    lo dice eGO (wa_cartera.modalidad, nodo ModalidadCartera) y, si no, la
//    descripcion.
//  - El presupuesto (precio_max) no es excluyente: se ensena tambien lo que se
//    pasa hasta un 30 %, marcado POR ENCIMA DE SU PRESUPUESTO.
// Retell manda los datos sueltos (args_at_root); si llegan dentro de "args", tambien.
const peticion = ($('Webhook').first().json.body) ?? {};
const body = (peticion.args && typeof peticion.args === 'object') ? peticion.args : peticion;

const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const aNumero = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// Igual que modalidadAlquiler de wa/cartera.js (los tests comprueban que no se separen)
function modalidadPorDescripcion(descripcion) {
  const d = plano(descripcion);
  if (/temporada|temporal|no vacacional|por paquete|de (septiembre|octubre|noviembre) (a|hasta)|hasta (final de )?(mayo|junio)/.test(d)) return 'temporal';
  if (/alquiler anual|larga duracion|(alquiler|apartamento|piso|vivienda|casa|vivir) para todo el ano/.test(d)) return 'larga_duracion';
  if (/invierno/.test(d)) return 'temporal';
  return '';
}
const MODALIDAD_HABLADA = {
  larga_duracion: 'alquiler de larga duración, para todo el año',
  temporal: 'alquiler temporal, por meses de invierno, no todo el año',
};

// eGO: ref -> modalidad. Si la base de datos falla, se tira de la descripcion.
let deEgo = [];
try { deEgo = $('ModalidadCartera').all().map(i => i.json); } catch (e) { deEgo = []; }
const modalidadEgo = new Map(deEgo.filter(r => r && r.ref && r.modalidad)
  .map(r => [String(r.ref).trim().toUpperCase(), String(r.modalidad)]));

const filas = $('BuscarInmuebles').all().map(i => i.json).filter(r => r && r.ref).map(r => {
  const operacion = plano(r.tipo_transaccion);
  return {
    ...r,
    ref: String(r.ref).trim(),
    precio: aNumero(r.precio),
    habitaciones: aNumero(r.habitaciones),
    operacion,
    modalidad: operacion.includes('alquil')
      ? (modalidadEgo.get(String(r.ref).trim().toUpperCase()) || modalidadPorDescripcion(r.descripcion)) : '',
  };
});

const municipio = plano(body.municipio);
const operacion = plano(body.operacion);
const hab = aNumero(body.habitaciones);
const pmin = aNumero(body.precio_min);
const pmax = aNumero(body.precio_max);
const mq = plano(body.modalidad);
const modalidad = !operacion.includes('alquil') ? ''
  : /larga|anual|todo el ano|permanente|indefinid/.test(mq) ? 'larga_duracion'
  : /tempor|invierno|meses/.test(mq) ? 'temporal' : '';

const encaja = (r, techo, conModalidad = true) =>
  r.habitaciones >= hab &&
  plano(r.municipio).includes(municipio) &&
  r.operacion.includes(operacion) &&
  r.precio >= pmin &&
  (!techo || r.precio <= techo) &&
  (!conModalidad || !modalidad || r.modalidad === modalidad);

// Presupuesto: hasta un 30 % por encima. Si ni asi hay nada, los mas baratos que
// haya. Si salen menos de 3, se completa con los siguientes hasta el doble (si dice
// 800 y hay de 1.000 y 1.100, se le ensenan; uno de 5.500, no).
const tope = pmax ? Math.round(pmax * 1.3) : 0;
let lista = filas.filter(r => encaja(r, tope));
let sinTope = false;
if (!lista.length && pmax) {
  lista = filas.filter(r => encaja(r, 0));
  sinTope = lista.length > 0;
}
if (pmax && !sinTope && lista.length && lista.length < 3) {
  const ya = new Set(lista.map(r => r.ref));
  lista = lista.concat(filas.filter(r => !ya.has(r.ref) && encaja(r, pmax * 2))
    .sort((a, b) => a.precio - b.precio).slice(0, 3 - lista.length));
}
for (const r of lista) r.encima = !!pmax && r.precio > pmax;

if (lista.length === 0) {
  let texto = 'No he encontrado inmuebles con esos criterios de búsqueda.';
  if (modalidad) {
    const otra = modalidad === 'temporal' ? 'larga_duracion' : 'temporal';
    const otras = filas.filter(r => encaja(r, 0, false) && r.modalidad === otra);
    texto = `No hay ningún ${MODALIDAD_HABLADA[modalidad].split(',')[0]} con esos criterios.` + (otras.length
      ? ` Sí hay ${otras.length} de ${MODALIDAD_HABLADA[otra]}: díselo por si le interesa, dejando claro que no es lo que busca.`
      : '');
  }
  return [{ json: { result: texto + ' No inventes inmuebles: ofrécele cambiar el municipio o las habitaciones, o que la asesora le avise si entra algo.' } }];
}

// Orden: con presupuesto, primero los que caben y luego lo mas cercano a lo que
// dijo; sin presupuesto, de menor a mayor precio. Los que no tienen precio, al final.
const distancia = (r) => r.precio ? Math.abs(r.precio - pmax) : Infinity;
const ordenados = [...lista].sort((a, b) => pmax
  ? (a.encima - b.encima) || (distancia(a) - distancia(b))
  : (a.precio || Infinity) - (b.precio || Infinity));

// devuelve solo los 5 primeros inmuebles
const limitados = ordenados.slice(0, 5);

const opciones = limitados.map((d, i) => {
  const alquiler = d.operacion.includes('alquil');
  const precio = d.precio ? `${Number(d.precio).toLocaleString('es-ES')}€${alquiler ? ' al mes' : ''}` : 'precio a consultar';
  const habs = d.habitaciones ? `${d.habitaciones} habitaciones` : '';
  const ban = d.banos ? `${d.banos} baños` : '';
  const sup = d.superficie && d.superficie > 0 ? `${d.superficie}m²` : '';
  const zona = d.zona ? ` en ${d.zona}` : '';
  const detalles = [habs, ban, sup].filter(Boolean).join(', ');
  const tipo = alquiler && MODALIDAD_HABLADA[d.modalidad] ? `, ${MODALIDAD_HABLADA[d.modalidad]}` : '';
  const encima = d.encima ? ' POR ENCIMA DE SU PRESUPUESTO.' : '';
  const caract = d.caracteristicas ? `Características: ${d.caracteristicas}.` : '';
  const desc = d.descripcion
    ? `Descripción: ${String(d.descripcion).replace(/\\r\\n|\\r|\\n|\r\n|\r|\n/g, ' ').trim()}.`
    : '';
  return `Opción ${i+1}: ${d.tipo_inmueble}${zona}${tipo}, referencia ${d.ref}, ${detalles}, ${precio}.${encima} ${caract} ${desc}`;
}).join(' | ');

const total = lista.length > 5
  ? ` He encontrado ${lista.length} en total y te muestro ${pmax ? 'los 5 que mejor encajan con su presupuesto' : 'los 5 más económicos, ordenados de menor a mayor precio'}.`
  : '';
const avisos = (sinTope
  ? ` No hay nada por debajo de ${pmax}€; estos son los más económicos que hay: díselo con el precio.` : '')
  + (!sinTope && lista.some(r => r.encima)
  ? ` Los marcados POR ENCIMA DE SU PRESUPUESTO se pasan de los ${pmax}€ que dijo: preséntalos igualmente diciendo el precio.` : '');

return [{ json: { result: `He encontrado ${lista.length} inmueble${lista.length !== 1 ? 's' : ''}.${total}${avisos} ${opciones}` } }];
