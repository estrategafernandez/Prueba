// [TEL] Cartera (cacheo) · DireccionesQueFaltan
// La pestana "Direcciones" es de donde sacan la calle TODAS las busquedas
// (telefono y WhatsApp) y Sara cuando le piden la direccion. Se cargo una vez
// desde el CRM (origen "eGO CRM") y los inmuebles que entraron despues no
// tenian calle: por eso la llamada del 2-11 no encontro el bajo de la calle
// Peniscola 3 (CS-G-406-V) aunque estaba en eGO.
// Ahora, cada hora, se completa con la calle que da la API de eGO:
//   - el inmueble que no esta en la pestana, o esta sin calle -> se pone;
//   - el que puso este nodo (origen "eGO API") y eGO lo ha cambiado -> se corrige;
//   - lo demas (lo cargado del CRM y lo puesto a mano) NO se toca nunca.
// Las filas de inmuebles que ya no estan se dejan: no estorban (las busquedas
// solo miran la cartera disponible) y valen si el inmueble vuelve.
// Si no se ha podido leer la pestana, no se escribe nada: escribir a ciegas
// podria pisar lo que hay.
const ORIGEN = 'eGO API';

const leidas = $('LeerDirecciones').all().map(i => (i && i.json) || {});
if (leidas.some(j => j.error)) return [];

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const enLaHoja = {};
for (const j of leidas) {
  const ref = String(j.ref ?? '').trim().toUpperCase();
  if (ref && !enLaHoja[ref]) enLaHoja[ref] = j;
}

const salida = [];
for (const f of ($('Mapear').first().json.filas || [])) {
  const ref = String(f.ref ?? '').trim();
  if (!ref || !String(f.direccion ?? '').trim()) continue;
  const ya = enLaHoja[ref.toUpperCase()];
  const falta = !ya || !String(ya.direccion ?? '').trim();
  const cambiada = ya && String(ya.origen ?? '').trim() === ORIGEN && norm(ya.direccion) !== norm(f.direccion);
  if (!falta && !cambiada) continue;
  salida.push({ json: {
    ref,
    direccion: f.direccion,
    numero: f.numero ?? '',
    cp: f.cp ?? '',
    origen: ORIGEN,
    municipio: String(f.municipio ?? '').split(' / ')[0],
    zona: f.zona ?? '',
    tipo: f.tipo_inmueble ?? '',
    operacion: f.tipo_transaccion ?? '',
    precio: f.precio ?? '',
  } });
}
return salida;
