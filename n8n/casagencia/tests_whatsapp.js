// Pruebas del asistente de WhatsApp.
//   NODE_PATH=<carpeta con luxon> node tests_whatsapp.js
const fs = require('fs');
const { DateTime } = require('luxon');
const B = '/home/user/Prueba/n8n/casagencia/';
const CFG = fs.readFileSync(B + 'wa/config.js', 'utf8');
const CARTERA = fs.readFileSync(B + 'wa/cartera.js', 'utf8');
const LIB = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8');
// La cartera real, tal y como la deja [WA] 4 en wa_cartera (feed de eGO del 1-10-2026)
const REAL = JSON.parse(fs.readFileSync(B + 'tests_datos/wa_cartera_20261001.json', 'utf8'));
// Tres inmuebles del feed tal y como los entrega el nodo XML de n8n
const FEED = JSON.parse(fs.readFileSync(B + 'tests_datos/feed_ego_muestra.json', 'utf8'));

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
r = wa('plantilla_normalizar.js', inp([{ json: {} }]), nod({ Start: {
  telefono: '600112233', nombre: 'Ana', plantilla: 'bienvenida_alquiler', referencia: 'CS-1479-A',
  param1: 'Ana', param2: 'https://x.es/a\nb' } }))[0].json;
ck('el idioma lo pone la configuracion, no el que venga', r.idioma === 'en', r.idioma);
ck('los parametros no llevan saltos de linea (Meta los rechaza)', !/\n/.test(r.param2), JSON.stringify(r.param2));
r = wa('plantilla_normalizar.js', inp([{ json: {} }]), nod({ Start: { telefono: '+34 666 777 888', referencia: 'BN-1547-V' } }))[0].json;
ck('sin plantilla: la de compra por la referencia', r.plantilla === 'bienvenida_compra' && r.idioma === 'es');
ck('telefono como lo quiere Meta', r.wa_id === '34666777888', r.wa_id);

// ===========================================================================
console.log('\n== 3. Cuando la IA NO contesta ==');
const conv = { id: 1, status: 'open', labels: [], custom_attributes: {},
               meta: { sender: { id: 1, name: 'Jaime', phone_number: '+34600000001', custom_attributes: { bot: 'On' } } } };
const msj = (extra = {}, c = conv) => ({ event: 'message_created', message_type: 'incoming', content: 'Hola',
  conversation: c, sender: c.meta.sender, ...extra });
const conBot = (bot) => ({ ...conv, meta: { sender: { ...conv.meta.sender, custom_attributes: bot === undefined ? {} : { bot } } } });
const casos = [
  ['mensaje normal (como el de prueba de Jaime)', msj(), true],
  ['lo escribe la agencia', msj({ message_type: 'outgoing' }), false],
  ['aviso del sistema (tipo 2)', msj({ message_type: 2 }), false],
  ['nota privada', msj({ private: true }), false],
  ['mensaje vacio y sin adjunto', msj({ content: '' }), false],
  ['nota de voz (sin texto) SI se atiende', msj({ content: '', attachments: [{ file_type: 'audio', data_url: 'https://x/a.ogg' }] }), true],
  ['foto SI se atiende', msj({ content: '', attachments: [{ file_type: 'image', data_url: 'https://x/a.jpg' }] }), true],
  ['etiqueta 4-intervenir', msj({}, { ...conv, labels: ['2-en_proceso', '4-intervenir'] }), false],
  ['conversacion resuelta', msj({}, { ...conv, status: 'resolved' }), false],
  ['bot sin valor ("Select value"): contesta', msj({}, conBot(undefined)), true],
  ['bot vacio: contesta', msj({}, conBot('')), true],
  ['Blue: bot Off', msj({}, conBot('Off')), false],
  ['Blue: bot On', msj({}, conBot('On')), true],
  ['escribe Carmen (contesta a un aviso)', msj({}, { ...conv, meta: { sender: { phone_number: '+34654907386', custom_attributes: { bot: 'On' } } } }), false],
  ['escribe Gisela', msj({}, { ...conv, meta: { sender: { phone_number: '+34 690 02 77 72', custom_attributes: { bot: 'On' } } } }), false],
];
// Lo que manda de verdad la automatizacion de Chatwoot (send_webhook_event):
// la conversacion entera, con event 'automation_event.message_created'.
const automatizacion = (extra = {}, mensaje = {}) => ({
  event: 'automation_event.message_created', id: 1, inbox_id: 1, status: 'open', labels: ['1-bienvenida_ia'],
  custom_attributes: {}, channel: 'Channel::Whatsapp', can_reply: true,
  meta: { sender: { id: 1, name: 'Jaime V. Fernández', phone_number: '+34600000001', type: 'contact',
                    custom_attributes: { bot: 'On' } },
          assignee: { id: 1, name: 'Jaime' } },
  messages: [{ id: 9, content: '¡Me gustaría visitar la vivienda!', message_type: 0, created_at: 1790849086,
               content_type: 'text', conversation_id: 1, sender: { type: 'contact' }, ...mensaje }],
  ...extra });
casos.push(['automatizacion de Chatwoot: boton de la plantilla', automatizacion(), true]);
casos.push(['automatizacion: otro evento', automatizacion({ event: 'automation_event.conversation_updated' }), false]);
for (const [t, body, esperado] of casos) {
  const e = wa('asistente_entrada.js', inp([{ json: { body } }]))[0].json;
  ck(t, e.contestar === esperado, e.motivos.join(',') || 'contesta');
}
// Cada filtro sale en su nodo (como en Blue): el primero solo mira si es un mensaje del cliente
let e3 = wa('asistente_entrada.js', inp([{ json: { body: msj({}, conBot('Off')) } }]))[0].json;
ck('bot Off: es mensaje del cliente, lo para el nodo "Bot on/off"', e3.procesar === true && e3.bot_encendido === false
   && e3.bot_asignado === true);
