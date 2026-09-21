const { DateTime } = require('luxon');
const fs = require('fs');
const B = '/home/user/Prueba/n8n/casagencia/';
const LIB = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8');

// Ejecuta un nodo Code simulando el entorno de n8n
function run(bodyOrItems, fname, extra = {}) {
  const src = LIB + '\n' + fs.readFileSync(B + 'nodes/' + fname, 'utf8');
  const ctx = { DateTime, $input: extra.$input, $: extra.$ };
  return Function('DateTime', '$input', '$', '"use strict";' + src)(DateTime, extra.$input, extra.$);
}
const inputOf = (arr) => ({ first: () => arr[0], all: () => arr });
const nodeOf = (m) => (name) => ({ first: () => ({ json: m[name] }), item: { json: m[name] } });

let fallos = 0;
const check = (nombre, cond, extra='') => {
  console.log((cond ? '  OK   ' : '  FALLA') + '  ' + nombre + (extra ? '  -> ' + extra : ''));
  if (!cond) fallos++;
};

// ---------- 1. Telefonos ----------
console.log('\n== Normalizacion de telefonos (#12) ==');
const tel = Function('DateTime', LIB + '; return normalizarTelefono;')(DateTime);
check('"0015210321145" (el de la llamada del reclamo)', tel('0015210321145').e164 === '+15210321145', tel('0015210321145').e164);
check('"69 63 09 195" con espacios', tel('69 63 09 195').e164 === '+34696309195', tel('69 63 09 195').e164);
check('"643974353" espanol sin prefijo', tel('643974353').e164 === '+34643974353', tel('643974353').e164);
check('"+34 624 72 42 01" ya en E164', tel('+34 624 72 42 01').e164 === '+34624724201', tel('+34 624 72 42 01').e164);
check('"1234" demasiado corto -> invalido', tel('1234').valido === false);

// ---------- 2. Routing de asesora ----------
console.log('\n== Routing de asesora (#7) ==');
const res = Function('DateTime', LIB + '; return resolverAsesora;')(DateTime);
for (const [ref, esp] of [['CS-1479-A','Gisela'],['BN-1547-V','Carmen'],['OR-1313-V','Carmen'],['VR-10','Gisela'],['BN-G-342-A','Carmen']])
  check(`${ref} -> ${esp}`, res(ref).asesora === esp, res(ref).asesora);
check('XX-999 (prefijo desconocido) -> NO cae en Gisela', res('XX-999').conocida === false && res('XX-999').asesora === null);
check('referencia vacia -> no revienta', res('').conocida === false);

// ---------- 3. El caso del reclamo ----------
console.log('\n== EL CASO DEL RECLAMO: jueves 24/09 a las 14:30, CS-1479-A (Gisela) ==');
const body = { nombre:'Mohan Madanova', telefono:'0015210321145', referencia:'CS-1479-A',
               tipo_transaccion:'alquiler', fecha:'2026-09-24', hora:'14:30' };
const prep = run(null, 'bd_preparar.js', { $input: inputOf([{ json: { body } }]) })[0].json;
check('asesora resuelta = Gisela', prep.asesora === 'Gisela');
check('telefono normalizado', prep.telefono_e164 === '+15210321145', prep.telefono_e164);

const r1 = run(null, 'bd_calcular.js', { $input: inputOf([]), $: nodeOf({ PrepararDatos: prep }) })[0].json.respuesta;
check('14:30 YA NO es disponible', r1.disponible === false, `motivo=${r1.motivo}`);
check('motivo = fuera_horario', r1.motivo === 'fuera_horario');
check('propone alternativas reales', r1.alternativas.length === 3, JSON.stringify(r1.alternativas.map(a=>a.hora)));
console.log('     mensaje: ' + r1.mensaje_para_sara);

// segundo cortafuegos
const prepC = run(null, 'cc_preparar.js', { $input: inputOf([{ json: { body } }]) })[0].json;
const v1 = run(null, 'cc_validar.js', { $input: inputOf([]), $: nodeOf({ PrepararDatos: prepC }) })[0].json;
check('ConfirmarCita RECHAZA insertar', v1.puede_crear === false, `motivo=${v1.respuesta.motivo}`);
check('respuesta trae cita_confirmada=false', v1.respuesta.cita_confirmada === false);

