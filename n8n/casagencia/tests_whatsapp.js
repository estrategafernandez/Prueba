// Pruebas del asistente de WhatsApp.
//   NODE_PATH=<carpeta con luxon> node tests_whatsapp.js
const fs = require('fs');
const { DateTime } = require('luxon');
const B = '/home/user/Prueba/n8n/casagencia/';
const CFG = fs.readFileSync(B + 'wa/config.js', 'utf8');
const CARTERA = fs.readFileSync(B + 'wa/cartera.js', 'utf8');
const LIB = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8');
const REAL = JSON.parse(fs.readFileSync(B + 'tests_datos/cartera_ego_20260930.json', 'utf8'));

const correr = (codigo, $input, $) =>
  Function('$input', '$', 'DateTime', 'Buffer', '"use strict";' + codigo)($input, $, DateTime, Buffer);
// Nodo propio de WhatsApp (config [+ cartera])
const wa = (f, $input, $, cartera = false) =>
  correr(CFG + (cartera ? '\n' + CARTERA : '') + '\n' + fs.readFileSync(B + 'wa/' + f, 'utf8'), $input, $);
// Nodo del telefono reutilizado tal cual (libreria del telefono)
const tel = (f, $input, $) => correr(LIB + '\n' + fs.readFileSync(B + 'nodes/' + f, 'utf8'), $input, $);

const inp = a => ({ first: () => a[0], all: () => a });
const nod = m => n => {
  if (!(n in m)) throw new Error('el test no simula el nodo ' + n);
  const items = (Array.isArray(m[n]) ? m[n] : [m[n]]).map(j => ({ json: j }));
  return { first: () => items[0], item: items[0], all: () => items };
};
let fallos = 0;
const ck = (n, c, e = '') => {
  console.log((c ? '  OK   ' : '  FALLA') + '  ' + n + (e ? '  -> ' + e : ''));
  if (!c) fallos++;
};
const cfg = Function('DateTime', CFG + '; return { ETIQUETAS, EQUIPO, PLANTILLAS, MARCA_ORIGEN };')(DateTime);

// ===========================================================================
console.log('== 1. Correos de los portales ==');
let r = wa('parsear_email.js', inp([{ json: {
  subject: 'Tienes un nuevo contacto para tu anuncio CS-1479-A',
  from: { value: [{ address: 'no-reply@contacto.idealista.com' }] },
  html: '<p>Nombre: Ana Belen Marti Telefono: 600 11 22 33</p><p>Email: ana.marti@gmail.com</p>' +
        '<p>Referencia: CS-1479-A</p><a href="https://www.idealista.com/inmueble/109876543/?xts=1">Ver anuncio</a>' +
        '<a href="https://www.idealista.com/baja?u=1">Darse de baja</a>',
} }]))[0].json;
ck('idealista: portal', r.portal === 'Idealista', r.portal);
ck('idealista: telefono', r.telefono_e164 === '+34600112233', r.telefono_e164);
ck('idealista: el nombre no se come la etiqueta siguiente', r.nombre === 'Ana Belen Marti', r.nombre);
ck('idealista: alquiler -> bienvenida_alquiler en INGLES',
   r.plantilla === 'bienvenida_alquiler' && r.idioma === 'en', r.plantilla + '/' + r.idioma);
ck('idealista: {{1}} = el nombre de pila', r.param1 === 'Ana', r.param1);
ck('idealista: {{2}} = enlace de la FICHA, sin parametros ni el de darse de baja',
   r.param2 === 'https://www.idealista.com/inmueble/109876543/', r.param2);
ck('idealista: la comercial por la referencia', r.asesora === 'Gisela', r.asesora);

r = wa('parsear_email.js', inp([{ json: {
  subject: 'Nueva peticion de informacion - Fotocasa', from: { text: 'avisos@fotocasa.es' },
  text: 'Contacto: Jose Luis Ferrer Movil: +34 666777888 Ref: BN-1547-V Quiere comprar.',
} }]))[0].json;
ck('fotocasa: venta -> bienvenida_compra en espanol',
   r.plantilla === 'bienvenida_compra' && r.idioma === 'es', r.plantilla + '/' + r.idioma);
ck('fotocasa: sin enlace, {{2}} lleva la referencia', r.param2 === 'ref. BN-1547-V', r.param2);
ck('fotocasa: Carmen', r.asesora === 'Carmen', r.asesora);

