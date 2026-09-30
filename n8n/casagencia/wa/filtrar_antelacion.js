// [WA][SUB] BuscarDisponibilidadCalendario · FiltrarAntelacion
// Si hay antelacion minima configurada, se quitan de las alternativas las horas
// que no la cumplen. Con ANTELACION_MINIMA_HORAS = 0 no hace nada.
const r = $input.first().json.respuesta ?? {};
if (ANTELACION_MINIMA_HORAS <= 0 || !Array.isArray(r.alternativas)) return [{ json: { respuesta: r } }];

const limite = DateTime.now().setZone(ZONA).plus({ hours: ANTELACION_MINIMA_HORAS });
const validas = r.alternativas.filter(a =>
  DateTime.fromFormat(`${a.fecha} ${a.hora}`, 'yyyy-MM-dd HH:mm', { zone: ZONA }) >= limite);

const listado = validas.map(a => `${a.dia} a las ${a.hora}`).join('; ');
return [{ json: { respuesta: {
  ...r,
  alternativas: validas,
  mensaje_para_sara: validas.length
    ? `No puede ser a esa hora. Ofrecele SOLO estas opciones: ${listado}. No inventes otras.`
    : 'No quedan huecos que cumplan la antelacion minima en los proximos dias. Pidele otro dia mas adelante.',
} } }];
