// [TEL] Cartera (cacheo) · FilasParaLaHoja
// Las mismas filas que guarda WhatsApp en wa_cartera, con las columnas y el
// orden que espera la hoja "Inmuebles" del telefono.
// La hoja ya se ha vaciado (ComprobarCartera lo ha autorizado antes)
const j = $('Mapear').first().json;
return (j.filas || []).map(f => ({ json: {
  ref: f.ref,
  precio: f.precio,
  tipo_transaccion: f.tipo_transaccion,
  tipo_inmueble: f.tipo_inmueble,
  municipio: f.municipio,
  zona: f.zona,
  habitaciones: f.habitaciones,
  banos: f.banos,
  superficie: f.superficie,
  caracteristicas: f.caracteristicas,
  descripcion: f.descripcion,
  imagen: f.imagen,
  latitud: f.latitud,
  longitud: f.longitud,
} }));