r = wa('parsear_email.js', inp([{ json: {
  subject: 'Contacto web', from: { text: 'web@casagencia.com' }, text: 'Email: pedro.gil@gmail.com Ref: OR-1313-V',
} }]))[0].json;
ck('sin telefono no se contacta', r.se_puede_contactar === false);
ck('sin nombre, el saludo sale del email', r.param1 === 'Pedro', r.param1);

// ===========================================================================
console.log('\n== 2. La plantilla de bienvenida ==');
r = wa('plantilla_normalizar.js', inp([{ json: {
  telefono: '600112233', nombre: 'Ana', plantilla: 'bienvenida_alquiler', referencia: 'CS-1479-A',
  param1: 'Ana', param2: 'https://x.es/a\nb' } }]))[0].json;
ck('el idioma lo pone la configuracion, no el que venga', r.idioma === 'en', r.idioma);
ck('los parametros no llevan saltos de linea (Meta los rechaza)', !/\n/.test(r.param2), JSON.stringify(r.param2));
r = wa('plantilla_normalizar.js', inp([{ json: { telefono: '+34 666 777 888', referencia: 'BN-1547-V' } }]))[0].json;
ck('sin plantilla: la de compra por la referencia', r.plantilla === 'bienvenida_compra' && r.idioma === 'es');
ck('telefono como lo quiere Meta', r.wa_id === '34666777888', r.wa_id);

// ===========================================================================
console.log('\n== 3. Cuando la IA NO contesta ==');
const conv = { id: 1, status: 'open', labels: [], custom_attributes: {},
               meta: { sender: { id: 1, name: 'Jaime', phone_number: '+34608563923' } } };
const msj = (extra = {}, c = conv) => ({ event: 'message_created', message_type: 'incoming', content: 'Hola',
  conversation: c, sender: c.meta.sender, ...extra });
const casos = [
  ['mensaje normal (como el de prueba de Jaime)', msj(), true],
  ['lo escribe la agencia', msj({ message_type: 'outgoing' }), false],
  ['aviso del sistema (tipo 2)', msj({ message_type: 2 }), false],
  ['audio sin texto', msj({ content: '' }), false],
  ['etiqueta 4-intervenir', msj({}, { ...conv, labels: ['2-en_proceso', '4-intervenir'] }), false],
  ['conversacion resuelta', msj({}, { ...conv, status: 'resolved' }), false],
  ['escribe Carmen (contesta a un aviso)', msj({}, { ...conv, meta: { sender: { phone_number: '+34654907386' } } }), false],
  ['escribe Gisela', msj({}, { ...conv, meta: { sender: { phone_number: '+34 690 02 77 72' } } }), false],
];
for (const [t, body, esperado] of casos) {
  const e = wa('asistente_entrada.js', inp([{ json: { body } }]))[0].json;
  ck(t, e.contestar === esperado, e.motivos.join(',') || 'contesta');
}

// ===========================================================================
console.log('\n== 4. Juntar mensajes y partir la respuesta ==');
const entrada = { telefono_e164: '+34608563923', telefono_wa: '34608563923', nombre: 'Jaime',
  contenido: 'el del centro', conversacion_id: 1, contacto_id: 1, cuenta_id: 1, etiquetas: ['1-bienvenida_ia'] };
r = wa('asistente_juntar.js', inp([{}]), nod({ EntradaMensaje: entrada,
  LeerBuffer: { message: ['el del centro', 'quiero verlo', '¡Me gustaría visitar la vivienda!'] } }))[0].json;
ck('en el orden en que los escribio',
   r.mensaje === '¡Me gustaría visitar la vivienda!\nquiero verlo\nel del centro', JSON.stringify(r.mensaje));
const partes = wa('asistente_dividir.js', inp([{ json: {
  output: 'Perfecto.\n\n' + 'El piso tiene tres habitaciones y dos banos. '.repeat(14) } }])).map(x => x.json);
ck('como mucho cinco mensajes', partes.length <= 5, String(partes.length));

// ===========================================================================
console.log('\n== 5. Lo que sabe el agente antes de escribir ==');
const junto = { telefono_e164: '+34608563923', telefono_wa: '34608563923', nombre: 'Jaime',
                conversacion_id: 1, cuenta_id: 1, mensaje: 'hola' };
