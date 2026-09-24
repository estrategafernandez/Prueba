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
  ['movil de Carmen',        T + via('654907386'),                      'Carmen',   /la IA de Carmen, asesora comercial/],
  ['movil de Gisela',        T + via('690027772'),                      'Gisela',   /la IA de Gisela, asesora comercial/],
  ['movil de Laurence',      T + via('618724192'),                      'Laurence', /la IA de Laurence, directora/],
  ['oficina de Benicassim',  T + via('964300986'),                      'oficina Benicassim', /oficina de Benicassim/],
  ['oficina de Castellon',   T + via('964742549'),                      'oficina Castellon',  /oficina de Castellón/],
  ['numero general',         T,                                         'general',  /^soy Sara, la IA de Casa Agencia$/],
  ['Idealista via Carmen',   T + via('654907386') + via('864870199'),   'Idealista', /^soy Sara, la IA de Casa Agencia$/],
  ['Fotocasa via Carmen',    T + via('654907386') + via('936060117'),   'Fotocasa',  /^soy Sara, la IA de Casa Agencia$/],
  ['portal 864870288 via Gisela', T + via('690027772') + via('864870288'), 'portal sin identificar', /^soy Sara, la IA de Casa Agencia$/],
];
for (const [nombre, div, linea, re] of casos) {
  const r = saludar(div, '+34643974353');
  ck(nombre, r.linea === linea && re.test(r.saludo), `${r.linea} | "${r.saludo.slice(0, 48)}"`);
}

console.log('\n== Lo que rompia antes ==');
let r = saludar(null, '+34643974353');
ck('sin cabecera de desvio -> saludo generico', /Casa Agencia/.test(r.saludo), r.linea);
r = saludar(T + via('999999999'), '+34643974353');
ck('numero que no es nuestro -> saludo generico', r.linea === 'desconocido' && /Casa Agencia/.test(r.saludo));
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

console.log('\n' + (fallos ? `*** ${fallos} FALLOS ***` : '*** TODO OK ***'));
process.exit(fallos ? 1 : 0);