// ---------- 4. Franjas validas / invalidas ----------
console.log('\n== Validacion de franjas ==');
const casos = [
  ['2026-09-24','13:00','CS-1479-A',true ,'13:00 Gisela: la visita cabe hasta las 14:00'],
  ['2026-09-24','13:30','CS-1479-A',false,'13:30 Gisela: la visita se saldria de las 14:00'],
  ['2026-09-24','14:30','CS-1479-A',false,'14:30 Gisela: PAUSA COMIDA  <-- el reclamo'],
  ['2026-09-24','16:00','CS-1479-A',true ,'16:00 Gisela: tarde'],
  ['2026-09-24','18:30','BN-1547-V',true ,'18:30 Carmen: cierra a las 19:30'],
  ['2026-09-24','19:00','BN-1547-V',false,'19:00 Carmen: no cabe la hora'],
  ['2026-09-26','11:00','BN-1547-V',true ,'sabado 11:00 Carmen: SI abre'],
  ['2026-09-26','11:00','CS-1479-A',false,'sabado 11:00 Gisela: NO abre'],
  ['2026-09-27','11:00','BN-1547-V',false,'domingo: cerrado'],
  ['2026-10-09','11:00','CS-1479-A',false,'9 de octubre: FESTIVO'],
  ['2026-10-12','11:00','BN-1547-V',false,'12 de octubre: FESTIVO'],
  ['2026-09-14','11:00','CS-1479-A',false,'fecha pasada'],
];
for (const [f,h,ref,esp,desc] of casos) {
  const p = run(null,'bd_preparar.js',{ $input: inputOf([{ json:{ body:{...body, fecha:f, hora:h, referencia:ref} } }]) })[0].json;
  const r = run(null,'bd_calcular.js',{ $input: inputOf([]), $: nodeOf({ PrepararDatos: p }) })[0].json.respuesta;
  check(desc, r.disponible === esp, `disponible=${r.disponible} motivo=${r.motivo}`);
}

// ---------- 5. Eventos de dia completo (#8) ----------
console.log('\n== Eventos de dia completo (#8) ==');
const ev = (s) => ({ json: s });
const pC = run(null,'bd_preparar.js',{ $input: inputOf([{ json:{ body:{...body, fecha:'2026-11-12', hora:'17:00', referencia:'BN-1547-V'} } }]) })[0].json;
const cumple = [ev({ summary:'Cumpleanos de Pepe', start:{date:'2026-11-12'}, end:{date:'2026-11-13'} })];
const vaca   = [ev({ summary:'VACACIONES',        start:{date:'2026-11-12'}, end:{date:'2026-11-13'} })];
const reu    = [ev({ summary:'Reunion', start:{dateTime:'2026-11-12T17:00:00+01:00'}, end:{dateTime:'2026-11-12T18:00:00+01:00'} })];
const libre  = [ev({ summary:'Recordatorio', transparency:'transparent', start:{dateTime:'2026-11-12T17:00:00+01:00'}, end:{dateTime:'2026-11-12T18:00:00+01:00'} })];
const rr = (items) => run(null,'bd_calcular.js',{ $input: inputOf(items), $: nodeOf({ PrepararDatos: pC }) })[0].json.respuesta;
check('un cumpleanos NO bloquea el dia entero', rr(cumple).disponible === true);
check('"VACACIONES" SI bloquea el dia entero', rr(vaca).disponible === false, `motivo=${rr(vaca).motivo}`);
check('una reunion a esa hora bloquea la hora', rr(reu).disponible === false);
check('evento marcado "Libre" no bloquea', rr(libre).disponible === true);

console.log('\n' + (fallos ? `*** ${fallos} FALLOS ***` : '*** TODOS LOS TESTS OK ***'));
process.exit(fallos ? 1 : 0);
