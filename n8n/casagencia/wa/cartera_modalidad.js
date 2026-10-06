// [WA] 4 · Cartera desde eGO · Modalidad
// Cada alquiler, de LARGA DURACION o TEMPORAL. El feed no lo dice; eGO si: el
// tipo de negocio de cada inmueble disponible (2 = alquiler, 13 = alquiler
// temporal), en una sola llamada (ListRealestateByPage). Si eGO no contesta, se
// deduce de la descripcion ("alquiler anual", "temporada de septiembre a junio"...).
const filas = $('Mapear').first().json.filas || [];
let lista = [];
try {
  const d = $('NegociosEgo').first().json.datos || {};
  lista = d.realestatesByPageDto || [];
} catch (e) { lista = []; }
const NEGOCIO = { 2: 'larga_duracion', 13: 'temporal' };
const porRef = {};
for (const x of lista) {
  const negocio = Number(((x.businesses || [])[0] || {}).businessTypeId || 0);
  if (x.reference && NEGOCIO[negocio]) porRef[String(x.reference).toUpperCase().trim()] = NEGOCIO[negocio];
}
const conModalidad = filas.map(f => ({
  ...f,
  modalidad: /alquil/i.test(String(f.tipo_transaccion ?? ''))
    ? (porRef[String(f.ref).toUpperCase().trim()] || modalidadAlquiler('', f.descripcion)) : '',
}));
return [{ json: { filas: conModalidad, de_ego: Object.keys(porRef).length } }];