r = wa('asistente_contexto.js', inp([{ json: { telefono_wa: '34608563923', referencia: 'CS-1479-A',
  operacion: 'alquiler', es_alquiler: true, asesora: 'Gisela', portal: 'Idealista',
  enlace: 'https://www.idealista.com/inmueble/1/', q_personas: '3' } }]),
  nod({ JuntarMensajes: junto, EntradaMensaje: entrada }))[0].json;
ck('alquiler: le faltan las otras tres', JSON.stringify(r.preguntas_pendientes) ===
   JSON.stringify(['ingresos', 'mascotas', 'entrada']), JSON.stringify(r.preguntas_pendientes));
ck('ve el enlace del anuncio', r.contexto.includes('idealista.com/inmueble'));
ck('sabe que no se agenda', /No se agenda/.test(r.contexto));
r = wa('asistente_contexto.js', inp([{ json: { telefono_wa: '34608563923', referencia: 'BN-1547-V',
  operacion: 'venta', q_tiempo_buscando: 'seis meses' } }]), nod({ JuntarMensajes: junto, EntradaMensaje: entrada }))[0].json;
ck('compra: solo le falta si necesita vender',
   JSON.stringify(r.preguntas_pendientes) === JSON.stringify(['necesita_vender']), JSON.stringify(r.preguntas_pendientes));
ck('compra: Carmen', r.asesora === 'Carmen', r.asesora);

// ===========================================================================
console.log('\n== 6. Cualificacion ==');
r = wa('cualificar_preparar.js', inp([{ json: { telefono: '+34608563923', nombre: 'Jaime',
  referencia: 'BN-1547-V', operacion: 'venta', tiempo_buscando: 'seis meses', necesita_vender: 'no',
  resumen: 'Le gusta la terraza.', conversacion_id: 1 } }]))[0].json;
ck('compra: no es alquiler y ofrece la visita', !r.es_alquiler && /ofrecele directamente la visita/i.test(r.respuesta));
ck('compra: guarda las dos respuestas', r.q_tiempo_buscando === 'seis meses' && r.q_necesita_vender === 'no');
r = wa('cualificar_preparar.js', inp([{ json: { telefono: '+34608563923', nombre: 'Jaime',
  referencia: 'CS-1479-A', personas: '3', ingresos: 'nomina indefinida', mascotas: 'un perro',
  entrada: '1 de noviembre', resumen: 'Pregunta por el piso del centro.', conversacion_id: 7 } }]))[0].json;
ck('alquiler por la -A aunque no diga operacion', r.es_alquiler === true);
ck('alquiler: pasa a una persona', r.aviso.pasar_a_humano === true && r.aviso.accion === 'INTERVENIR');
ck('alquiler: a Gisela', r.aviso.destinatario === 'Gisela', r.aviso.destinatario);
ck('alquiler: el aviso lleva las cuatro respuestas',
   ['3', 'nomina indefinida', 'un perro', '1 de noviembre'].every(v => r.aviso.resumen.includes(v)), r.aviso.resumen);
ck('alquiler: no ofrece hora', /No le ofrezcas fecha ni hora/.test(r.respuesta));

// ===========================================================================
console.log('\n== 7. El aviso al comercial (plantilla_aviso) ==');
r = wa('aviso_preparar.js', inp([{ json: { accion: 'VISITA AGENDADA', destinatario: 'Carmen',
  referencia: 'BN-1547-V', cliente_nombre: 'Jaime', cliente_telefono: '608563923',
  cita: 'viernes 2 de octubre a las 17:00', resumen: 'Lleva seis meses buscando.\nNo necesita vender.',
  conversacion_id: 1, pasar_a_humano: false, etiqueta: '3-agendada_ia' } }]))[0].json;
const t = r.meta_body.template;
ck('plantilla_aviso en ingles', t.name === 'plantilla_aviso' && t.language.code === 'en', t.name + '/' + t.language.code);
ck('va al movil de Carmen', r.meta_body.to === '34654907386', r.meta_body.to);
ck('{{1}} = el nombre de la comercial', t.components[0].parameters[0].text === 'Carmen');
const p2 = t.components[0].parameters[1].text;
ck('{{2}} en UNA linea (Meta rechaza saltos de linea)', !/[\n\t]/.test(p2) && !/ {5,}/.test(p2), p2.slice(0, 80));
ck('{{2}} dice que tiene que hacer', /Confirmale la visita/.test(p2));
ck('{{2}} lleva la cita, el cliente y el resumen',
   ['2 de octubre', 'Jaime', '+34608563923', 'seis meses'].every(x => p2.includes(x)), p2);
