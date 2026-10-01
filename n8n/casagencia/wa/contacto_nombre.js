// [WA][SUB] ConversacionDelContacto · ¿PonerNombre?
// Si el contacto del panel no tiene nombre (o su "nombre" es el telefono) y
// ahora lo sabemos, se le pone. Un nombre que ya tiene no se toca nunca.
const norm = $('Normalizar').first().json;
const c = ($('ElegirContacto').first().json.payload || [])[0] || {};
const actual = String(c.name ?? '').trim();
const sinNombre = !actual || /^[+\d\s()-]+$/.test(actual);
return [{ json: {
  contacto_id: Number(c.id || 0),
  poner_nombre: sinNombre && !!norm.nombre,
  nombre: norm.nombre,
} }];
