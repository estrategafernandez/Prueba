// BuscarPorDireccion · EmparejarDireccion
// El feed XML de Janela NO trae la calle: solo municipio, zona, CP y coordenadas.
// Por eso se puntua contra todo el texto disponible del inmueble. Si algun dia
// se anade una columna "direccion" a la hoja, se usa automaticamente y con el
// peso mas alto, sin tocar este codigo.
const body = ($('Webhook').first().json.body) ?? {};
const consulta = String(body.direccion ?? '').trim();
const municipioPedido = String(body.municipio ?? '').trim();
const operacionPedida = String(body.operacion ?? '').trim().toLowerCase();

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Palabras que no distinguen un inmueble de otro
const RUIDO = new Set([
  'calle', 'c', 'carrer', 'avenida', 'avda', 'av', 'avinguda', 'plaza', 'placa',
  'pza', 'paseo', 'passeig', 'ronda', 'camino', 'cami', 'travesia', 'urbanizacion',
  'urb', 'partida', 'poligono', 'numero', 'num', 'n', 'piso', 'puerta', 'pta',
  'escalera', 'esc', 'bajo', 'sn', 'de', 'del', 'la', 'el', 'los', 'las', 'en',
  'y', 'con', 'a', 'al', 'es', 'esta', 'un', 'una', 'mi', 'su'
]);

const tokens = norm(consulta).split(' ').filter(t => t && !RUIDO.has(t));
const palabras = tokens.filter(t => /[a-z]/.test(t) && t.length >= 3);
const numeros = tokens.filter(t => /^\d+$/.test(t));

if (!palabras.length && !numeros.length) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'consulta_vacia',
    mensaje_para_sara: 'No he entendido la direccion. Pidele al cliente que repita la calle.'
  } } }];
}

const filas = $input.all().map(i => i.json).filter(r => r && r.ref);

const puntuar = (r) => {
  const campos = [
    [norm(r.direccion), 6],   // columna opcional, rellenada a mano por la agencia
    [norm(r.zona), 3],
    [norm(r.descripcion), 3],
    [norm(r.municipio), 1]
  ];
  let total = 0;
  const casan = [];
  for (const p of palabras) {
    for (const [texto, peso] of campos) {
      if (texto && texto.includes(p)) { total += peso; casan.push(p); break; }
    }
  }
  // el numero de portal solo suma si ya ha casado alguna palabra
  if (casan.length) {
    for (const n of numeros) {
      for (const [texto, peso] of campos) {
        if (texto && new RegExp(`\\b${n}\\b`).test(texto)) { total += Math.min(peso, 3); break; }
      }
    }
  }
  return { total, casan: [...new Set(casan)] };
};

let candidatos = filas.map(r => ({ r, ...puntuar(r) }));

if (municipioPedido) {
  const m = norm(municipioPedido);
  const conMun = candidatos.filter(c => norm(c.r.municipio).includes(m) || m.includes(norm(c.r.municipio)));
  if (conMun.length) candidatos = conMun;
}
if (operacionPedida) {
  const conOp = candidatos.filter(c => norm(c.r.tipo_transaccion).includes(norm(operacionPedida)));
  if (conOp.length) candidatos = conOp;
}

// Hace falta que case al menos una palabra distintiva en un campo con peso:
// coincidir solo con el municipio (peso 1) no vale. Es preferible decir
// "no lo localizo" que soltarle al cliente un listado generico.
const MIN = 3;
candidatos = candidatos.filter(c => c.casan.length > 0 && c.total >= MIN)
  .sort((a, b) => b.total - a.total);

// Consulta demasiado vaga ("playa", "centro"): media cartera encaja. Antes que
// leer un listado, se pide la referencia.
if (candidatos.length > 8 && candidatos[0].total <= MIN) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'demasiado_generico',
    mensaje_para_sara: 'Con esa direccion me encajan demasiados inmuebles. Pidele la calle exacta con el numero. Si todavia no le has preguntado por la referencia del anuncio, pidesela tambien; si ya te ha dicho que no la tiene, no insistas. NO le leas un listado.'
  } } }];
}

candidatos = candidatos.slice(0, 3);

if (!candidatos.length) {
  return [{ json: { respuesta: {
    encontrado: false, motivo: 'sin_coincidencias',
    mensaje_para_sara: 'No localizo ningun inmueble por esa direccion. Dile al cliente que por la calle no te aparece. Si todavia no le has preguntado por la referencia del anuncio, pidesela ahora; si ya te ha dicho que no la tiene, NO se la vuelvas a pedir: ofrecele buscar por municipio y caracteristicas, o registrar un mensaje para que la asesora localice el inmueble y le llame. NO le leas un listado de inmuebles que no ha pedido.'
  } } }];
}

const fmt = (c) => {
  const r = c.r;
  const precio = r.precio ? `${Number(r.precio).toLocaleString('es-ES')} euros` : 'precio a consultar';
  return `${r.tipo_inmueble || 'Inmueble'} en ${r.zona || r.municipio}, referencia ${r.ref}, ` +
         `${r.habitaciones || '?'} habitaciones, ${precio} (${r.tipo_transaccion})`;
};

const fiable = candidatos[0].total >= 6 && candidatos.length === 1;

return [{ json: { respuesta: {
  encontrado: true,
  fiabilidad: fiable ? 'alta' : 'media',
  coincidencias: candidatos.map(c => ({
    ref: c.r.ref, municipio: c.r.municipio, zona: c.r.zona,
    tipo: c.r.tipo_inmueble, precio: c.r.precio,
    operacion: c.r.tipo_transaccion, habitaciones: c.r.habitaciones,
    puntuacion: c.total
  })),
  mensaje_para_sara: fiable
    ? `Creo que es este: ${fmt(candidatos[0])}. Confirmaselo al cliente antes de seguir.`
    : `Por esa direccion me encajan estos, pero no es seguro: ${candidatos.map(fmt).join(' | ')}. Preguntale al cliente cual es el suyo antes de dar nada por hecho.`
} } }];
