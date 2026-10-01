// [EGO][SUB] FichaCRM · Resumen
// Lo que dice el CRM de un inmueble, para Sara y para decidir si se ofrece
// visita: si sigue disponible, si la agencia tiene las llaves, como fueron las
// visitas anteriores (puntos positivos y negativos) y quien lo lleva.
const ref = String($('Start').first().json.referencia || '').toUpperCase();
const datos = (n) => { try { return $(n).first().json?.datos ?? null; } catch (e) { return null; } };
const inm = datos('Inmueble') || {};
const estados = datos('Estados') || [];
const llaves = [].concat(datos('Llaves') || []);
const visitas = [].concat(datos('FichasDeVisita') || []).filter(v => v && !v.cancelled);

const estado = String((estados.find(e => String(e.id) === String(inm.realestateStatusId)) || {}).name || '');
const disponible = !estado || /disponible|activ|publicad|available/i.test(estado);

// Llaves: el campo hasKey del inmueble y, si hay movimientos, el ultimo
const ultimo = llaves.slice().sort((a, b) => String(b.date || b.dateCreated).localeCompare(String(a.date || a.dateCreated)))[0];
const tieneLlaves = inm.hasKey === true || (inm.hasKey == null && !!ultimo);

const puntos = (campo) => visitas.map(v => String(v[campo] || '').trim()).filter(Boolean);
const positivos = puntos('positivePoints');
const negativos = puntos('negativePoints');
const interesados = visitas.filter(v => v.interested === true).length;

const lineas = [
  `Inmueble ${ref || inm.reference || ''} en el CRM:`,
  `- Estado: ${estado || 'sin estado'}${disponible ? '' : ' (NO esta disponible: no lo ofrezcas)'}`,
  `- Llaves: ${tieneLlaves ? 'las tiene la agencia (se puede ofrecer visita)' : 'la agencia NO tiene las llaves: no cierres visita, avisa a la asesora para que lo coordine con el propietario'}`,
  // Las fichas de visita son internas: Sara las usa para saber, no para contarlas
  visitas.length ? `- Visitas anteriores (INTERNO, no se lo cuentes al cliente): ${visitas.length} (${interesados} con interes)` : '- Visitas anteriores: ninguna registrada',
  positivos.length ? `- Lo que ha gustado: ${positivos.slice(0, 5).join(' / ')}` : '',
  negativos.length ? `- Lo que no ha gustado: ${negativos.slice(0, 5).join(' / ')}` : '',
].filter(Boolean);

return [{ json: {
  encontrado: !!inm.id,
  referencia: ref,
  estado,
  disponible,
  tiene_llaves: tieneLlaves,
  visitas: visitas.length,
  interesados,
  puntos_positivos: positivos,
  puntos_negativos: negativos,
  comercial_id: inm.assignToSecurityUserId ?? inm.securityUserId ?? null,
  respuesta: inm.id ? lineas.join('\n') : `No encuentro ${ref} en el CRM de eGO.`,
} }];