e3 = wa('asistente_entrada.js', inp([{ json: { body: msj({}, conBot(undefined)) } }]))[0].json;
ck('sin bot: pasa los dos filtros (solo para Off)', e3.procesar === true && e3.bot_asignado === true && e3.bot_encendido === true);

// Y el que mando Chatwoot de verdad el 1-10-2026 al pulsar el boton de la plantilla
// (anonimizado). Ese contacto no tenia el atributo bot y se le contesta: solo
// se calla con bot = Off.
const REAL_CW = JSON.parse(fs.readFileSync(B + 'tests_datos/chatwoot_automatizacion_real.json', 'utf8'));
r = wa('asistente_entrada.js', inp([{ json: { body: REAL_CW } }]))[0].json;
ck('payload REAL: se lee bien', r.procesar === true && r.conversacion_id === 1 && r.mensaje_id === 5
   && r.telefono_e164 === '+34600000001' && r.contenido === '¡Me gustaría visitar la vivienda!' && r.tipo === 'text',
   r.motivos.join(','));
ck('payload REAL sin atributo bot: se contesta', r.contestar === true, r.motivos.join(','));
const REAL_ON = JSON.parse(JSON.stringify(REAL_CW));
REAL_ON.meta.sender.custom_attributes = { bot: 'On' };
r = wa('asistente_entrada.js', inp([{ json: { body: REAL_ON } }]))[0].json;
ck('payload REAL con bot=On: contesta', r.contestar === true, r.motivos.join(','));
r = wa('asistente_entrada.js', inp([{ json: { body: automatizacion() } }]))[0].json;
ck('automatizacion: saca el texto del boton', r.contenido === '¡Me gustaría visitar la vivienda!', r.contenido);
ck('automatizacion: conversacion 1 y telefono de Jaime', r.conversacion_id === 1 && r.telefono_e164 === '+34600000001');
ck('automatizacion: ve las etiquetas', r.etiquetas.includes('1-bienvenida_ia'));
ck('automatizacion: claves de Redis por telefono y por mensaje',
   r.clave_buffer === 'wa:buffer:34600000001' && r.clave_visto === 'wa:visto:9', r.clave_buffer + ' ' + r.clave_visto);

console.log('\n== 3b. Audio, imagen y otros adjuntos ==');
const adj = (a, content = '') => wa('asistente_entrada.js', inp([{ json: { body:
  automatizacion({}, { content, attachments: [{ id: 1, message_id: 9, ...a }] }) } }]))[0].json;
r = adj({ file_type: 'audio', data_url: 'https://panel/rails/active_storage/blobs/redirect/x/audio.ogg' });
ck('nota de voz -> rama audio con el enlace de Chatwoot', r.tipo === 'audio' && r.adjunto_url.endsWith('audio.ogg') && r.contestar);
r = adj({ file_type: 'image', data_url: 'https://panel/foto.jpg' }, 'mira este');
ck('foto con pie -> rama imagen y el pie como texto', r.tipo === 'image' && r.contenido === 'mira este');
r = adj({ file_type: 'location', coordinates_lat: 40.05, coordinates_long: 0.06, fallback_title: 'Calle Mayor' });
ck('ubicacion -> se describe para Sara', r.tipo === 'otro' && /ubicación: Calle Mayor \(40.05, 0.06\)/.test(r.descripcion_adjunto), r.descripcion_adjunto);
r = adj({ file_type: 'file', extension: '.pdf' });
ck('documento -> se describe', r.tipo === 'otro' && r.descripcion_adjunto === '[el cliente ha enviado un documento (pdf)]', r.descripcion_adjunto);
r = adj({ file_type: 'video' });
ck('video -> se describe', r.tipo === 'otro' && /vídeo/.test(r.descripcion_adjunto));

// ===========================================================================
console.log('\n== 4. Juntar mensajes y partir la respuesta ==');
const entrada = { telefono_e164: '+34600000001', telefono_wa: '34600000001', nombre: 'Jaime',
  contenido: 'el del centro', conversacion_id: 1, contacto_id: 1, cuenta_id: 1, etiquetas: ['1-bienvenida_ia'],
  mensaje_id: 12, creado: 1790849100 };
const E = (id, t, ts = 1790849000 + id) => JSON.stringify({ id, ts, t });
const sacar = (lista) => [...lista].reverse().map(x => ({ entrada: JSON.parse(x) })).concat([{ entrada: null }, { entrada: null }]);
let cola4 = [E(12, 'el del centro'), E(11, 'quiero verlo'), E(10, '¡Me gustaría visitar la vivienda!')];
r = wa('asistente_juntar.js', inp([{}]), nod({ EntradaMensaje: entrada, 'Saca los mensajes de Redis': sacar(cola4),
  'Obtiene todos los Mensajes': { message: cola4 } }))[0].json;
ck('en el orden en que los escribio',
   r.mensaje === '¡Me gustaría visitar la vivienda!\nquiero verlo\nel del centro', JSON.stringify(r.mensaje));
r = wa('asistente_juntar.js', inp([{}]), nod({ EntradaMensaje: entrada,
  'Obtiene todos los Mensajes': { message: ['el del centro', 'quiero verlo'] } }))[0].json;
