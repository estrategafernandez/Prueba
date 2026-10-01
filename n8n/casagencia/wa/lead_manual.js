// [WA] 9 · Lead a mano · PrepararLead
// Da de alta un lead y le manda la bienvenida igual que si hubiera llegado por
// correo de un portal. Sirve para leads que entran por telefono o en persona,
// y para hacer pruebas con un numero propio.
//   POST /webhook/wa-lead-manual   (cabecera con la clave de la credencial)
//   { "telefono": "+34...", "nombre": "Ana", "referencia": "BN-1528-V",
//     "enlace": "https://www.casagencia.com/inmueble/...", "reiniciar": false }
const b = $input.first().json.body ?? {};
const tel = normalizarTelefono(b.telefono);
const referencia = String(b.referencia ?? '').toUpperCase().trim();
const alquiler = esAlquiler(referencia, b.operacion);
const r = resolverAsesora(referencia);
const plantilla = alquiler ? PLANTILLAS.alquiler : PLANTILLAS.compra;
const nombre = String(b.nombre ?? '').trim();
const enlace = String(b.enlace ?? '').trim();

const errores = [];
if (!tel.valido) errores.push('telefono no valido');
if (!referencia) errores.push('falta la referencia del inmueble');
if (enlace && !/^https?:\/\/\S+$/.test(enlace)) errores.push('el enlace no es una URL');

return [{ json: {
  valido: errores.length === 0,
  error: errores.join('; '),
  telefono_wa: tel.wa_id,
  telefono_e164: tel.e164,
  referencia,
  nombre,
  email_cliente: '',
  portal: String(b.portal ?? 'A mano'),
  operacion: alquiler ? 'alquiler' : 'venta',
  es_alquiler: alquiler,
  asesora: r.destinatario,
  asunto: 'Lead dado de alta a mano',
  enlace,
  plantilla: plantilla.nombre,
  param1: nombre.split(' ')[0] || '\u{1F44B}',
  param2: enlace || `ref. ${referencia}`,
  // true = empezar de cero: borra la memoria de la conversacion anterior
  reiniciar: b.reiniciar === true || String(b.reiniciar).toLowerCase() === 'true',
} }];
