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

// Las fechas se calculan a partir de HOY. Con fechas fijas los tests se caducan
// solos: en cuanto pasa el dia, todo contesta 'pasado' y deja de probar nada.
const FESTIVOS = Function('DateTime', LIB + '; return FESTIVOS;')(DateTime);
const HOY = DateTime.now().setZone('Europe/Madrid').startOf('day');
const AYER = HOY.minus({ days: 1 }).toFormat('yyyy-MM-dd');
function proximo(diaSemana) {           // 4 = jueves, 6 = sabado, 7 = domingo
  let d = HOY.plus({ days: 1 });
  for (let i = 0; i < 40; i++) {
    const f = d.toFormat('yyyy-MM-dd');
    if (d.weekday === diaSemana && !FESTIVOS.TODOS.includes(f)) return f;
    d = d.plus({ days: 1 });
  }
  throw new Error('no encuentro un ' + diaSemana + ' libre');
}
const JUEVES = proximo(4), SABADO = proximo(6), DOMINGO = proximo(7);
// Los dos primeros festivos futuros que caen en dia de semana: en fin de semana
// el motivo seria 'cerrado' y no probariamos el festivo.
const [FESTIVO1, FESTIVO2] = FESTIVOS.TODOS
  .filter(f => {
    const d = DateTime.fromFormat(f, 'yyyy-MM-dd', { zone: 'Europe/Madrid' });
    return d > HOY && d.weekday <= 5;
  }).slice(0, 2);
console.log(`(fechas de prueba: jueves ${JUEVES}, sabado ${SABADO}, domingo ${DOMINGO}, `
  + `festivos ${FESTIVO1} y ${FESTIVO2})`);

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
// CS-1479-A es un ALQUILER: desde el cambio de septiembre salta antes la regla de
// "en alquiler no se agenda" que la del horario. Las dos lo paran.
check('motivo = alquiler_sin_agenda', r1.motivo === 'alquiler_sin_agenda', r1.motivo);
console.log('     mensaje: ' + r1.mensaje_para_sara);

// La misma hora en una referencia de COMPRA de Gisela: aqui el que tiene que
// hablar es el horario, y tiene que ofrecer alternativas de verdad.
const bodyCompra = { ...body, referencia: 'CS-1479-V', tipo_transaccion: 'compra',
                     fecha: JUEVES, hora: '14:30' };
const prepV = run(null, 'bd_preparar.js', { $input: inputOf([{ json: { body: bodyCompra } }]) })[0].json;
const r1v = run(null, 'bd_calcular.js', { $input: inputOf([]), $: nodeOf({ PrepararDatos: prepV }) })[0].json.respuesta;
check('en compra 14:30 cae en la pausa de comida', r1v.disponible === false, `motivo=${r1v.motivo}`);
check('motivo = fuera_horario', r1v.motivo === 'fuera_horario', r1v.motivo);
check('propone alternativas reales', r1v.alternativas.length === 3, JSON.stringify(r1v.alternativas.map(a=>a.hora)));

// segundo cortafuegos
const prepC = run(null, 'cc_preparar.js', { $input: inputOf([{ json: { body } }]) })[0].json;
const v1 = run(null, 'cc_validar.js', { $input: inputOf([]), $: nodeOf({ PrepararDatos: prepC }) })[0].json;
check('ConfirmarCita RECHAZA insertar', v1.puede_crear === false, `motivo=${v1.respuesta.motivo}`);
check('respuesta trae cita_confirmada=false', v1.respuesta.cita_confirmada === false);

// ---------- 4. Franjas validas / invalidas ----------
console.log('\n== Validacion de franjas ==');
const casos = [
  [JUEVES,'13:00','CS-1479-V',true ,'13:00 Gisela: la visita cabe hasta las 14:00'],
  [JUEVES,'13:30','CS-1479-V',false,'13:30 Gisela: la visita se saldria de las 14:00'],
  [JUEVES,'14:30','CS-1479-V',false,'14:30 Gisela: PAUSA COMIDA  <-- el reclamo'],
  [JUEVES,'16:00','CS-1479-V',true ,'16:00 Gisela: tarde'],
  [JUEVES,'18:30','BN-1547-V',true ,'18:30 Carmen: cierra a las 19:30'],
  [JUEVES,'19:00','BN-1547-V',false,'19:00 Carmen: no cabe la hora'],
  [SABADO,'11:00','BN-1547-V',true ,'sabado 11:00 Carmen: SI abre'],
  [SABADO,'11:00','CS-1479-V',false,'sabado 11:00 Gisela: NO abre'],
  [DOMINGO,'11:00','BN-1547-V',false,'domingo: cerrado'],
  [FESTIVO1,'11:00','CS-1479-V',false,`festivo ${FESTIVO1}`],
  [FESTIVO2,'11:00','BN-1547-V',false,`festivo ${FESTIVO2}`],
  [AYER,'11:00','CS-1479-V',false,'fecha pasada'],
];
for (const [f,h,ref,esp,desc] of casos) {
  const p = run(null,'bd_preparar.js',{ $input: inputOf([{ json:{ body:{...bodyCompra, fecha:f, hora:h, referencia:ref} } }]) })[0].json;
  const r = run(null,'bd_calcular.js',{ $input: inputOf([]), $: nodeOf({ PrepararDatos: p }) })[0].json.respuesta;
  check(desc, r.disponible === esp, `disponible=${r.disponible} motivo=${r.motivo}`);
}

// ---------- 5. Eventos de dia completo (#8) ----------
console.log('\n== Eventos de dia completo (#8) ==');
const ev = (s) => ({ json: s });
const DIA_SIGUIENTE = DateTime.fromFormat(JUEVES, 'yyyy-MM-dd', { zone: 'Europe/Madrid' })
  .plus({ days: 1 }).toFormat('yyyy-MM-dd');
const pC = run(null,'bd_preparar.js',{ $input: inputOf([{ json:{ body:{...bodyCompra, fecha:JUEVES, hora:'17:00', referencia:'BN-1547-V'} } }]) })[0].json;
const cumple = [ev({ summary:'Cumpleanos de Pepe', start:{date:JUEVES}, end:{date:DIA_SIGUIENTE} })];
const vaca   = [ev({ summary:'VACACIONES',        start:{date:JUEVES}, end:{date:DIA_SIGUIENTE} })];
const reu    = [ev({ summary:'Reunion', start:{dateTime:`${JUEVES}T17:00:00+02:00`}, end:{dateTime:`${JUEVES}T18:00:00+02:00`} })];
const libre  = [ev({ summary:'Recordatorio', transparency:'transparent', start:{dateTime:`${JUEVES}T17:00:00+02:00`}, end:{dateTime:`${JUEVES}T18:00:00+02:00`} })];
const rr = (items) => run(null,'bd_calcular.js',{ $input: inputOf(items), $: nodeOf({ PrepararDatos: pC }) })[0].json.respuesta;
check('un cumpleanos NO bloquea el dia entero', rr(cumple).disponible === true);
check('"VACACIONES" SI bloquea el dia entero', rr(vaca).disponible === false, `motivo=${rr(vaca).motivo}`);
check('una reunion a esa hora bloquea la hora', rr(reu).disponible === false);
check('evento marcado "Libre" no bloquea', rr(libre).disponible === true);

console.log('\n' + (fallos ? `*** ${fallos} FALLOS ***` : '*** TODOS LOS TESTS OK ***'));
process.exit(fallos ? 1 : 0);
