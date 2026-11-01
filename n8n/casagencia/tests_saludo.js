// Comprueba que cada numero de Casagencia da el saludo que le toca.
// Las cadenas de desvio son las que aparecen de verdad en las llamadas.
const { DateTime } = require('luxon'); const fs = require('fs');
const B = __dirname + '/';
const SRC = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8') + '\n' +
            fs.readFileSync(B + 'nodes/sal_datos.js', 'utf8');

const T = '<sip:+34864893794@twilio.com>;reason=unconditional';
const via = (n) => `, <sip:+34${n}@10.233.35.132;user=phone>;reason=unknown;counter=1`;

function saludar(diversion, from) {
  const $input = { first: () => ({ json: { body: { call_inbound: {
    from_number: from, to_number: '+34864893794',
    custom_sip_headers: diversion === null ? {} : { diversion } } } } }) };
  return Function('DateTime', '$input', '"use strict";' + SRC)(DateTime, $input)[0].json;
}

let fallos = 0;
const ck = (n, c, e = '') => { console.log((c ? '  OK   ' : '  FALLA') + '  ' + n + (e ? '  -> ' + e : '')); if (!c) fallos++; };

console.log('== Cada movil da su saludo ==');
const casos = [
  ['movil de Carmen',        T + via('654907386'),                      'Carmen',   /^soy Sara, ia de Carmen, asesora comercial de casa agencia$/],
  ['movil de Gisela',        T + via('690027772'),                      'Gisela',   /^soy Sara, ia de Gisela, asesora comercial de casa agencia$/],
  ['movil de Laurence',      T + via('618724192'),                      'Laurence', /^soy Sara, ia de Laurence, directora de casa agencia/],
  ['oficina de Benicassim',  T + via('964300986'),                      'oficina Benicassim', /^soy Sara, ia de la oficina de Benicassim$/],
  ['oficina de Castellon',   T + via('964742549'),                      'oficina Castellon',  /^soy Sara, ia de la oficina de Castellón$/],
  ['numero general',         T,                                         'general',  /^soy Sara, ia de casa agencia$/],
  ['Idealista via Carmen',   T + via('654907386') + via('864870199'),   'Idealista', /^soy Sara, ia de casa agencia$/],
  ['Fotocasa via Carmen',    T + via('654907386') + via('936060117'),   'Fotocasa',  /^soy Sara, ia de casa agencia$/],
  ['portal 864870288 via Gisela', T + via('690027772') + via('864870288'), 'portal sin identificar', /^soy Sara, ia de casa agencia$/],
];
for (const [nombre, div, linea, re] of casos) {
  const r = saludar(div, '+34643974353');
  ck(nombre, r.linea === linea && re.test(r.saludo), `${r.linea} | "${r.saludo.slice(0, 48)}"`);
}

console.log('\n== Como se presenta ==');
{
  const todos = ['654907386', '690027772', '618724192', '964300986', '964742549', '864893794',
                 '864870199', '936060117', '864870288'].map(n => saludar(T + via(n), '+34643974353').saludo)
                 .concat(saludar(null, '+34643974353').saludo);
  ck('nunca dice "la ia" (sin articulo delante)', todos.every(s => !/\bla ia\b/i.test(s)),
     todos.find(s => /\bla ia\b/i.test(s)) || '');
  // Paco (01/11): escrito "IA" la voz lo decia como una sigla, muy marcado
  ck('"ia" siempre en minusculas: ningun saludo dice "IA"', todos.every(s => !/\bIA\b/.test(s)),
     todos.find(s => /\bIA\b/.test(s)) || '');
  ck('siempre se presenta como "Sara, ia de ..."', todos.every(s => /^soy Sara, ia de /.test(s)),
     todos.find(s => !/^soy Sara, ia de /.test(s)) || '');
  ck('y "casa agencia" separado, como se pronuncia', todos.every(s => !/Casagencia/i.test(s)),
     todos.find(s => /Casagencia/i.test(s)) || '');
}

console.log('\n== Lo que rompia antes ==');
let r = saludar(null, '+34643974353');
ck('sin cabecera de desvio -> saludo generico', /^soy Sara, ia de casa agencia$/.test(r.saludo), r.linea);
r = saludar(T + via('999999999'), '+34643974353');
ck('numero que no es nuestro -> saludo generico', r.linea === 'desconocido' && /^soy Sara, ia de casa agencia$/.test(r.saludo));
r = saludar(T + via('654907386'), '+34643974353');
ck('Carmen NO da el saludo de Gisela', !/Gisela/.test(r.saludo));