ck('{{2}} lleva el enlace al chat',
   p2.includes('panel-casa-agencia.serversvisionarius.com/app/accounts/1/conversations/1'));
ck('copia por correo a Carmen y a Paco', r.email_para === 'carmen@casagencia.com, paco@casagencia.com', r.email_para);
ck('pone 3-agendada_ia', r.etiquetas === '3-agendada_ia', r.etiquetas);
r = wa('aviso_preparar.js', inp([{ json: { accion: 'INTERVENIR', referencia: 'CS-1479-A',
  resumen: 'x', conversacion_id: 7, pasar_a_humano: true } }]))[0].json;
ck('pasar a humano pone 4-intervenir', r.etiquetas === '4-intervenir', r.etiquetas);
ck('sin destinatario: la de la referencia (Gisela)', r.para_nombre === 'Gisela', r.para_nombre);
r = wa('aviso_preparar.js', inp([{ json: { accion: 'AVISO', resumen: 'Queja por la firma' } }]))[0].json;
ck('sin referencia ni zona: Laurence', r.para_nombre === 'Laurence', r.para_nombre);
ck('aviso largo recortado a 900', wa('aviso_preparar.js', inp([{ json: { resumen: 'a'.repeat(3000) } }]))[0]
   .json.aviso.length <= 900);

const res = (w, c) => wa('aviso_resultado.js', inp([{}]), nod({ Preparar: { para_nombre: 'Carmen', pasar_a_humano: false },
  EnviarWhatsApp: w, EnviarCorreo: c }))[0].json;
ck('whatsapp y correo OK', res({ messages: [{ id: 'wamid.1' }] }, { id: 'g1' }).mensaje_registrado === true);
r = res({ error: { message: '(#131049) healthy ecosystem' } }, { id: 'g1' });
ck('Meta frena la plantilla pero el correo sale', r.mensaje_registrado === true && r.whatsapp_ok === false, r.error_whatsapp);
r = res({ error: { message: 'x' } }, {});
ck('no sale por ningun sitio: no se dice que esta avisado', r.mensaje_registrado === false && /NO ha salido/.test(r.respuesta));

// ===========================================================================
console.log('\n== 8. Etiquetas de Chatwoot (las de Blue) ==');
const unir = (actuales, pedidas) => wa('etiquetas_unir.js', inp([{ json: { payload: actuales } }]),
  nod({ Start: { etiquetas: pedidas } }))[0].json.labels;
ck('bienvenida -> en proceso', JSON.stringify(unir(['1-bienvenida_ia'], '2-en_proceso')) === '["2-en_proceso"]');
ck('agendada NO vuelve a en proceso', JSON.stringify(unir(['3-agendada_ia'], '2-en_proceso')) === '["3-agendada_ia"]');
ck('4-intervenir se suma al estado',
   JSON.stringify(unir(['2-en_proceso'], '4-intervenir')) === '["2-en_proceso","4-intervenir"]');
ck('respeta las que pone una persona', unir(['vip', '1-bienvenida_ia'], '3-agendada_ia').join() === 'vip,3-agendada_ia');
const est = (etq) => wa('estado_en_proceso.js', inp([{}]), nod({ EntradaMensaje: { ...entrada, etiquetas: etq } }))[0].json.marcar;
ck('al contestar pasa a en proceso', est(['1-bienvenida_ia']) === true);
ck('si ya esta agendada no se toca', est(['3-agendada_ia']) === false);
ck('si esta en manos de una persona no se toca', est(['4-intervenir']) === false);

// ===========================================================================
console.log('\n== 9. Agenda: guardia de WhatsApp + codigo del telefono ==');
const FESTIVOS = Function('DateTime', LIB + '; return FESTIVOS;')(DateTime);
let dia = DateTime.now().setZone('Europe/Madrid').plus({ days: 1 });
while (dia.weekday !== 2 || FESTIVOS.TODOS.includes(dia.toFormat('yyyy-MM-dd'))) dia = dia.plus({ days: 1 });
const MARTES = dia.toFormat('yyyy-MM-dd');
const guardia = (j) => wa('guardia_alquiler.js', inp([{ json: j }]))[0].json;

