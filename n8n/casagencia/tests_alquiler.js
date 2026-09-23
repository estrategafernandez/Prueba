const { DateTime } = require('luxon'); const fs = require('fs');
const B = '/home/user/Prueba/n8n/casagencia/';
const LIB = fs.readFileSync(B + 'lib/casagencia_comun.js', 'utf8');
function run(f, $input, $) {
  return Function('DateTime','$input','$','"use strict";'+LIB+'\n'+fs.readFileSync(B+'nodes/'+f,'utf8'))(DateTime,$input,$);
}
const inp = a => ({ first: () => a[0], all: () => a });
const nod = m => n => ({ first: () => ({ json: m[n] }), item: { json: m[n] }, all: () => [{ json: m[n] }] });
let f=0; const ck=(n,c,e='')=>{console.log((c?'  OK   ':'  FALLA')+'  '+n+(e?'  -> '+e:''));if(!c)f++;};

const esAlq = Function('DateTime', LIB + '; return esPeticionAlquiler;')(DateTime);
console.log('== Que cuenta como peticion de alquiler ==');
ck('CS-1479-A + alquiler', esAlq('CS-1479-A','alquiler') === true);
ck('CS-1479-A sin tipo (sufijo -A)', esAlq('CS-1479-A','') === true);
ck('BN-1541-V marcado alquiler (el traspaso)', esAlq('BN-1541-V','alquiler') === true);
ck('BN-1547-V + compra -> NO es alquiler', esAlq('BN-1547-V','compra') === false);
ck('OR-1313-V + venta -> NO es alquiler', esAlq('OR-1313-V','venta') === false);
ck('referencia vacia + compra -> NO', esAlq('','compra') === false);

console.log('\n== El calendario rechaza los alquileres ==');
const base = { nombre:'X', telefono:'600111222', fecha:'2026-09-24', hora:'11:00' };
for (const [ref,tipo,debeRechazar] of [
    ['CS-1479-A','alquiler',true], ['BN-1541-V','alquiler',true],
    ['BN-1547-V','compra',false], ['OR-1313-V','compra',false]]) {
  const body = {...base, referencia:ref, tipo_transaccion:tipo};
  const prep = run('bd_preparar.js', inp([{json:{body}}]))[0].json;
  const r = run('bd_calcular.js', inp([]), nod({PrepararDatos:prep}))[0].json.respuesta;
  const rechazado = r.motivo === 'alquiler_sin_agenda';
  ck(`disponibilidad ${ref} (${tipo})`, rechazado === debeRechazar, `motivo=${r.motivo}`);

  const pc = run('cc_preparar.js', inp([{json:{body}}]))[0].json;
  const v = run('cc_validar.js', inp([]), nod({PrepararDatos:pc}))[0].json;
  const rech2 = v.puede_crear === false && v.respuesta.motivo === 'alquiler_sin_agenda';
  ck(`confirmar cita ${ref} (${tipo})`, rech2 === debeRechazar, `motivo=${(v.respuesta||{}).motivo || 'crea la cita'}`);
}

console.log('\n== El aviso a la asesora ==');
const lead = { body: { nombre:'Ana', telefono:'600111222', destinatario:'Gisela',
  tipo_llamada:'lead_alquiler', motivo:'Interesada en CS-1479-A',
  resumen_conversacion:'Llama por el piso de Maestro Falla 37.',
  alquiler_personas:'3', alquiler_ingresos:'nomina indefinida', alquiler_mascotas:'un perro pequeno',
  alquiler_entrada:'1 de noviembre', alquiler_duracion:'todo el ano' } };
let r = run('rm_componer.js', inp([{json:lead}]))[0].json;
ck('va a Gisela y copia a Paco', r.para === 'gisela@casagencia.com, paco@casagencia.com', r.para);
ck('asunto marca LEAD ALQUILER', r.asunto.startsWith('LEAD ALQUILER (sin agendar)'), r.asunto.slice(0,60));
ck('el cuerpo trae la cualificacion', ['3','nomina indefinida','un perro pequeno','1 de noviembre','todo el ano']
   .every(v => r.cuerpo.includes(v)));
ck('avisa de que la IA no agendo', r.cuerpo.includes('no agenda la visita'));
console.log('\n--- correo que le llega a Gisela ---');
console.log(r.cuerpo.split('\n').map(l=>'    '+l).join('\n'));

const normal = { body: { nombre:'Luis', telefono:'600999888', destinatario:'Carmen',
  tipo_llamada:'derivacion_asesora', motivo:'Quiere que le llamen', resumen_conversacion:'Pide info.' } };
r = run('rm_componer.js', inp([{json:normal}]))[0].json;
ck('\nun aviso normal no lleva cualificacion', !r.cuerpo.includes('CUALIFICACIÓN'));
ck('asunto normal sin prefijo', !r.asunto.includes('LEAD ALQUILER'), r.asunto);
const raro = { body: { destinatario:'Pepito', telefono:'600', motivo:'x', resumen_conversacion:'y' } };
r = run('rm_componer.js', inp([{json:raro}]))[0].json;
ck('destinatario desconocido -> Laurence', r.destinatario === 'Laurence', r.para);

console.log('\n'+(f?`*** ${f} FALLOS ***`:'*** TODO OK ***'));
process.exit(f?1:0);
