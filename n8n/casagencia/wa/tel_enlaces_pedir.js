// [TEL] EnviarPorWhatsApp · LeerPeticion
// Sara (teléfono) pide que le mandemos al cliente los enlaces de los inmuebles
// de los que acaban de hablar. Aqui solo se LEE la peticion: las referencias que
// ha dicho y el telefono al que mandarlo. Los enlaces NO los pone ella: se
// buscan despues en wa_cartera (el nodo BuscarEnlaces), para que nunca se mande
// una direccion inventada.
const peticion = ($('Webhook').first().json.body) ?? {};
const body = (peticion.args && typeof peticion.args === 'object') ? peticion.args : peticion;

// Las referencias pueden llegar como lista o como texto ("BN-1543-V y CS-397-V")
const refs = [...new Set([].concat(body.referencias ?? body.referencia ?? [])
  .flatMap(r => String(r ?? '').split(/[,;/|]| y | and /i))
  .map(r => r.trim().toUpperCase().replace(/[^A-Z0-9-]/g, ''))
  .filter(r => r.length >= 3))].slice(0, ENLACES_TELEFONO.max);

const tel = normalizarTelefono(body.telefono);
const nombre = String(body.nombre ?? '').trim();
const idioma = TEXTOS_ENLACES_TEL[String(body.idioma ?? '').trim().toLowerCase()] ? String(body.idioma).trim().toLowerCase() : 'es';

const motivos = [];
if (!refs.length) motivos.push('sin_referencias');
if (!tel.valido) motivos.push('telefono_invalido');

return [{ json: {
  refs,
  // Para la consulta: sin guiones y separadas por comas, que es como se comparan
  // en wa_cartera (BN-1543-V y BN1543V son la misma referencia)
  refs_sql: refs.map(r => r.replace(/-/g, '')).join(',') || '-',
  telefono_e164: tel.e164,
  telefono_wa: tel.wa_id,
  nombre,
  idioma,
  puede: motivos.length === 0,
  motivos,
} }];
