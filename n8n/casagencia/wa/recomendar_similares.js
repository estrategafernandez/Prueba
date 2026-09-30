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
if (!encontradas.length) {
  return salida(`No encuentro ${q.referencia || 'esa referencia'} en la cartera para comparar. Si sabes lo que ` +
    'busca el cliente, usa buscarInmuebles con sus criterios.', { total: 0 });
}
const base = encontradas[0];
const excluir = new Set([base.ref.toUpperCase(),
  ...String(q.excluir ?? '').toUpperCase().split(/[,;\s]+/).filter(Boolean)]);
const limite = Math.min(Math.max(Math.round(aNumero(q.limite)) || 3, 1), 5);

const puntos = (r) => {
  let p = 0;
  if (r.municipio === base.municipio) p += 3;
  if (base.zona && sinAcentos(r.zona) === sinAcentos(base.zona)) p += 3;
  if (casaTipo(base.tipo, r.tipo)) p += 2;
  if (base.habitaciones && Math.abs(r.habitaciones - base.habitaciones) <= 1) p += 2;
  if (base.precio && r.precio && Math.abs(r.precio - base.precio) / base.precio <= 0.25) p += 3;
  return p;
};

const candidatos = filas
  .filter(r => r.operacion === base.operacion && !excluir.has(r.ref.toUpperCase()))
  .map(r => ({ r, p: puntos(r) }))
  .filter(x => x.p >= 3)
  .sort((a, b) => (b.p - a.p) || (Math.abs(a.r.precio - base.precio) - Math.abs(b.r.precio - base.precio)))
  .slice(0, limite);

if (!candidatos.length) {
  return salida('No hay en cartera nada suficientemente parecido. Diselo con naturalidad y ofrecele buscar ' +
    'con otros criterios o que el equipo le avise si entra algo.', { total: 0 });
}

return salida(`Parecidos a ${base.ref} (${base.tipo}, ${municipioCorto(base.municipio)}, ${euros(base.precio, base.operacion)}), ` +
  'de mas a menos parecido. Ensenale como mucho 3, breve. Las referencias entre corchetes son internas.\n'
  + candidatos.map(x => '- ' + tarjeta(x.r, dirs)).join('\n'),
  { total: candidatos.length, referencias: candidatos.map(x => x.r.ref) });