ck('tambien entiende la cola antigua (texto suelto)', r.mensaje === 'quiero verlo\nel del centro', JSON.stringify(r.mensaje));
const vez = wa('asistente_vaciar.js', inp([{}]), nod({ 'Obtiene todos los Mensajes': { message: cola4 } }));
ck('vaciar: un RPOP por mensaje y unos cuantos de sobra', vez.length === 8, String(vez.length));
const partes = wa('asistente_dividir.js', inp([{ json: {
  output: 'Perfecto.\n\n' + 'El piso tiene tres habitaciones y dos banos. '.repeat(14) } }])).map(x => x.json);
ck('como mucho cinco mensajes', partes.length <= 5, String(partes.length));

// ===========================================================================
console.log('\n== 5. Lo que sabe el agente antes de escribir ==');
const junto = { telefono_e164: '+34600000001', telefono_wa: '34600000001', nombre: 'Jaime',
                conversacion_id: 1, cuenta_id: 1, mensaje: 'hola' };
const contexto = (filaLead, cartera = REAL) => wa('asistente_contexto.js', inp([{}]),
  nod({ JuntarMensajes: junto, EntradaMensaje: entrada, LeerFichaDelLead: filaLead,
        LeerCartera: cartera, LeerDirecciones: [] }), true)[0].json;
r = contexto({ telefono_wa: '34600000001', referencia: 'CS-1479-A',
  operacion: 'alquiler', es_alquiler: true, asesora: 'Gisela', portal: 'Idealista',
  enlace: 'https://www.idealista.com/inmueble/1/', q_personas: '3' });
ck('alquiler: le faltan las otras tres', JSON.stringify(r.preguntas_pendientes) ===
   JSON.stringify(['ingresos', 'mascotas', 'entrada']), JSON.stringify(r.preguntas_pendientes));
ck('ve el enlace del anuncio', r.contexto.includes('idealista.com/inmueble'));
ck('sabe que no se agenda', /No se agenda/.test(r.contexto));
const pisoVenta = REAL.find(x => x.tipo_transaccion === 'venta' && /piso/i.test(x.tipo_inmueble) && x.descripcion);
r = contexto({ telefono_wa: '34600000001', referencia: pisoVenta.ref, operacion: 'venta',
               q_tiempo_buscando: 'seis meses' });
ck('la ficha del inmueble va cargada en el contexto', r.ficha_cargada === true &&
   r.contexto.includes('FICHA DEL INMUEBLE') && r.contexto.includes('Referencia: ' + pisoVenta.ref));
ck('con la descripcion entera del anuncio',
   r.contexto.includes(pisoVenta.descripcion.replace(/\s+/g, ' ').trim().slice(-80)));
ck('y el precio', /Precio: [\d.]+ €/.test(r.contexto));
ck('compra: le faltan si necesita vender y la financiacion',
   JSON.stringify(r.preguntas_pendientes) === JSON.stringify(['necesita_vender', 'financiacion']), JSON.stringify(r.preguntas_pendientes));
r = contexto({ telefono_wa: '34600000001', referencia: pisoVenta.ref, operacion: 'venta',
               q_tiempo_buscando: 'un ano', q_necesita_vender: 'Si, el mio de Castellon' });
ck('compra: si vende, le falta donde esta su vivienda',
   JSON.stringify(r.preguntas_pendientes) === JSON.stringify(['vivienda_a_vender', 'financiacion']), JSON.stringify(r.preguntas_pendientes));
r = contexto({ telefono_wa: '34600000001', referencia: pisoVenta.ref, operacion: 'venta', q_tiempo_buscando: 'un ano',
               q_necesita_vender: 'si', q_vivienda_venta: 'Grao de Castellon', q_financiacion: 'hipoteca preconcedida' });
ck('compra: con las tres (y la zona), nada pendiente', r.preguntas_pendientes.length === 0, JSON.stringify(r.preguntas_pendientes));
ck('compra: la comercial de la referencia', r.asesora === (/^(BN|OR)/.test(pisoVenta.ref) ? 'Carmen' : 'Gisela'), r.asesora);
r = contexto({ telefono_wa: '34600000001', referencia: 'ZZ-1-V', operacion: 'venta' });
ck('si ya no esta en cartera, se lo dice al agente', /ya no esta en la cartera/.test(r.contexto));
r = contexto({ telefono_wa: '34600000001', referencia: pisoVenta.ref, operacion: 'venta' }, []);
ck('si la hoja falla, no inventa: le manda a la herramienta', /No se ha podido leer la cartera/.test(r.contexto));
r = contexto({});
ck('sin lead (escribe el directamente): sin ficha y sin romperse', r.ficha_cargada === false && /ha escrito el/.test(r.contexto));

// ===========================================================================
console.log('\n== 6. Cualificacion ==');
r = wa('cualificar_preparar.js', inp([{ json: { telefono: '+34600000001', nombre: 'Jaime',
  referencia: 'BN-1547-V', operacion: 'venta', tiempo_buscando: 'seis meses', necesita_vender: 'no',
  resumen: 'Le gusta la terraza.', conversacion_id: 1 } }]))[0].json;
ck('compra: no es alquiler y ofrece la visita', !r.es_alquiler && /ofrecele directamente la visita/i.test(r.respuesta));
ck('compra: guarda las respuestas', r.q_tiempo_buscando === 'seis meses' && r.q_necesita_vender === 'no');
ck('compra: no vende -> sin etiqueta vendedor', r.es_vendedor === false);
ck('compra: le falta la financiacion -> que la pregunte', /Falta como lo va a financiar/.test(r.respuesta));
r = wa('cualificar_preparar.js', inp([{ json: { telefono: '+34600000001', nombre: 'Jaime',
  referencia: 'BN-1547-V', operacion: 'venta', tiempo_buscando: 'un ano', necesita_vender: 'si, tengo que vender el mio',
  es_vendedor: true, vivienda_a_vender: 'calle Mayor, Castellon', financiacion: 'hipoteca preconcedida',
  conversacion_id: 1 } }]))[0].json;
