// Pruebas de la logica del asistente de WhatsApp.
//   node tests_whatsapp.js
const fs = require('fs');
const B = '/home/user/Prueba/n8n/casagencia/wa/';
const CFG = fs.readFileSync(B + 'config.js', 'utf8');

function run(f, $input, $) {
  return Function('$input', '$', 'Buffer', '"use strict";' + CFG + '\n'
    + fs.readFileSync(B + f, 'utf8'))($input, $, Buffer);
}
const inp = a => ({ first: () => a[0], all: () => a });
const nod = m => n => ({ first: () => ({ json: m[n] }), item: { json: m[n] },
                         all: () => [{ json: m[n] }] });
let fallos = 0;
const ck = (n, c, e = '') => {
  console.log((c ? '  OK   ' : '  FALLA') + '  ' + n + (e ? '  -> ' + e : ''));
  if (!c) fallos++;
};

// ---------------------------------------------------------------------------
console.log('== Los correos de los portales ==');

const correos = [
  ['Idealista, alquiler', {
    subject: 'Tienes un nuevo contacto para tu anuncio CS-1479-A',
    from: { value: [{ address: 'no-reply@contacto.idealista.com' }] },
    text: 'Hola, un usuario esta interesado en tu inmueble.\n'
        + 'Nombre: Ana Belen Marti\nTelefono: 600 11 22 33\n'
        + 'Email: ana.marti@gmail.com\nReferencia: CS-1479-A\n'
        + 'Mensaje: me gustaria ver el piso de alquiler.',
  }, { portal: 'Idealista', telefono_e164: '+34600112233', nombre: 'Ana Belen Marti',
       referencia: 'CS-1479-A', es_alquiler: true, asesora: 'Gisela' }],

  ['Fotocasa, venta', {
    subject: 'Nueva peticion de informacion - Fotocasa',
    from: { text: 'avisos@fotocasa.es' },
    text: 'Contacto: Jose Luis Ferrer  Movil: +34 666777888  '
        + 'Ref: BN-1547-V  Quiere comprar y pide visita.',
  }, { portal: 'Fotocasa', telefono_e164: '+34666777888', referencia: 'BN-1547-V',
       es_alquiler: false, asesora: 'Carmen' }],

  ['Habitaclia sin referencia', {
    subject: 'Solicitud de informacion habitaclia',
    from: { text: 'info@habitaclia.com' },
    text: 'Nombre: Marta Sanz\nTelefono: 0034 712 345 678\nBusca piso en alquiler.',
  }, { portal: 'Habitaclia', telefono_e164: '+34712345678', referencia: '',
       es_alquiler: true, asesora: '' }],

  ['Correo sin telefono', {
    subject: 'Contacto web casagencia',
    from: { text: 'web@casagencia.com' },
    text: 'Nombre: Pedro Gil\nEmail: pedro@gmail.com\nRef: OR-1313-V',
  }, { portal: 'Web', telefono_e164: '', se_puede_contactar: false,
       referencia: 'OR-1313-V', asesora: 'Carmen' }],

  ['Cuerpo solo en HTML', {
    headers: { subject: 'Nuevo lead idealista', from: 'robot@idealista.com' },
    html: '<p>Nombre: <b>Luisa Pons</b></p><p>Telefono: 611223344</p>'
        + '<p>Referencia: VR-980-A</p>',
  }, { portal: 'Idealista', telefono_e164: '+34611223344', referencia: 'VR-980-A',
       es_alquiler: true, asesora: 'Gisela' }],
];