r = guardia({ referencia: 'CS-1479-A', tipo_transaccion: 'alquiler', fecha: MARTES, hora: '11:00', modo: 'reserva' });
ck('alquiler: bloqueado antes de tocar la agenda', r.seguir === false && /BLOQUEADO/.test(r.respuesta));
r = guardia({ referencia: 'BN-1547-V', tipo_transaccion: 'compra', fecha: MARTES, modo: 'consulta',
              telefono: '+34608563923', nombre: 'Jaime' });
ck('consulta sin hora: pregunta por las 11:00', r.seguir && r.body.hora === '11:00', r.body.hora);
ck('reserva sin hora: NO se rellena',
   guardia({ referencia: 'BN-1547-V', tipo_transaccion: 'compra', fecha: MARTES, modo: 'reserva' }).body.hora === '');

// La salida de la guardia la entiende tal cual el codigo del telefono
const prep = tel('bd_preparar.js', inp([{ json: r }]))[0].json;
ck('el telefono lee la peticion de WhatsApp', prep.referencia === 'BN-1547-V' && prep.asesora === 'Carmen'
   && prep.telefono_e164 === '+34608563923', `${prep.referencia} ${prep.asesora} ${prep.telefono_e164}`);
const calc = tel('bd_calcular.js', inp([]), nod({ PrepararDatos: prep }))[0].json.respuesta;
ck('martes 11:00 con la agenda libre: hay hueco', calc.disponible === true, calc.motivo);
const filt = wa('filtrar_antelacion.js', inp([{ json: { respuesta: calc } }]))[0].json.respuesta;
ck('sin antelacion minima, no cambia nada', JSON.stringify(filt) === JSON.stringify(calc));
const prepC = tel('cc_preparar.js', inp([{ json: guardia({ referencia: 'BN-1547-V', tipo_transaccion: 'compra',
  fecha: MARTES, hora: '17:00', modo: 'reserva', telefono: '+34608563923', nombre: 'Jaime' }) }]))[0].json;
const val = tel('cc_validar.js', inp([]), nod({ PrepararDatos: prepC }))[0].json;
ck('la cita se puede crear', val.puede_crear === true, val.respuesta?.motivo);
ck('mismo titulo que las del telefono (asi las encuentra por telefono)',
   val.titulo.startsWith('Visita inmueble - BN-1547-V') && val.titulo.includes('+34608563923'), val.titulo);

r = wa('aviso_cita.js', inp([{}]), nod({ ValidarAntesDeInsertar: val,
  Start: { resumen: 'Lleva seis meses buscando', conversacion_id: 1 } }))[0].json;
ck('el aviso de la cita va a Carmen con 3-agendada_ia', r.destinatario === 'Carmen' && r.etiqueta === '3-agendada_ia');
ck('la cita escrita como la lee una persona', /^martes \d+ de \w+ a las 17:00$/.test(r.cita), r.cita);

// ===========================================================================
console.log('\n== 10. Recordatorio de 24 h ==');
const desc = (extra) => [`Cliente: Jaime`, `Telefono: +34608563923`, `Referencia: BN-1547-V`, `Asesora: Carmen`,
  '', 'PRE-RESERVA creada por Sara (IA).', extra].join('\n');
const eventos = [
  { id: 'e1', start: { dateTime: MARTES + 'T17:00:00+02:00' }, description: desc(cfg.MARCA_ORIGEN + '\nConversacion: 1\nResumen: seis meses') },
  { id: 'e1', start: { dateTime: MARTES + 'T17:00:00+02:00' }, description: desc(cfg.MARCA_ORIGEN) },
  { id: 'e2', start: { dateTime: MARTES + 'T18:00:00+02:00' }, description: desc('') },
  { id: 'e3', status: 'cancelled', start: { dateTime: MARTES + 'T19:00:00+02:00' }, description: desc(cfg.MARCA_ORIGEN) },
];
const vis = wa('recordatorio_filtrar.js', inp(eventos.map(e => ({ json: e })))).map(x => x.json);
ck('solo las de WhatsApp, sin canceladas ni repetidas', vis.length === 1 && vis[0].evento_id === 'e1', vis.map(v => v.evento_id).join());
ck('saca comercial, cliente y conversacion', vis[0].destinatario === 'Carmen' && vis[0].conversacion_id === 1
   && vis[0].resumen === 'seis meses');
const nuevos = wa('recordatorio_pendientes.js', inp([{ json: { evento_id: 'e1' } }]),
  nod({ VisitasDeWhatsApp: [{ evento_id: 'e1' }, { evento_id: 'e9' }] }));