ck('vendedor: etiqueta "vendedor"', r.es_vendedor === true && r.etiqueta_vendedor === 'vendedor');
ck('vendedor: guarda la zona y la financiacion', r.q_vivienda_venta === 'calle Mayor, Castellon'
   && r.q_financiacion === 'hipoteca preconcedida');
ck('con todo contestado: directamente la visita', /Ahora ofrecele directamente la visita/.test(r.respuesta), r.respuesta);
r = wa('cualificar_preparar.js', inp([{ json: { telefono: '+34600000001', referencia: 'BN-1547-V', operacion: 'venta',
  tiempo_buscando: 'un mes', necesita_vender: 'Si', conversacion_id: 1 } }]))[0].json;
ck('dice que si (aunque Sara no lo marque): vendedor, y pide la zona', r.es_vendedor === true
   && /direccion o zona de la vivienda que tiene que vender/.test(r.respuesta));
r = wa('cualificar_preparar.js', inp([{ json: { telefono: '+34600000001', nombre: 'Jaime',
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
  referencia: 'BN-1547-V', cliente_nombre: 'Jaime', cliente_telefono: '600000001',
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
   ['2 de octubre', 'Jaime', '+34600000001', 'seis meses'].every(x => p2.includes(x)), p2);
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
              telefono: '+34600000001', nombre: 'Jaime' });
ck('consulta sin hora: pregunta por las 11:00', r.seguir && r.body.hora === '11:00', r.body.hora);
ck('reserva sin hora: NO se rellena',
   guardia({ referencia: 'BN-1547-V', tipo_transaccion: 'compra', fecha: MARTES, modo: 'reserva' }).body.hora === '');

// La salida de la guardia la entiende tal cual el codigo del telefono
const prep = tel('bd_preparar.js', inp([{ json: r }]))[0].json;
ck('el telefono lee la peticion de WhatsApp', prep.referencia === 'BN-1547-V' && prep.asesora === 'Carmen'
   && prep.telefono_e164 === '+34600000001', `${prep.referencia} ${prep.asesora} ${prep.telefono_e164}`);
const calc = tel('bd_calcular.js', inp([]), nod({ PrepararDatos: prep }))[0].json.respuesta;
ck('martes 11:00 con la agenda libre: hay hueco', calc.disponible === true, calc.motivo);
const filt = wa('filtrar_antelacion.js', inp([{ json: { respuesta: calc } }]))[0].json.respuesta;
ck('sin antelacion minima, no cambia nada', JSON.stringify(filt) === JSON.stringify(calc));
const prepC = tel('cc_preparar.js', inp([{ json: guardia({ referencia: 'BN-1547-V', tipo_transaccion: 'compra',
  fecha: MARTES, hora: '17:00', modo: 'reserva', telefono: '+34600000001', nombre: 'Jaime' }) }]))[0].json;
const val = tel('cc_validar.js', inp([]), nod({ PrepararDatos: prepC }))[0].json;
ck('la cita se puede crear', val.puede_crear === true, val.respuesta?.motivo);
ck('mismo titulo que las del telefono (asi las encuentra por telefono)',
   val.titulo.startsWith('Visita inmueble - BN-1547-V') && val.titulo.includes('+34600000001'), val.titulo);

r = wa('aviso_cita.js', inp([{}]), nod({ ValidarAntesDeInsertar: val,
  Start: { resumen: 'Le gusta la terraza', conversacion_id: 1 },
  LeerCualificacion: { cualificacion: 'Lleva buscando: seis meses · Financiacion: hipoteca' } }))[0].json;
ck('el aviso de la cita va a Carmen con 3-agendada_ia', r.destinatario === 'Carmen' && r.etiqueta === '3-agendada_ia');
ck('es un aviso de PRE-RESERVA con lo que sabemos del cliente', r.accion === 'PRE-RESERVA'
   && r.resumen === 'Lleva buscando: seis meses · Financiacion: hipoteca · Le gusta la terraza', r.resumen);
const avPre = wa('aviso_preparar.js', inp([{ json: { ...r, cliente_telefono: '+34611111111' } }]))[0].json;
ck('el WhatsApp a Carmen le dice que llame para confirmarla', /PRE-RESERVA: llama al cliente para confirmarla/.test(avPre.aviso), avPre.aviso);
ck('la cita escrita como la lee una persona', /^martes \d+ de \w+ a las 17:00$/.test(r.cita), r.cita);

// ===========================================================================
console.log('\n== 10. Recordatorio de 24 h ==');
const desc = (extra) => [`Cliente: Jaime`, `Telefono: +34600000001`, `Referencia: BN-1547-V`, `Asesora: Carmen`,
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
ck('la ficha trae el enlace de la web', r.respuesta.includes('Enlace de la web (se lo puedes mandar): https://www.casagencia.com/inmueble/'));
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
// El caso real del 1-10-2026: "algo parecido pero mas barato" que el BN-1528-V (259.000)
const barato = wa('recomendar_similares.js', inp([{}]), nod({ ...hoja, Start: { referencia: 'BN-1528-V', precio_max: 258999 } }), true)[0].json;
const baratoFilas = (barato.referencias || []).map(ref => REAL.find(z => z.ref === ref));
ck('parecidos y mas baratos que el BN-1528-V: los hay', baratoFilas.length > 0 && baratoFilas.every(x => x.precio < 259000),
   baratoFilas.map(x => `${x.ref} ${x.precio}`).join(', '));
// Y si el modelo copia los datos del piso como filtros, ya no contesta "no hay nada"
r = buscar({ operacion: 'venta', municipio: 'Benicasim', zona: 'Pueblo', tipo: 'piso', habitaciones_min: 3,
             banos_min: 2, precio_max: 259000, superficie_min: 90, excluir: 'BN-1528-V' });
ck('buscar con filtros de mas: relaja los secundarios y lo dice', r.total > 0 && /quitando/.test(r.respuesta),
   (r.referencias || []).join(','));

// ===========================================================================
console.log('\n== 12. [WA] 4: cartera completa desde el feed de eGO ==');
const map = wa('cartera_mapear.js', inp([{ json: FEED }]))[0].json;
ck('con 3 inmuebles no se toca la tabla (feed sospechoso)', map.ok === false && map.total === 3);
const p1528 = map.filas.find(x => x.ref === 'BN-1528-V');
ck('descripcion ENTERA, no los 500 caracteres de la hoja del telefono', p1528.descripcion.length > 1500,
   p1528.descripcion.length + ' caracteres');
ck('la descripcion trae el parking y el trastero', /parking y trastero/.test(p1528.descripcion));
ck('y los honorarios de la agencia', /2 %/.test(p1528.descripcion) && /honorarios/.test(p1528.descripcion));
ck('enlace de la web con el id del feed sin el 05',
   p1528.enlace === 'https://www.casagencia.com/inmueble/piso-en-venta-benicasim/25370429', p1528.enlace);
ck('superficie sacada de las caracteristicas (el feed trae 0)', p1528.superficie === 103, String(p1528.superficie));
ck('caracteristicas en espanol y en singular', /1 plaza de garaje/.test(p1528.caracteristicas)
   && /ascensor/.test(p1528.caracteristicas) && !/highway|supermarket|good condition/.test(p1528.caracteristicas),
   p1528.caracteristicas);
ck('alquiler bien marcado', map.filas.find(x => x.ref === 'CS-1552-A').tipo_transaccion === 'alquiler');
const enteros = REAL.filter(x => x.enlace && /\/\d{6,}$/.test(x.enlace)).length;
ck('todos los inmuebles de la cartera tienen enlace', enteros === REAL.length, `${enteros} de ${REAL.length}`);
r = wa('plantilla_normalizar.js', inp([{ json: { enlace: 'https://www.casagencia.com/inmueble/x/25370429' } }]),
  nod({ Start: { telefono: '600112233', referencia: 'BN-1528-V', param2: 'ref. BN-1528-V' } }))[0].json;
ck('bienvenida sin enlace en el correo: lleva el de la web', r.param2 === 'https://www.casagencia.com/inmueble/x/25370429', r.param2);
r = wa('plantilla_normalizar.js', inp([{ json: { enlace: 'https://www.casagencia.com/inmueble/x/1' } }]),
  nod({ Start: { telefono: '600112233', referencia: 'BN-1528-V', param2: 'https://www.idealista.com/inmueble/9/' } }))[0].json;
ck('si el correo traia enlace del portal, manda ese', r.param2 === 'https://www.idealista.com/inmueble/9/', r.param2);

// ===========================================================================
console.log('\n== 13. Modo prueba (numeros de quien prueba) ==');
// El constructor rellena el hueco de PRUEBAS al desplegar; aqui con uno ficticio
const CFG_PRUEBA = CFG.replace(/\/\*PRUEBAS\*\/[\s\S]*?\/\*FIN_PRUEBAS\*\//,
  JSON.stringify({ telefonos: ['34600000009'], avisar_movil: '34600000009', avisar_email: 'prueba@ejemplo.com' }));
const waP = (f, $input, $) => correr(CFG_PRUEBA + '\n' + fs.readFileSync(B + 'wa/' + f, 'utf8'), $input, $);
r = waP('aviso_preparar.js', inp([{ json: { accion: 'VISITA AGENDADA', destinatario: 'Carmen', referencia: 'BN-1528-V',
  cliente_nombre: 'Prueba', cliente_telefono: '+34 600 000 009', resumen: 'test', conversacion_id: 1 } }]))[0].json;
ck('prueba: el WhatsApp del aviso va al que prueba, no a Carmen', r.meta_body.to === '34600000009', r.meta_body.to);
ck('prueba: el correo va al que prueba, no a Carmen ni a Paco', r.email_para === 'prueba@ejemplo.com', r.email_para);
ck('prueba: marcado [PRUEBA]', r.aviso.startsWith('[PRUEBA]') && r.email_asunto.startsWith('[PRUEBA]'));
ck('prueba: el texto sigue saludando a Carmen (es el aviso real)', r.meta_body.template.components[0].parameters[0].text === 'Carmen');
r = waP('aviso_preparar.js', inp([{ json: { accion: 'VISITA AGENDADA', destinatario: 'Carmen', referencia: 'BN-1528-V',
  cliente_telefono: '+34 611 111 111', resumen: 'test' } }]))[0].json;
ck('un cliente normal sigue avisando a Carmen', r.meta_body.to === '34654907386' && !r.aviso.startsWith('[PRUEBA]'));
ck('prueba: la guardia lo marca', waP('guardia_alquiler.js', inp([{ json: { referencia: 'BN-1528-V',
  tipo_transaccion: 'compra', telefono: '+34600000009', fecha: MARTES, hora: '17:00', modo: 'reserva' } }]))[0].json.es_prueba === true);
ck('sin numeros de prueba configurados nadie es prueba', wa('guardia_alquiler.js', inp([{ json: { referencia: 'BN-1528-V',
  tipo_transaccion: 'compra', telefono: '+34600000009', fecha: MARTES, hora: '17:00', modo: 'reserva' } }]))[0].json.es_prueba === false);
r = wa('cita_respuesta.js', inp([{}]), nod({ ValidarAntesDeInsertar: val, SimularReserva: { id: 'PRUEBA-sin-agenda', prueba: true },
  AvisarAlComercial: { mensaje_registrado: true } }))[0].json;
ck('prueba: la cita simulada se da por confirmada', r.cita_confirmada === true && r.prueba === true && r.evento_id === 'PRUEBA-sin-agenda');

// ===========================================================================
console.log('\n== 14. Cola de Redis: mensajes seguidos, repetidos y cruzados ==');
// Se reproduce [WA] 2 paso a paso con un Redis de mentira (incr, lpush,
// lrange, rpop) y el codigo REAL de los nodos. Cada "turno" es una ejecucion.
const redisFalso = () => {
  const kv = new Map();
  return {
    incr: k => { const v = (kv.get(k) || 0) + 1; kv.set(k, v); return v; },
    lpush: (k, v) => { const l = kv.get(k) || []; l.unshift(v); kv.set(k, l); },
    lrange: k => [...(kv.get(k) || [])],
    // como el nodo de n8n: RPOP y JSON.parse del valor
    rpop: k => { const l = kv.get(k) || []; const v = l.pop(); if (v === undefined) return null; try { return JSON.parse(v); } catch (e) { return v; } },
    largo: k => (kv.get(k) || []).length,
  };
};
const cuerpo = (id, content, extra = {}) => automatizacion({}, { id, content, created_at: 1790850000 + id, ...extra });
// Lo que guarda Chatwoot (para el rescate): el payload de la API de mensajes
const enChatwoot = (...ms) => ms.map(([id, content, tipo = 0, extra = {}]) =>
  ({ id, content, message_type: tipo, private: false, created_at: 1790850000 + id, attachments: [], ...extra }));
const turno = (R, body, texto) => {
  const e = wa('asistente_entrada.js', inp([{ json: { body } }]))[0].json;
  const t = { e, vivo: e.contestar, contesta: null };
  if (!t.vivo) return t;
  if (R.incr(e.clave_visto) !== 1) { t.vivo = false; t.repetido = true; return t; }     // ¿Es la primera vez?
  t.entrada = JSON.stringify({ id: e.mensaje_id, ts: e.creado, t: texto ?? e.contenido }); // Variable Mensaje
  t.push = () => { R.lpush(e.clave_buffer, t.entrada); return t; };                      // Push Redis
  t.despierta = (api = [], antesDeSacar = () => {}) => {                                 // tras Espera 60 segundos
    const lista = R.lrange(e.clave_buffer);                                              // Obtiene todos los Mensajes
    if (lista[0] !== t.entrada) return (t.contesta = false);                             // ¿Es el ultimo mensaje?
    antesDeSacar();
    const veces = wa('asistente_vaciar.js', inp([{}]), nod({ 'Obtiene todos los Mensajes': { message: lista } }));
    const sacados = veces.map(() => ({ entrada: R.rpop(e.clave_buffer) }));               // Saca los mensajes de Redis
    t.junto = wa('asistente_juntar.js', inp([{}]), nod({ EntradaMensaje: e, 'Saca los mensajes de Redis': sacados,
      'Obtiene todos los Mensajes': { message: lista }, MensajesDeLaConversacion: { payload: api } }))[0].json;
    return (t.contesta = true);
  };
  return t;
};
const quienes = (...ts) => ts.filter(t => t.contesta).length;

// a) Tres mensajes seguidos: contesta UNA vez, el ultimo, con los tres en orden
let R = redisFalso();
let a1 = turno(R, cuerpo(101, 'hola')).push(), a2 = turno(R, cuerpo(102, 'me interesa el piso')).push(),
    a3 = turno(R, cuerpo(103, 'el del centro')).push();
a1.despierta(); a2.despierta(); a3.despierta();
ck('tres seguidos: contesta una sola vez', quienes(a1, a2, a3) === 1 && a3.contesta === true);
ck('tres seguidos: con los tres, en orden', a3.junto.mensaje === 'hola\nme interesa el piso\nel del centro', JSON.stringify(a3.junto.mensaje));
ck('tres seguidos: la cola queda vacia', R.largo('wa:buffer:34600000001') === 0);

// b) Dos mensajes IGUALES seguidos ("ok", "ok"): con Blue el primer turno se
// creia el ultimo y contestaba antes de tiempo (y si los dos avisos llegan a la
// vez, contestaban los dos). Ahora cada entrada lleva su id: contesta el segundo
R = redisFalso();
let b1 = turno(R, cuerpo(201, 'ok')).push(), b2 = turno(R, cuerpo(202, 'ok')).push();
b1.despierta(); b2.despierta();
ck('"ok" + "ok": una sola respuesta', quienes(b1, b2) === 1 && b2.contesta === true);
ck('"ok" + "ok": no se pierde ninguno', b2.junto.mensaje === 'ok\nok', JSON.stringify(b2.junto.mensaje));

// c) Chatwoot avisa DOS veces del mismo mensaje: el segundo aviso se descarta
R = redisFalso();
let c1 = turno(R, cuerpo(301, 'quiero visitarlo')), c2 = turno(R, cuerpo(301, 'quiero visitarlo'));
ck('aviso repetido de Chatwoot: se descarta', c1.vivo === true && c2.repetido === true);
c1.push().despierta();
ck('aviso repetido: se contesta una vez', c1.contesta === true && c1.junto.numero_de_mensajes === 1);

// d) Carrera de Chatwoot: dos mensajes casi a la vez y los DOS avisos traen el
// ultimo (el 402). El 401 no llega por el webhook: se rescata de la conversacion
R = redisFalso();
let d1 = turno(R, cuerpo(402, 'el de la playa')), d2 = turno(R, cuerpo(402, 'el de la playa'));
ck('carrera: el segundo aviso (mismo mensaje) se descarta', d2.repetido === true);
d1.push().despierta(enChatwoot([400, 'Hola Jaime, soy Sara...', 1], [401, 'no me interesa ese'], [402, 'el de la playa']));
ck('carrera: se rescata el mensaje que Chatwoot no mando', d1.junto.mensaje === 'no me interesa ese\nel de la playa'
   && d1.junto.rescatados === 1, JSON.stringify(d1.junto.mensaje));

// e) El cliente escribe JUSTO cuando el ultimo turno esta vaciando la cola: con
// Blue (leer y borrar) ese mensaje se perdia; sacandolos uno a uno, entra en esta
// respuesta y su propio turno ya no contesta
R = redisFalso();
let e1 = turno(R, cuerpo(501, 'tiene garaje?')).push(), e2 = turno(R, cuerpo(502, 'y trastero?'));
e1.despierta([], () => e2.push());
e2.despierta();
ck('mensaje que entra mientras se vacia: no se pierde', e1.junto.mensaje === 'tiene garaje?\ny trastero?', JSON.stringify(e1.junto.mensaje));
ck('y no se contesta dos veces', quienes(e1, e2) === 1);

// f) Un audio y justo despues un texto: el audio tarda en transcribirse y entra
// en la cola DESPUES. Contesta el ultimo en entrar, y en el orden en que los mando
R = redisFalso();
let f2 = turno(R, cuerpo(602, 'es para el de la calle Mayor')).push();
let f1 = turno(R, cuerpo(601, '', { attachments: [{ file_type: 'audio', data_url: 'https://panel/a.ogg' }] }),
  '[nota de voz] quiero ver el piso el martes').push();
f2.despierta(); f1.despierta();
ck('audio + texto: una sola respuesta', quienes(f1, f2) === 1);
ck('audio + texto: en el orden en que los mando', f1.junto.mensaje === '[nota de voz] quiero ver el piso el martes\nes para el de la calle Mayor',
   JSON.stringify(f1.junto.mensaje));

// g) Lo que no se rescata: lo ya contestado y lo que es de un turno posterior
R = redisFalso();
let g1 = turno(R, cuerpo(705, 'y el precio?')).push();
g1.despierta(enChatwoot([700, 'hola'], [701, 'Hola, soy Sara', 1], [703, 'nota interna', 1, { private: true }],
  [705, 'y el precio?'], [706, 'otra cosa (de otro turno)']));
ck('rescate: ni lo ya contestado ni lo posterior', g1.junto.mensaje === 'y el precio?' && g1.junto.rescatados === 0,
   JSON.stringify(g1.junto.mensaje));

// ===========================================================================
console.log('\n== 15. Cada referencia: su asesora, su calendario y su horario ==');
// Toda la cartera real, con el mismo codigo que usa la agenda (el del telefono)
const resolver = Function('DateTime', CFG + '; return resolverAsesora;')(DateTime);
const CAL = { Carmen: 'carmen@casagencia.com', Gisela: 'gisela@casagencia.com' };
let sabado = DateTime.now().setZone('Europe/Madrid').plus({ days: 1 });
while (sabado.weekday !== 6 || FESTIVOS.TODOS.includes(sabado.toFormat('yyyy-MM-dd'))) sabado = sabado.plus({ days: 1 });
const SABADO = sabado.toFormat('yyyy-MM-dd');
const malas = [];
const huecoA = (ref, fecha, hora) => {
  const g = guardia({ referencia: ref, tipo_transaccion: 'compra', fecha, hora, modo: 'consulta',
                      telefono: '+34600000001', nombre: 'Prueba' });
  const pr = tel('bd_preparar.js', inp([{ json: g }]))[0].json;
  return tel('bd_calcular.js', inp([]), nod({ PrepararDatos: pr }))[0].json.respuesta;
};
const porAsesora = { Carmen: 0, Gisela: 0 };
for (const f of REAL) {
  const pref = f.ref.slice(0, 2);
  const esperada = { BN: 'Carmen', OR: 'Carmen', CS: 'Gisela', VR: 'Gisela' }[pref];
  if (!esperada) { malas.push(f.ref + ': prefijo sin asesora'); continue; }
  const aviso = resolver(f.ref, f.municipio);
  if (aviso.destinatario !== esperada) malas.push(`${f.ref}: los avisos irian a ${aviso.destinatario}`);
  if (f.tipo_transaccion !== 'venta') continue;          // en alquiler no se agenda
  const pc = tel('cc_preparar.js', inp([{ json: guardia({ referencia: f.ref, tipo_transaccion: 'compra',
    fecha: MARTES, hora: '17:00', modo: 'reserva', telefono: '+34600000001', nombre: 'Prueba' }) }]))[0].json;
  if (pc.asesora !== esperada || pc.calendario !== CAL[esperada])
    malas.push(`${f.ref}: la visita iria a ${pc.asesora} / ${pc.calendario}`);
  porAsesora[esperada]++;
  // Horarios: Carmen abre a las 9:30 y los sabados; Gisela abre a las 9:00 y no los sabados
  const sab = huecoA(f.ref, SABADO, '10:00'), nueve = huecoA(f.ref, MARTES, '09:00');
  if (esperada === 'Carmen' && !(sab.disponible && !nueve.disponible))
    malas.push(`${f.ref}: horario de Carmen mal (sabado ${sab.motivo}, 9:00 ${nueve.motivo})`);
  if (esperada === 'Gisela' && !(!sab.disponible && nueve.disponible))
    malas.push(`${f.ref}: horario de Gisela mal (sabado ${sab.motivo}, 9:00 ${nueve.motivo})`);
}
ck(`las ${REAL.length} referencias tienen asesora, y los avisos van a ella`, !malas.some(m => /prefijo|avisos/.test(m)), malas.join(' | '));
ck(`las de venta (${porAsesora.Carmen} de Carmen, ${porAsesora.Gisela} de Gisela) se agendan en SU calendario`,
   !malas.some(m => /visita iria/.test(m)), malas.join(' | '));
ck('y con SU horario (Carmen: sabado si y 9:00 no; Gisela: al reves)', !malas.some(m => /horario/.test(m)), malas.join(' | '));
ck('una referencia desconocida no se agenda en ningun calendario',
   huecoA('ZZ-0001-V', MARTES, '11:00').motivo === 'referencia_desconocida');

// ===========================================================================
console.log('\n== 16. Asignacion en el panel y avisos por WhatsApp ==');
const av = (j) => wa('aviso_preparar.js', inp([{ json: { accion: 'AVISO', cliente_telefono: '+34611111111',
  conversacion_id: 9, ...j } }]))[0].json;
ck('BN -> la conversacion para Carmen (agente 5)', av({ referencia: 'BN-1528-V' }).agente_id === 5);
ck('CS -> para Gisela (agente 4)', av({ referencia: 'CS-1479-A' }).agente_id === 4);
ck('VR -> para Gisela', av({ referencia: 'VR-1001-V' }).agente_id === 4);
ck('sin referencia: a quien va el aviso', av({ destinatario: 'Laurence' }).agente_id === 6);
ck('la referencia manda sobre el destinatario', av({ referencia: 'OR-1313-V', destinatario: 'Laurence' }).agente_id === 5);
ck('los avisos normales tambien por correo', av({ referencia: 'BN-1528-V' }).enviar_correo === true);
ck('el de una llamada, solo WhatsApp (el telefono ya manda su correo)',
   av({ accion: 'LLAMADA', destinatario: 'Carmen' }).enviar_correo === false);
r = wa('plantilla_normalizar.js', inp([{ json: {} }]), nod({ Start: { telefono: '600112233', referencia: 'CS-1479-A' } }))[0].json;
ck('bienvenida: la conversacion para la asesora de la referencia', r.asesora === 'Gisela' && r.agente_id === 4);
r = wa('cita_respuesta.js', inp([{}]), nod({ ValidarAntesDeInsertar: val, InsertarEnAgenda: { id: 'ev1' },
  AvisarAlComercial: { mensaje_registrado: true } }))[0].json;
ck('al cliente: NO esta confirmada hasta que le llame la asesora', /NO esta confirmada hasta que le llame Carmen/.test(r.respuesta), r.respuesta);
const afirm = Function('DateTime', CFG + '; return esAfirmativo;')(DateTime);
ck('"si, tengo que vender el mio" es un si; "no necesito" es un no',
   afirm('Sí, tengo que vender el mío') && afirm('primero tengo que vender') && !afirm('No') && !afirm('no necesito vender'));

console.log('\n== 17. Llamadas del telefono al panel ==');
const llamada = { call_id: 'call_x', direction: 'inbound', from_number: '+34600000002', to_number: '+34864893794',
  start_timestamp: DateTime.fromISO('2026-10-01T16:51:00', { zone: 'Europe/Madrid' }).toMillis(), duration_ms: 159000,
  disconnection_reason: 'agent_hangup', recording_url: 'https://x.cloudfront.net/rec.wav',
  transcript: 'Agent: Hola, soy Sara.\nUser: Hola, soy Ana Marti, llamo por el BN-1528-V.',
  call_analysis: { call_summary: 'Busco un piso de alquiler para dos personas.', user_sentiment: 'Positive',
                   custom_analysis_data: { asesora: 'Carmen' } } };
const leer = (c) => wa('llamada_preparar.js', inp([{}]), nod({ Start: { llamada: JSON.stringify(c) } }))[0].json;
r = leer(llamada);
ck('nota como en el panel de las otras agencias', r.nota ===
   'LLAMADA DE LA IA — Colgó la IA\nNos llamó · +34600000002 · 1/10 a las 16:51 · 2 min 39 s\n\n'
   + 'Busco un piso de alquiler para dos personas.\n\nTono del cliente: positivo\nAsesora: Carmen', JSON.stringify(r.nota));
ck('asignada a Carmen y con aviso por WhatsApp', r.agente_id === 5 && r.avisar === true && r.asesora === 'Carmen');
ck('con la grabacion', r.grabacion.endsWith('rec.wav'));
r = leer({ ...llamada, duration_ms: 5000, disconnection_reason: 'user_hangup', call_analysis: { call_summary: '' } });
ck('cuelga a los 5 s: al panel si, aviso no', r.avisar === false && /Colgó el cliente/.test(r.nota) && /Sin resumen/.test(r.nota));
r = wa('llamada_nombre.js', inp([{}]), nod({ LeerLlamada: leer(llamada),
  NombreEnLaTranscripcion: { choices: [{ message: { content: '{"nombre": "Ana Marti", "referencia": "bn-1528-v"}' } }] } }))[0].json;
ck('nombre y referencia de la transcripcion', r.nombre === 'Ana Marti' && r.referencia === 'BN-1528-V', r.nombre + ' ' + r.referencia);
r = wa('llamada_nombre.js', inp([{}]), nod({ LeerLlamada: leer(llamada), NombreEnLaTranscripcion: { error: 'x' } }))[0].json;
ck('si OpenAI falla: sin nombre, y sigue', r.nombre === '' && r.telefono_e164 === '+34600000002');

// ===========================================================================
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