for (const [titulo, correo, esperado] of correos) {
  const r = run('parsear_email.js', inp([{ json: correo }]))[0].json;
  for (const [k, v] of Object.entries(esperado)) {
    ck(`${titulo} · ${k}`, r[k] === v, `${JSON.stringify(r[k])} (esperaba ${JSON.stringify(v)})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n== En alquiler no se agenda ==');
for (const [ref, tipo, debeBloquear] of [
    ['CS-1479-A', 'alquiler', true], ['CS-1479-A', '', true],
    ['BN-1541-V', 'alquiler', true], ['BN-1547-V', 'compra', false],
    ['OR-1313-V', 'venta', false]]) {
  const r = run('guardia_alquiler.js', inp([{ json: {
    referencia: ref, tipo_transaccion: tipo, telefono: '+34600112233',
    fecha: '2026-10-14', hora: '17:00' } }]))[0].json;
  ck(`guardia ${ref} (${tipo || 'sin tipo'})`, r.seguir === !debeBloquear,
     r.seguir ? 'deja pasar' : 'bloquea');
  if (debeBloquear) ck(`  y le dice que llama la asesora`, /asesora/i.test(r.respuesta));
}

// ---------------------------------------------------------------------------
console.log('\n== Cuando el bot NO debe contestar ==');
const convBase = {
  id: 77, status: 'open', labels: [], custom_attributes: { bot: 'On' },
  meta: { sender: { id: 5, name: 'Ana', phone_number: '+34600112233' } },
};
const casos = [
  ['mensaje normal del cliente', { event: 'message_created', message_type: 'incoming',
    content: 'hola', conversation: convBase, sender: convBase.meta.sender }, true],
  ['lo escribe la agencia', { event: 'message_created', message_type: 'outgoing',
    content: 'hola', conversation: convBase, sender: convBase.meta.sender }, false],
  ['audio sin texto', { event: 'message_created', message_type: 'incoming',
    content: '', conversation: convBase, sender: convBase.meta.sender }, false],
  ['conversacion resuelta', { event: 'message_created', message_type: 'incoming',
    content: 'hola', conversation: { ...convBase, status: 'resolved' },
    sender: convBase.meta.sender }, false],
  ['etiqueta intervenir', { event: 'message_created', message_type: 'incoming',
    content: 'hola', conversation: { ...convBase, labels: ['intervenir'] },
    sender: convBase.meta.sender }, false],
  ['atributo bot en Off', { event: 'message_created', message_type: 'incoming',
    content: 'hola', conversation: { ...convBase, custom_attributes: { bot: 'Off' } },
    sender: convBase.meta.sender }, false],
  ['telefono imposible', { event: 'message_created', message_type: 'incoming',
    content: 'hola', conversation: { ...convBase, meta: { sender: { phone_number: '123' } } },
    sender: { phone_number: '123' } }, false],
];
for (const [titulo, body, debeContestar] of casos) {
  const r = run('asistente_entrada.js', inp([{ json: { body } }]))[0].json;
  ck(titulo, r.contestar === debeContestar, r.motivos.join(',') || 'contesta');
}

console.log('\n-- y con la otra forma de payload de Chatwoot (agent bot) --');
const formaB = {
  event: 'message_created', id: 77, status: 'open', labels: [],
  custom_attributes: { bot: 'On' },
  meta: { sender: { id: 5, name: 'Ana', phone_number: '+34600112233' } },
  messages: [{ content: 'buenas', message_type: 0, conversation_id: 77 }],
};
let r = run('asistente_entrada.js', inp([{ json: { body: formaB } }]))[0].json;
ck('contesta igual', r.contestar === true, r.motivos.join(','));
ck('coge el telefono', r.telefono_e164 === '+34600112233', r.telefono_e164);
ck('coge la conversacion', r.conversacion_id === 77, String(r.conversacion_id));
ck('la clave de Redis va por telefono', r.clave_buffer === 'wa:buffer:34600112233',
   r.clave_buffer);

// ---------------------------------------------------------------------------
console.log('\n== Juntar los mensajes seguidos ==');
const entrada = { telefono_e164: '+34600112233', telefono_wa: '34600112233',
                  nombre: 'Ana', contenido: 'el de la calle Maestro Falla',
                  conversacion_id: 77, contacto_id: 5, cuenta_id: 1,
                  clave_buffer: 'wa:buffer:34600112233' };
// Redis apila con LPUSH: el mas nuevo primero
r = run('asistente_juntar.js', inp([{}]), nod({
  EntradaMensaje: entrada,
  LeerBuffer: { message: ['el de la calle Maestro Falla', 'queria ver un piso', 'hola'] },
}))[0].json;
ck('los pone en el orden en que los escribio',
   r.mensaje === 'hola\nqueria ver un piso\nel de la calle Maestro Falla', JSON.stringify(r.mensaje));
ck('cuenta los tres', r.numero_de_mensajes === 3, String(r.numero_de_mensajes));

r = run('asistente_juntar.js', inp([{}]), nod({
  EntradaMensaje: entrada, LeerBuffer: { message: [] },
}))[0].json;
ck('si Redis viene vacio usa el mensaje que llego', r.mensaje === entrada.contenido, r.mensaje);

r = run('asistente_juntar.js', inp([{}]), nod({
  EntradaMensaje: entrada, LeerBuffer: { message: 'hola' },
}))[0].json;
ck('aguanta un solo mensaje sin array', r.mensaje === 'hola', r.mensaje);

// ---------------------------------------------------------------------------
console.log('\n== Partir la respuesta en mensajes de WhatsApp ==');
const largo = 'Buenas tardes Ana. ' + 'El piso tiene tres habitaciones y dos banos. '.repeat(12);
let partes = run('asistente_dividir.js', inp([{ json: { output: largo } }])).map(x => x.json);
ck('no pasa de cinco mensajes', partes.length <= 5, String(partes.length));
ck('ninguno se pasa de 320 salvo el ultimo agrupado',
   partes.slice(0, -1).every(p => p.mensaje.length <= 320),
   partes.map(p => p.mensaje.length).join(','));
ck('el primero sale sin espera', partes[0].espera_segundos === 0);
ck('los siguientes esperan algo', partes.slice(1).every(p => p.espera_segundos > 0));

partes = run('asistente_dividir.js', inp([{ json: {
  output: 'Hola Ana.\n\n¿Para cuantas personas seria la vivienda?' } }])).map(x => x.json);
ck('respeta los parrafos', partes.length === 2, String(partes.length));
ck('no corta la pregunta', partes[1].mensaje.endsWith('?'), partes[1].mensaje);

// ---------------------------------------------------------------------------
console.log('\n== Lo que el agente sabe antes de escribir ==');
const junto = { telefono_e164: '+34600112233', telefono_wa: '34600112233', nombre: 'Ana',
                conversacion_id: 77, contacto_id: 5, cuenta_id: 1, mensaje: 'hola' };
r = run('asistente_contexto.js', inp([{ json: {
  telefono_wa: '34600112233', nombre: 'Ana Belen', referencia: 'CS-1479-A',
  operacion: 'alquiler', es_alquiler: true, asesora: 'Gisela', portal: 'Idealista',
  estado: 'plantilla_enviada', q_personas: '3', q_ingresos: '', q_mascotas: '',
  q_entrada: '', q_duracion: '' } }]), nod({ JuntarMensajes: junto }))[0].json;
ck('sabe que es alquiler', r.es_alquiler === true);
ck('sabe la asesora', r.asesora === 'Gisela', r.asesora);
ck('avisa de que no se agenda', /no se agenda/i.test(r.contexto));
ck('no repite lo ya contestado', !r.preguntas_pendientes.includes('personas que van a vivir'),
   r.preguntas_pendientes.join(','));
ck('sabe lo que le falta', r.preguntas_pendientes.includes('mascotas'),
   r.preguntas_pendientes.join(','));

r = run('asistente_contexto.js', inp([{ json: {} }]), nod({ JuntarMensajes: junto }))[0].json;
ck('sin ficha no se rompe', r.contexto.includes('ha escrito el directamente'));
ck('sin ficha pregunta las de compra', r.preguntas_pendientes.includes('presupuesto'),
   r.preguntas_pendientes.join(','));

r = run('asistente_contexto.js', inp([{ json: {
  telefono_wa: '34600112233', referencia: 'BN-1547-V', operacion: 'venta',
  es_alquiler: false, estado: 'plantilla_enviada' } }]),
  nod({ JuntarMensajes: junto }))[0].json;
ck('la referencia reparte la asesora', r.asesora === 'Carmen', r.asesora);

// ---------------------------------------------------------------------------
console.log('\n== El aviso de cualificacion ==');
r = run('cualificar_preparar.js', inp([{ json: {
  telefono: '600112233', nombre: 'Ana Belen', referencia: 'CS-1479-A',
  operacion: 'alquiler', personas: '3', ingresos: 'nomina indefinida',
  mascotas: 'un perro pequeno', entrada: '1 de noviembre', duracion: 'todo el ano',
  resumen: 'Le interesa el piso de Maestro Falla.' } }]))[0].json;
ck('va a Gisela con copia a direccion',
   r.destinatarios === 'gisela@casagencia.com, paco@casagencia.com', r.destinatarios);
ck('el asunto dice LEAD ALQUILER', r.email_asunto.startsWith('LEAD ALQUILER'), r.email_asunto);
ck('el correo avisa de que hay que llamar', /no se agenda visita: hay que llamarle/i
   .test(r.email_cuerpo));
ck('lleva las cuatro respuestas',
   ['3', 'nomina indefinida', 'un perro pequeno', '1 de noviembre']
     .every(v => r.email_cuerpo.includes(v)));
ck('la etiqueta es la de alquiler', r.etiqueta === 'ia-lead-alquiler', r.etiqueta);
ck('al agente le recuerda que no ofrezca hora', /NO le ofrezcas fecha ni hora/.test(r.respuesta));

r = run('cualificar_preparar.js', inp([{ json: {
  telefono: '+34666777888', nombre: 'Jose Luis', referencia: 'BN-1547-V',
  operacion: 'venta', cuando: 'en dos meses', zona: 'Benicassim playa',
  presupuesto: '220.000', financiacion: 'hipoteca', resumen: 'Quiere ver el chalet.' } }]))[0].json;
ck('compra va a Carmen', r.destinatarios.startsWith('carmen@'), r.destinatarios);
ck('en compra si se puede seguir con la visita', /sigue con la visita|puedes seguir/i
   .test(r.respuesta), r.respuesta);
ck('no escribe los campos vacios de alquiler', !r.campos_con_dato.includes('q_personas'),
   r.campos_con_dato.join(','));

// ---------------------------------------------------------------------------
console.log('\n== Las etiquetas del panel ==');
r = run('etiquetas_unir.js', inp([{ json: { payload: ['ia-cualificando', 'vip'] } }]),
        nod({ Start: { etiqueta: 'ia-cita-agendada' } }))[0].json;
ck('cambia el estado y respeta lo demas',
   JSON.stringify(r.labels) === JSON.stringify(['vip', 'ia-cita-agendada']),
   JSON.stringify(r.labels));
r = run('etiquetas_unir.js', inp([{ json: { payload: ['ia-cualificado'] } }]),
        nod({ Start: { etiqueta: 'intervenir' } }))[0].json;
ck('intervenir no borra el estado',
   r.labels.includes('ia-cualificado') && r.labels.includes('intervenir'),
   JSON.stringify(r.labels));
r = run('etiquetas_unir.js', inp([{ json: {} }]),
        nod({ Start: { etiqueta: 'ia-cualificando' } }))[0].json;
ck('sin etiquetas previas tampoco falla',
   JSON.stringify(r.labels) === JSON.stringify(['ia-cualificando']), JSON.stringify(r.labels));

// ---------------------------------------------------------------------------
console.log('\n== La respuesta que ve el agente ==');
r = run('herramienta_respuesta.js', inp([{ json: { respuesta: {
  encontrado: true, fiabilidad: 'alta', referencia: 'CS-1479-A',
  mensaje_para_sara: 'Es el piso de Maestro Falla 37.' } } }]))[0].json;
ck('le da la instruccion en texto', r.respuesta.startsWith('Es el piso'), r.respuesta);
ck('y los datos utiles', r.respuesta.includes('CS-1479-A'), r.respuesta);
r = run('herramienta_respuesta.js', inp([{ json: {} }]))[0].json;
ck('si no hay nada le prohibe inventar', /no te inventes/i.test(r.respuesta), r.respuesta);

// ---------------------------------------------------------------------------
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
