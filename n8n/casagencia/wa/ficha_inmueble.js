// [WA][SUB] buscarPorReferencia · FichaCompleta
// Devuelve TODO lo que sabemos del inmueble, para que Sara pueda resolver
// cualquier duda sin inventar: precio, superficie, habitaciones, banos,
// caracteristicas, direccion (si la agencia la ha puesto) y la descripcion
// entera del anuncio.
const pedido = String($('Start').first().json.referencia ?? '').trim();
const filas = leerCartera('LeerCartera');
const dirs = leerDirecciones('LeerDirecciones');
const salida = (texto, extra = {}) => [{ json: { respuesta: texto, ...extra } }];

// Sin cartera no es que la referencia no exista: es una incidencia.
if (!filas.length) {
  return salida('No he podido consultar la cartera por un problema tecnico. NO le digas al cliente que ' +
    'el inmueble no existe: dile que lo compruebas con la asesora y usa avisarEquipo.', { encontrado: false });
}
if (!pedido) {
  return salida('No me has pasado ninguna referencia. Si la tienes en los datos del cliente, usala.', { encontrado: false });
}

const { filas: encontradas, parecidas } = buscarReferencia(filas, pedido);

if (!encontradas.length) {
  if (parecidas.length) {
    return salida(`No localizo ${pedido}. En la cartera hay referencias parecidas: ${parecidas.join(', ')}. ` +
      'Pregunta al cliente si puede ser alguna de esas.', { encontrado: false, parecidas });
  }
  return salida(`No localizo la referencia ${pedido} en la cartera actual. Puede que ya se haya vendido o ` +
    'alquilado y siga publicada en el portal. No digas que no existe: diselo con tacto, ofrecele ' +
    'inmuebles parecidos con recomendarSimilares o buscarInmuebles, o avisa al equipo.', { encontrado: false });
}

const ficha = (r) => {
  const dir = dirs[r.ref.toUpperCase()];
  const lineas = [
    `Referencia: ${r.ref}`,
    `Operacion: ${r.operacion === 'alquiler' ? 'ALQUILER (no se agenda: se cualifica y se pasa al equipo)' : 'VENTA'}`,
    `Tipo: ${r.tipo}`,
    `Municipio: ${municipioCorto(r.municipio)}`,
    r.zona ? `Zona: ${r.zona}` : '',
    `Direccion: ${dir || 'no consta (no la deduzcas; si la pide, ofrece que se la confirme la asesora)'}`,
    `Precio: ${euros(r.precio, r.operacion)}`,
    r.superficie ? `Superficie: ${r.superficie} m²` : '',
    r.habitaciones ? `Habitaciones: ${r.habitaciones}` : '',
    r.banos ? `Baños: ${r.banos}` : '',
    r.caracteristicas ? `Caracteristicas: ${r.caracteristicas}` : '',
    r.descripcion ? `Descripcion del anuncio: ${r.descripcion}` : '',
    `Asesora: ${resolverAsesora(r.ref, r.municipio).destinatario}`,
  ].filter(Boolean);
  return lineas.join('\n');
};

if (encontradas.length === 1) {
  const r = encontradas[0];
  return salida('Ficha del inmueble (datos reales de la cartera; lo que no este aqui, no lo sabes):\n' + ficha(r),
    { encontrado: true, referencia: r.ref, operacion: r.operacion });
}

// Varias con el mismo numero: que el cliente diga cual
return salida(`Hay ${encontradas.length} inmuebles que encajan con ${pedido}. Preguntale al cliente algun ` +
  'detalle que los distinga:\n' + encontradas.slice(0, 3).map(r => '- ' + tarjeta(r, dirs)).join('\n'),
  { encontrado: true, varios: true });