ck('solo los que no se habian avisado', nuevos.length === 1 && nuevos[0].json.evento_id === 'e1');

// ===========================================================================
console.log('\n== 11. Cartera REAL (feed de eGO, ' + REAL.length + ' inmuebles) ==');
const hoja = { LeerCartera: REAL, LeerDirecciones: [{ ref: REAL[0].ref, direccion: 'Calle de Prueba 1' }] };
const venta = REAL.find(x => x.tipo_transaccion === 'venta' && x.descripcion);
const alq = REAL.find(x => x.tipo_transaccion === 'alquiler');
const ficha = (ref) => wa('ficha_inmueble.js', inp([{}]), nod({ ...hoja, Start: { referencia: ref } }), true)[0].json;

r = ficha(venta.ref.replace(/-/g, '').toLowerCase());
ck(`ficha de ${venta.ref} sin guiones y en minusculas`, r.encontrado === true && r.referencia === venta.ref);
ck('la ficha trae la descripcion entera', r.respuesta.includes(venta.descripcion.replace(/\s+/g, ' ').trim().slice(0, 60)));
ck('la ficha trae el precio', /Precio: [\d.]+ €/.test(r.respuesta), (r.respuesta.match(/Precio:.*/) || [''])[0]);
r = ficha(alq.ref);
ck(`ficha de ${alq.ref}: avisa de que es alquiler`, /ALQUILER \(no se agenda/.test(r.respuesta));
r = ficha(REAL[0].ref);
ck('si la agencia puso la calle, la ficha la da', r.respuesta.includes('Direccion: Calle de Prueba 1'));
r = ficha('ZZ-99999-V');
ck('referencia que no esta: no dice que no existe', r.encontrado === false && /No digas que no existe/.test(r.respuesta));

const buscar = (q) => wa('buscar_inmuebles.js', inp([{}]), nod({ ...hoja, Start: q }), true)[0].json;
const filas = (q) => { const x = buscar(q); return (x.referencias || []).map(ref => REAL.find(z => z.ref === ref)); };
let fl = filas({ operacion: 'venta', municipio: 'Benicàssim', limite: 8 });
ck('venta en "Benicàssim": todo venta y en Benicasim', fl.length > 0 &&
   fl.every(x => x.tipo_transaccion === 'venta' && x.municipio.startsWith('Benicasim')), `${fl.length} resultados`);
fl = filas({ operacion: 'venta', precio_max: 200000, limite: 8 });
ck('precio maximo 200.000 respetado', fl.length > 0 && fl.every(x => Number(x.precio) <= 200000),
   fl.map(x => x.precio).join(','));
fl = filas({ operacion: 'venta', extras: 'piscina', limite: 8 });
ck('extra "piscina": todos la tienen', fl.length > 0 &&
   fl.every(x => (x.caracteristicas + x.descripcion).toLowerCase().includes('piscina')), `${fl.length}`);
fl = filas({ operacion: 'venta', municipio: 'Sant Joan de Moro' });
ck('un pueblo que no esta en la lista fija pero si en la cartera', fl.length > 0 &&
   fl.every(x => x.municipio.includes('Moró')), `${fl.length}`);
r = buscar({ operacion: 'venta', municipio: 'Madrid' });
ck('municipio sin cartera: lo dice y da los nuestros', r.total === 0 && /no es una zona/.test(r.respuesta));
r = buscar({ operacion: 'alquiler', habitaciones_min: 3 });
ck('el agente no ve las referencias como algo que decir', /son internas/.test(r.respuesta));
const todos = buscar({ operacion: 'venta', limite: 8 });
const sinPrimero = buscar({ operacion: 'venta', limite: 8, excluir: todos.referencias[0] });
ck('excluir los ya ensenados', !sinPrimero.referencias.includes(todos.referencias[0]));

const sim = wa('recomendar_similares.js', inp([{}]), nod({ ...hoja, Start: { referencia: venta.ref } }), true)[0].json;
const simFilas = (sim.referencias || []).map(ref => REAL.find(z => z.ref === ref));
ck(`parecidos a ${venta.ref}: no se incluye a si mismo`, simFilas.length > 0 && !sim.referencias.includes(venta.ref),
   (sim.referencias || []).join(','));
ck('parecidos: misma operacion', simFilas.every(x => x.tipo_transaccion === venta.tipo_transaccion));
ck('parecidos: como mucho 3', simFilas.length <= 3);

// ===========================================================================
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
