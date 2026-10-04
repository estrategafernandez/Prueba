// [WA][SUB] recomendarSimilares · Puntuar
// Dado un inmueble, busca en la cartera los que mas se le parecen: misma
// operacion, mismo municipio y zona, mismo tipo, habitaciones parecidas y un
// precio en la misma horquilla. Sirve para ofrecer alternativas cuando el que
// pidio no le convence, ya no esta o no cuadra la visita.
const q = $('Start').first().json || {};
const filas = leerCartera('LeerCartera');
const dirs = leerDirecciones('LeerDirecciones');
const salida = (texto, extra = {}) => [{ json: { respuesta: texto, ...extra } }];

if (!filas.length) {
  return salida('No he podido consultar la cartera por un problema tecnico. No inventes alternativas.', { total: 0 });
}

const { filas: encontradas } = buscarReferencia(filas, q.referencia);
let base = encontradas[0];
// Si ya no esta en la cartera (vendido, reservado, retirado: la web ya no lo
// publica), se compara por lo que dice su referencia: la operacion (-V venta,
// -A alquiler) y el municipio de los de su mismo prefijo (BN, OR, CS, VR...).
let porReferencia = false;
if (!base) {
  const ref = String(q.referencia ?? '').toUpperCase().trim();
  const pre = prefijoDeReferencia(ref);
  const op = /-A$/.test(ref) ? 'alquiler' : /-V$/.test(ref) ? 'venta' : '';
  const hermanos = filas.filter(r => pre && prefijoDeReferencia(r.ref) === pre && (!op || r.operacion === op));
  if (hermanos.length) {
    const cuenta = {};
    for (const r of hermanos) cuenta[r.municipio] = (cuenta[r.municipio] || 0) + 1;
    base = { ref, operacion: op || hermanos[0].operacion, municipio: Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0],
             zona: '', tipo: '', habitaciones: 0, precio: 0 };
    porReferencia = true;
  }
}
if (!base) {
  return salida(`No encuentro ${q.referencia || 'esa referencia'} en la cartera para comparar. Si sabes lo que ` +
    'busca el cliente, usa buscarInmuebles con sus criterios.', { total: 0 });
}
const excluir = new Set([base.ref.toUpperCase(),
  ...String(q.excluir ?? '').toUpperCase().split(/[,;\s]+/).filter(Boolean)]);
const limite = Math.min(Math.max(Math.round(aNumero(q.limite)) || 3, 1), 5);
// "Algo parecido pero mas barato": precio_max. Con limite de precio, el precio ya
// no puntua por parecido (lo que quiere es otra horquilla).
const pmax = aNumero(q.precio_max);
const pmin = aNumero(q.precio_min);

const puntos = (r) => {
  let p = 0;
  if (r.municipio === base.municipio) p += 3;
  if (base.zona && sinAcentos(r.zona) === sinAcentos(base.zona)) p += 3;
  if (casaTipo(base.tipo, r.tipo)) p += 2;
  if (base.habitaciones && Math.abs(r.habitaciones - base.habitaciones) <= 1) p += 2;
  if (!pmax && !pmin && base.precio && r.precio && Math.abs(r.precio - base.precio) / base.precio <= 0.25) p += 3;
  return p;
};

const candidatos = filas
  .filter(r => r.operacion === base.operacion && !excluir.has(r.ref.toUpperCase()))
  .filter(r => (!pmax || (r.precio && r.precio <= pmax)) && (!pmin || r.precio >= pmin))
  .map(r => ({ r, p: puntos(r) }))
  .filter(x => x.p >= 3)
  .sort((a, b) => (b.p - a.p) || (pmax ? b.r.precio - a.r.precio
    : Math.abs(a.r.precio - base.precio) - Math.abs(b.r.precio - base.precio)))
  .slice(0, limite);

if (!candidatos.length) {
  return salida('No hay en cartera nada suficientemente parecido' + (pmax ? ` por debajo de ${euros(pmax, base.operacion)}` : '') +
    '. Diselo con naturalidad y ofrecele buscar con otros criterios o que el equipo le avise si entra algo.', { total: 0 });
}

return salida((porReferencia
  ? `${base.ref} ya no esta en la cartera. Estos son de ${base.operacion} en ${municipioCorto(base.municipio)}, `
    + 'su misma zona; si quiere afinar (precio, habitaciones), usa buscarInmuebles con lo que te diga. '
  : `Parecidos a ${base.ref} (${base.tipo}, ${municipioCorto(base.municipio)}, ${euros(base.precio, base.operacion)}), `) +
  'de mas a menos parecido. Ensenale como mucho 3, breve. Las referencias entre corchetes son internas.\n'
  + candidatos.map(x => '- ' + tarjeta(x.r, dirs)).join('\n'),
  { total: candidatos.length, referencias: candidatos.map(x => x.r.ref) });
