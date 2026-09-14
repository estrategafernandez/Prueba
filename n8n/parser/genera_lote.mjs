import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { parsearListado, BASE } = require('./ceballos_parser.js');

const LISTADOS = [
  { operacion:'COMPRA',   provincia:'Guadalajara', ruta:'BuyProperties/19',  oper:'compra',   prov:'19' },
  { operacion:'COMPRA',   provincia:'Madrid',      ruta:'BuyProperties/28',  oper:'compra',   prov:'28' },
  { operacion:'ALQUILER', provincia:'Guadalajara', ruta:'RentProperties/19', oper:'alquiler', prov:'19' },
  { operacion:'ALQUILER', provincia:'Madrid',      ruta:'RentProperties/28', oper:'alquiler', prov:'28' },
];
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const inmuebles = []; let totalWeb = 0;
for (const L of LISTADOS) {
  const url = `${BASE}/es-ES/Content/${L.ruta}?pagina=1&rows=500&orden=&dirorden=desc&ref=`
            + `&operacion=${L.oper}&tipoinm=ALL&provincia=${L.prov}&munic=0&zona=0`
            + `&precio1=&precio2=&habit1=&habit2=&superf1=&superf2=&banos1=&banos2=`;
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const r = parsearListado(html, L);
  console.error(`${L.operacion} ${L.provincia}: totalWeb=${r.totalWeb} filas=${r.inmuebles.length}`);
  if (r.totalWeb !== r.inmuebles.length) console.error('  !! DESCUADRE');
  totalWeb += r.totalWeb; inmuebles.push(...r.inmuebles);
}
console.error(`TOTAL totalWeb=${totalWeb} filas=${inmuebles.length}`);
fs.writeFileSync(process.argv[2], JSON.stringify(inmuebles));
fs.writeFileSync(process.argv[2].replace('.json','_total.txt'), String(totalWeb));
