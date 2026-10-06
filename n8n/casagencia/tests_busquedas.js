const { DateTime } = require('luxon');
const fs = require('fs');
const B = '/home/user/Prueba/n8n/casagencia/';
const LIB = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8');
function run(fname, $input, $) {
  const src = LIB + '\n' + fs.readFileSync(B + 'nodes/' + fname, 'utf8');
  return Function('DateTime','$input','$','"use strict";'+src)(DateTime,$input,$);
}
const inputOf = (a) => ({ first: () => a[0], all: () => a });
const nodeOf = (m) => (n) => {
  if (!(n in m)) throw new Error('el test no simula el nodo ' + n);
  const v = m[n];
  const items = Array.isArray(v) ? v.map(j => ({ json: j })) : [{ json: v }];
  return { first: () => items[0], item: items[0], all: () => items };
};
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
const dir = (texto, extra={}, direcciones=[]) => run('dir_emparejar.js',
  inputOf(filas.map(f=>({json:f}))),
  nodeOf({ Webhook: { body: { direccion: texto, ...extra } },
           LeerInmuebles: filas,
           LeerDirecciones: direcciones })
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
r = run('dir_emparejar.js', inputOf(conDir.map(f=>({json:f}))),
  nodeOf({ Webhook:{ body:{ direccion:'Mestre Falla 39' } },
           LeerInmuebles: conDir, LeerDirecciones: [] }))[0].json.respuesta;
check('si algun dia hay columna "direccion", se usa sola', r.encontrado && r.coincidencias[0].ref === 'CS-1479-A' && r.fiabilidad === 'alta');

// La pestana "Direcciones" es la que se rellena a mano (y la que se cargo con
// las 93 calles de eGO): tiene que mandar sobre la descripcion.
r = dir('Mestre Falla 39', {}, [{ ref:'CS-1479-A', direccion:'Calle Maestro Falla 37' }]);
check('la pestana Direcciones manda',
  r.encontrado && r.coincidencias[0].ref === 'CS-1479-A' && r.fiabilidad === 'alta',
  JSON.stringify(r.coincidencias?.map(c=>c.ref)) + ' fiabilidad=' + r.fiabilidad);

// Retell manda los datos dentro de "args" ({ call, name, args }): antes llegaba
// la direccion vacia en TODAS las llamadas reales ("consulta_vacia").
r = run('dir_emparejar.js', inputOf(filas.map(f=>({json:f}))),
  nodeOf({ Webhook: { body: { call: { call_id: 'x' }, name: 'buscarPorDireccion', args: { direccion: 'plaza Fadrell' } } },
           LeerInmuebles: filas, LeerDirecciones: [] }))[0].json.respuesta;
check('peticion de Retell (args dentro): encuentra la calle', r.encontrado && r.coincidencias[0].ref === 'CS-1479-A', r.motivo || '');
// Calle que cruza dos municipios (llamada del 2-10): el cliente dice Benicassim
// y el piso de esa avenida esta en El Grao de Castellon
const avenida = [
  { ref:'BN-1540-V', municipio:'Benicasim / Benicàssim', zona:'Heliópolis', tipo_inmueble:'Apartamento', habitaciones:5, precio:770000, tipo_transaccion:'venta', descripcion:'' },
  { ref:'CS-1561-V', municipio:'Castellón de la Plana / Castelló de la Plana', zona:'El Grao', tipo_inmueble:'Apartamento', habitaciones:1, precio:165000, tipo_transaccion:'venta', descripcion:'' },
  { ref:'CS-1531-V', municipio:'Castellón de la Plana / Castelló de la Plana', zona:'Oeste', tipo_inmueble:'Piso', habitaciones:5, precio:315000, tipo_transaccion:'venta', descripcion:'cerca de la avenida Valencia' },
];
const dirsAv = [{ ref:'BN-1540-V', direccion:'Avenida Ferrandis Salvador, 140' }, { ref:'CS-1561-V', direccion:'Avenida Ferrandis Salvador, 52' }];
r = run('dir_emparejar.js', inputOf(avenida.map(f=>({json:f}))),
  nodeOf({ Webhook: { body: { args: { direccion: 'avenida Ferrandis Salvador 56', municipio: 'Benicasim / Benicàssim', operacion: 'venta' } } },
           LeerInmuebles: avenida, LeerDirecciones: dirsAv }))[0].json.respuesta;
const refsAv = (r.coincidencias || []).map(c => c.ref);
check('calle entre dos municipios: salen los dos de la avenida (tambien el de El Grao)',
  r.encontrado && refsAv.includes('BN-1540-V') && refsAv.includes('CS-1561-V') && !refsAv.includes('CS-1531-V'), JSON.stringify(refsAv));
r = run('dir_emparejar.js', inputOf(avenida.map(f=>({json:f}))),
  nodeOf({ Webhook: { body: { args: { direccion: 'avenida Valencia', municipio: 'Benicasim / Benicàssim' } } },
           LeerInmuebles: avenida, LeerDirecciones: dirsAv }))[0].json.respuesta;
check('pero el municipio sigue filtrando lo que solo casa por la descripcion', !(r.coincidencias || []).some(c => c.ref === 'CS-1531-V') || r.encontrado === false,
  JSON.stringify((r.coincidencias || []).map(c => c.ref)));

console.log('\n== Consultar cita por telefono (nuevo) ==');
const norm = run('tel_normalizar.js', inputOf([{ json:{ body:{ telefono:'643 97 43 53' } } }]))[0].json;
check('normaliza a nacional para la busqueda q', norm.telefono_nacional === '643974353', norm.telefono_nacional);
const normR = run('tel_normalizar.js', inputOf([{ json:{ body:{ call:{}, name:'buscarCitaPorTelefono', args:{ telefono:'643 97 43 53' } } } }]))[0].json;
check('peticion de Retell (args dentro): tambien normaliza el telefono', normR.telefono_nacional === '643974353' && normR.telefono_valido, normR.telefono_nacional);
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

console.log('\n== Telefono · buscarInmuebles: alquiler anual o temporal y presupuesto ==');
{
  const HOJA = JSON.parse(fs.readFileSync(B + 'tests_datos/wa_cartera_20261001.json', 'utf8'));
  // Lo que hay hoy en wa_cartera.modalidad (sale de eGO)
  const MOD = { 'BN-1291-A':'larga_duracion', 'BN-1347-A':'larga_duracion', 'BN-1463-A':'larga_duracion',
    'BN-1541-V':'larga_duracion', 'BN-1542-A':'temporal', 'BN-1549-A':'temporal', 'BN-1555-A':'larga_duracion',
    'BN-1559-A':'larga_duracion', 'BN-632-A':'temporal', 'BN-C-119-A':'larga_duracion', 'BN-C-122-A':'temporal',
    'BN-C-126-A':'temporal', 'CS-1071-A':'larga_duracion', 'CS-1248-A':'larga_duracion', 'CS-1449-A':'larga_duracion',
    'CS-1552-A':'larga_duracion', 'CS-1554-A':'larga_duracion', 'CS-G-272-A':'larga_duracion',
    'CS-G-277-A':'larga_duracion', 'CS-G-387-A':'larga_duracion', 'CS-G-399-A':'larga_duracion', 'OR-1494-A':'temporal' };
  const PG = Object.entries(MOD).map(([ref, modalidad]) => ({ ref, modalidad }));
  const BEN = 'Benicasim / Benicàssim';
  const bi = (body, pg = PG) => run('bi_filtrar.js', inputOf([]),
    nodeOf({ Webhook: { body }, BuscarInmuebles: HOJA, ModalidadCartera: pg }))[0].json.result;
  const refs = (t) => [...t.matchAll(/referencia ([A-Z0-9-]+)/g)].map(m => m[1]);

  let t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 800, modalidad: 'larga_duracion' });
  check('anual hasta 800 en Benicasim: ningun temporal', refs(t).length > 0 && refs(t).every(x => MOD[x] === 'larga_duracion'), refs(t).join());
  check('presupuesto no excluyente: el de 1.000 sale, marcado POR ENCIMA', /BN-1291-A[^|]*POR ENCIMA DE SU PRESUPUESTO/.test(t), refs(t).join());
  check('pero no el de 5.500 ni el de 2.000', !refs(t).includes('BN-1555-A') && !refs(t).includes('BN-1559-A'), refs(t).join());
  check('dice que es de larga duracion y el precio al mes', /larga duración, para todo el año/.test(t) && /1\.?000€ al mes/.test(t));
  check('a quien busca casa no le salen locales (aunque le den igual las habitaciones)', !/Local comercial|Bar|Office/.test(t), refs(t).join());

  t = bi({ municipio: 'Castellón de la Plana / Castelló de la Plana', operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 1100, modalidad: 'larga_duracion', tipo: 'vivienda' });
  const op1 = t.slice(t.indexOf('Opción 1:')).split(' | ')[0];
  check('primero los que caben en su presupuesto, luego los que se pasan', !/POR ENCIMA/.test(op1) && /POR ENCIMA/.test(t.slice(t.indexOf('Opción 2:'))), refs(t).join());

  t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 0, modalidad: 'indiferente', tipo: 'local' });
  check('pidiendo local: solo locales', refs(t).length > 0 && refs(t).every(x => /Local|Bar|Office/.test(HOJA.find(f => f.ref === x).tipo_inmueble)), refs(t).join());
  t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 0, modalidad: 'indiferente', tipo: 'garaje' });
  check('pidiendo garaje donde no hay: no le ofrece pisos', /No he encontrado/.test(t) && refs(t).length === 0, t.slice(0, 80));
  const soloLocales = HOJA.filter(f => /Local/.test(f.tipo_inmueble));
  t = run('bi_filtrar.js', inputOf([]), nodeOf({ Webhook: { body: { municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0 } },
    BuscarInmuebles: soloLocales, ModalidadCartera: PG }))[0].json.result;
  check('herramienta antigua (sin tipo) y sin viviendas: ensena lo que haya', refs(t).length > 0, refs(t).join());

  t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 0, modalidad: 'temporal' });
  check('temporal: solo temporales, dicho asi', refs(t).length > 0 && refs(t).every(x => MOD[x] === 'temporal')
    && /alquiler temporal, por meses de invierno/.test(t) && !/larga duración/.test(t), refs(t).join());

  t = bi({ municipio: 'Oropesa del Mar / Orpesa', operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 0, modalidad: 'larga_duracion' });
  check('sin anuales en Oropesa: lo dice y avisa de que hay uno temporal', /No hay ningún alquiler de larga duración/.test(t)
    && /Sí hay 1 de alquiler temporal/.test(t) && /No inventes/.test(t), t.slice(0, 160));

  t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 300, modalidad: 'larga_duracion' });
  check('nada ni con margen: los mas economicos, diciendo que se pasan', /No hay nada por debajo de 300€/.test(t) && refs(t).length > 0, refs(t).join());

  t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 3, precio_min: 0, precio_max: 0, modalidad: 'indiferente' });
  check('indiferente: anuales y temporales', refs(t).some(x => MOD[x] === 'temporal') && refs(t).some(x => MOD[x] === 'larga_duracion'), refs(t).join());

  // Como antes: venta, sin los campos nuevos (herramienta antigua de Retell)
  t = bi({ municipio: BEN, operacion: 'venta', habitaciones: 3, precio_min: 0 });
  const filasV = HOJA.filter(f => f.tipo_transaccion === 'venta' && f.municipio === BEN && Number(f.habitaciones) >= 3);
  const esperadas = filasV.sort((a, b) => (Number(a.precio) || Infinity) - (Number(b.precio) || Infinity)).slice(0, 5).map(f => f.ref);
  check('venta sin presupuesto: igual que antes (los 5 mas economicos)', refs(t).join() === esperadas.join()
    && new RegExp(`He encontrado ${filasV.length} inmuebles`).test(t), refs(t).join() + ' / ' + esperadas.join());
  check('en venta no pone modalidad ni "al mes"', !/larga duración|temporal|al mes/.test(t));
  t = bi({ municipio: BEN, operacion: 'venta', habitaciones: 0, precio_min: 200000 });
  check('precio_min sigue funcionando ("he visto uno de 200.000")', refs(t).length > 0 &&
    refs(t).every(x => Number(HOJA.find(f => f.ref === x).precio) >= 200000), refs(t).join());

  t = bi({ args: { municipio: BEN, operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 800, modalidad: 'larga_duracion' } });
  check('datos dentro de "args": tambien', refs(t).includes('BN-1291-A') && refs(t).every(x => MOD[x] === 'larga_duracion'), refs(t).join());

  t = bi({ municipio: BEN, operacion: 'alquiler', habitaciones: 3, precio_min: 0, precio_max: 0, modalidad: 'larga_duracion' }, [{ error: 'sin conexion' }]);
  check('sin base de datos: la modalidad sale de la descripcion', refs(t).includes('BN-1291-A') && !refs(t).includes('BN-632-A'), refs(t).join());

  t = bi({ municipio: 'Torreblanca', operacion: 'alquiler', habitaciones: 0, precio_min: 0, precio_max: 0, modalidad: 'larga_duracion' });
  check('sin resultados: responde (nunca vacio)', /No hay ningún alquiler de larga duración/.test(t), t.slice(0, 100));

  const reglas = (f, ini) => { const src = fs.readFileSync(B + f, 'utf8'); const i = src.indexOf(ini);
    return [...src.slice(i, i + 900).matchAll(/if \((\/.*?\/)\.test\(d\)\) return '(\w+)'/g)].map(m => m[1] + m[2]).join('\n'); };
  const rTel = reglas('nodes/bi_filtrar.js', 'function modalidadPorDescripcion');
  check('la deduccion por la descripcion es la misma que en WhatsApp',
    rTel && rTel.split('\n').length === 3 && rTel === reglas('wa/cartera.js', 'function modalidadAlquiler'));
}

console.log('\n' + (fallos ? `*** ${fallos} FALLOS ***` : '*** TODOS LOS TESTS OK ***'));
process.exit(fallos?1:0);
