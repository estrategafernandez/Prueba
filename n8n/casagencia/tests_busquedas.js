const { DateTime } = require('luxon');
const fs = require('fs');
const B = '/home/user/Prueba/n8n/casagencia/';
const LIB = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8');
function run(fname, $input, $) {
  const src = LIB + '\n' + fs.readFileSync(B + 'nodes/' + fname, 'utf8');
  return Function('DateTime','$input','$','"use strict";'+src)(DateTime,$input,$);
}
const inputOf = (a) => ({ first: () => a[0], all: () => a });
const nodeOf = (m) => (n) => ({ first: () => ({ json: m[n] }), item: { json: m[n] } });
let fallos=0; const check=(n,c,e='')=>{console.log((c?'  OK   ':'  FALLA')+'  '+n+(e?'  -> '+e:''));if(!c)fallos++;};

// Filas como las que hay hoy en la hoja Inmuebles (sin columna direccion)
const filas = [
  { ref:'CS-1479-A', municipio:'Castellón de la Plana / Castelló de la Plana', zona:'Este', tipo_inmueble:'Piso',
    habitaciones:4, precio:1000, tipo_transaccion:'alquiler',
    descripcion:'CASAGENCIA ALQUILA fantástico y espacioso piso de cuatro habitaciones. En muy buena zona, cerca de la plaza Fadrell y a 10 minutos andando al centro.' },
  { ref:'CS-1531-V', municipio:'Castellón de la Plana / Castelló de la Plana', zona:'Oeste', tipo_inmueble:'Piso',
    habitaciones:5, precio:315000, tipo_transaccion:'venta',
    descripcion:'Vivienda en zona consolidada de Castellón, cerca de la avenida Valencia. Cinco habitaciones.' },
  { ref:'BN-1547-V', municipio:'Benicasim / Benicàssim', zona:'Pueblo', tipo_inmueble:'Piso',
    habitaciones:3, precio:178000, tipo_transaccion:'venta',
    descripcion:'Piso en el centro del pueblo de Benicasim, junto a la calle Santo Tomás.' },
];
const dir = (texto, extra={}) => run('dir_emparejar.js', inputOf(filas.map(f=>({json:f}))),
  nodeOf({ Webhook: { body: { direccion: texto, ...extra } } })
)[0].json.respuesta;

console.log('\n== Busqueda por direccion (#5) ==');
let r = dir('plaza Fadrell');
check('"plaza Fadrell" encuentra CS-1479-A', r.encontrado && r.coincidencias[0].ref === 'CS-1479-A', JSON.stringify(r.coincidencias?.map(c=>c.ref)));
r = dir('calle Santo Tomás 12, Benicasim');
check('"calle Santo Tomás" encuentra BN-1547-V', r.encontrado && r.coincidencias[0].ref === 'BN-1547-V', JSON.stringify(r.coincidencias?.map(c=>c.ref)));
r = dir('calle del Mestre Falla 39', { municipio:'Castellón de la Plana / Castelló de la Plana' });
check('"Mestre Falla 39" (el del reclamo) -> NO encontrado, sin listado', r.encontrado === false && r.motivo === 'sin_coincidencias');
console.log('     mensaje: ' + r.mensaje_para_sara.slice(0,110) + '...');
r = dir('avenida Valencia', { operacion:'venta' });
check('"avenida Valencia" + operacion venta', r.encontrado && r.coincidencias[0].ref === 'CS-1531-V', JSON.stringify(r.coincidencias?.map(c=>c.ref)));
check('"calle" a secas NO devuelve nada', dir('calle').encontrado === false);
// una columna direccion futura debe mandar sobre la descripcion
const conDir = filas.map(f => f.ref==='CS-1479-A' ? {...f, direccion:'Calle Mestre Falla 39'} : f);
r = run('dir_emparejar.js', inputOf(conDir.map(f=>({json:f}))), nodeOf({ Webhook:{ body:{ direccion:'Mestre Falla 39' } } }))[0].json.respuesta;
check('si algun dia hay columna "direccion", se usa sola', r.encontrado && r.coincidencias[0].ref === 'CS-1479-A' && r.fiabilidad === 'alta');

console.log('\n== Consultar cita por telefono (nuevo) ==');
const norm = run('tel_normalizar.js', inputOf([{ json:{ body:{ telefono:'643 97 43 53' } } }]))[0].json;
check('normaliza a nacional para la busqueda q', norm.telefono_nacional === '643974353', norm.telefono_nacional);
const eventos = [
  { json:{ summary:'Visita inmueble - CS-1479-A // Cliente: Mohan // Telefono Cliente: +34643974353',
           description:'Tel-busqueda: 643974353\nReferencia: CS-1479-A',
           start:{dateTime:'2026-09-24T16:00:00+02:00'}, end:{dateTime:'2026-09-24T17:00:00+02:00'} } },
  { json:{ summary:'Visita inmueble - BN-1547-V // Cliente: Otro // Telefono Cliente: +34600111222',
           start:{dateTime:'2026-09-25T10:00:00+02:00'}, end:{dateTime:'2026-09-25T11:00:00+02:00'} } },
];
r = run('tel_formatear.js', inputOf(eventos), nodeOf({ NormalizarTelefono: norm }))[0].json.respuesta;
check('encuentra solo la cita de ese telefono', r.encontrado && r.total === 1 && r.citas[0].referencia === 'CS-1479-A', JSON.stringify(r.citas));
check('deduce la asesora del evento', r.citas[0].asesora === 'Gisela');
console.log('     mensaje: ' + r.mensaje_para_sara);
const norm2 = run('tel_normalizar.js', inputOf([{ json:{ body:{ telefono:'600111999' } } }]))[0].json;
r = run('tel_formatear.js', inputOf(eventos), nodeOf({ NormalizarTelefono: norm2 }))[0].json.respuesta;
check('telefono sin citas -> encontrado=false', r.encontrado === false && r.motivo === 'sin_citas');

console.log('\n' + (fallos ? `*** ${fallos} FALLOS ***` : '*** TODOS LOS TESTS OK ***'));
process.exit(fallos?1:0);
