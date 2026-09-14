import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { parsearListado } = require('./ceballos_parser.js');

const DIR = process.argv[2];
const CASOS = [
  ['BuyProperties_19',  'COMPRA',   'Guadalajara', 141],
  ['BuyProperties_28',  'COMPRA',   'Madrid',        2],
  ['RentProperties_19', 'ALQUILER', 'Guadalajara',  46],
  ['RentProperties_28', 'ALQUILER', 'Madrid',        1],
];
let fallos = 0;
const todos = [];
for (const [f, op, pv, esperadoPag1] of CASOS) {
  const html = fs.readFileSync(`${DIR}/${f}.html`, 'utf8');
  const r = parsearListado(html, { operacion: op, provincia: pv });
  todos.push(...r.inmuebles);
  const n = r.inmuebles.length;
  // estas fixtures son la pagina 1 (15 filas) salvo que el total sea menor
  const esperado = Math.min(15, esperadoPag1);
  const ok = n === esperado && r.totalWeb === esperadoPag1;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${f.padEnd(18)} totalWeb=${r.totalWeb} filas=${n} (esperadas ${esperado})`);
}
// fixture completa de 141 filas (rows=300)
const full = parsearListado(fs.readFileSync(`${DIR}/test_rows.html`, 'utf8'), { operacion:'COMPRA', provincia:'Guadalajara' });
const okFull = full.inmuebles.length === 141 && full.totalWeb === 141;
if (!okFull) fallos++;
console.log(`${okFull ? 'OK  ' : 'FALLA'} ${'test_rows (rows=300)'.padEnd(18)} totalWeb=${full.totalWeb} filas=${full.inmuebles.length} (esperadas 141)`);

console.log('\n--- muestra ---');
console.log(JSON.stringify(full.inmuebles[0], null, 1));
const sinPrecio = full.inmuebles.filter(i => i.precio === null);
const sinRef    = full.inmuebles.filter(i => !i.referencia);
const sinTipo   = full.inmuebles.filter(i => !i.tipo);
console.log(`\nsin precio: ${sinPrecio.length} · sin referencia: ${sinRef.length} · sin tipo: ${sinTipo.length}`);
console.log('tipos distintos:', [...new Set(full.inmuebles.map(i=>i.tipo))].length);
console.log('acentos OK:', full.inmuebles.some(i => /[áéíóúñ²]/i.test(JSON.stringify(i))) ? 'sí' : 'NO');
process.exit(fallos ? 1 : 0);