console.log('\n== La linea de portal recuerda por quien entro ==');
r = saludar(T + via('654907386') + via('864870199'), '+34643974353');
ck('Idealista entra por Carmen', r.es_portal === true && r.linea_comercial === 'Carmen', `${r.linea_comercial}`);
r = saludar(T + via('690027772') + via('864870288'), '+34643974353');
ck('el portal desconocido entra por Gisela', r.es_portal === true && r.linea_comercial === 'Gisela');
r = saludar(T + via('654907386'), '+34643974353');
ck('una llamada directa no es de portal', r.es_portal === false);

console.log('\n== El telefono del cliente ==');
r = saludar(T, '+34643974353');
ck('se dice agrupado', r.telefono_cliente_hablado === '643 97 43 53', r.telefono_cliente_hablado);
ck('y se guarda en E.164', r.telefono_cliente === '+34643974353');
r = saludar(T, '+13057663918');
ck('un numero extranjero no se rompe', r.telefono_cliente === '+13057663918', r.telefono_cliente_hablado);
r = saludar(T, '');
ck('sin numero de origen no revienta', r.telefono_cliente === '' && !!r.saludo);

console.log('\n== Cuanto espera para saludar (la IA "no contestaba") ==');
// 30/10 10:36, desvio del movil de Carmen: el cliente dijo "¿Si? Dime" en el
// silencio de 3,5 s, le tapo el saludo y Sara estuvo 10 s callada. Colgaron.
r = saludar(T + via('654907386'), '+34618724192');
ck('linea directa (movil de Carmen): saluda enseguida, sin dejar hueco', r.espera_saludo_ms === 800, r.espera_saludo_ms);
ck('las oficinas y el numero general tambien', saludar(T + via('964300986'), '+34643974353').espera_saludo_ms === 800
   && saludar(T, '+34643974353').espera_saludo_ms === 800);
ck('llamada directa sin desvio: tambien enseguida', saludar(null, '+34643974353').espera_saludo_ms === 800);
r = saludar(T + via('654907386') + via('864870199'), '+34653646898');
ck('portal (Idealista): espera 3,5 s para no pisar su aviso grabado', r.espera_saludo_ms === 3500, r.espera_saludo_ms);
ck('Fotocasa y el portal sin identificar, igual',
   saludar(T + via('654907386') + via('936060117'), '+34643974353').espera_saludo_ms === 3500
   && saludar(T + via('690027772') + via('864870288'), '+34643974353').espera_saludo_ms === 3500);
ck('un numero desviado que no conocemos podria ser un portal: espera larga',
   saludar(T + via('999999999'), '+34643974353').espera_saludo_ms === 3500);

console.log('\n== Lo que se le contesta a Retell ==');
// Formato documentado de Retell: TODO dentro de call_inbound. Si algo no vale,
// Retell puede rechazar la llamada: aqui se fija la forma exacta.
r = saludar(T + via('654907386'), '+34643974353');
const resp = JSON.parse(JSON.stringify(r.respuesta));
ck('todo va dentro de call_inbound y nada mas', Object.keys(resp).join() === 'call_inbound'
   && Object.keys(resp.call_inbound).sort().join() === 'agent_override,dynamic_variables',
   Object.keys(resp.call_inbound).join());
ck('las variables del saludo de siempre', resp.call_inbound.dynamic_variables.saludovariable === r.saludo
   && resp.call_inbound.dynamic_variables.telefono_cliente === '+34643974353'
   && resp.call_inbound.dynamic_variables.telefono_cliente_hablado === '643 97 43 53');
ck('y la espera, solo para esta llamada (un entero entre 0 y 5000)',
   Object.keys(resp.call_inbound.agent_override).join() === 'agent'
   && Object.keys(resp.call_inbound.agent_override.agent).join() === 'begin_message_delay_ms'
   && Number.isInteger(resp.call_inbound.agent_override.agent.begin_message_delay_ms)
   && resp.call_inbound.agent_override.agent.begin_message_delay_ms >= 0
   && resp.call_inbound.agent_override.agent.begin_message_delay_ms <= 5000);
const wfS = JSON.parse(fs.readFileSync(B + 'workflows/SaludoInicial.json', 'utf8'));
const resp2 = wfS.nodes.find(n => n.name === 'Respond to Webhook').parameters.responseBody;
ck('el webhook contesta ese objeto tal cual (JSON valido siempre)', resp2 === '={{ JSON.stringify($json.respuesta) }}', resp2);

console.log('\n' + (fallos ? `*** ${fallos} FALLOS ***` : '*** TODO OK ***'));
process.exit(fallos ? 1 : 0);
