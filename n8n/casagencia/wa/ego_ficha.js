// [EGO][SUB] FichaCRM · Resumen
// Lo que dice eGO de un inmueble, para Sara y para el aviso de la pre-reserva:
//   - el ESTADO (Disponible, Reservado, Vendido, Alquilado, Retirado...);
//   - las LLAVES: si la agencia tiene un llavero dado de alta para el inmueble;
//   - las FICHAS DE VISITA: cuantas hechas y programadas, con interes, y los
//     puntos positivos y negativos (internos: Sara no se los cuenta al cliente);
//   - la comercial que lo lleva en eGO.
// Comprobado con la API: CheckRealestateReference da el id de eGO (0 si no
// existe), GetRealestate el estado y ListRealestateKeyGroup los llaveros.
const ref = String($('Start').first().json.referencia || '').toUpperCase().trim();
const datos = (n) => { try { return $(n).first().json?.datos ?? null; } catch (e) { return null; } };
const id = Number(datos('IdDeEgo') || 0);
const inm = id ? (datos('Inmueble') || {}) : {};
const llaveros = id ? [].concat(datos('Llaves') || []).filter(g => g && String(g.realestateId) === String(id)) : [];
const fichas = id ? [].concat(datos('FichasDeVisita') || []).filter(v => v && v.realestateId == id) : [];

const estadoId = Number(inm.realestateStatusId || 0);
const estado = EGO_ESTADOS[estadoId] || (estadoId ? `estado ${estadoId}` : '');
// null = no se sabe (no esta en eGO o eGO no ha contestado): manda la cartera de la web
const disponible = estadoId ? estadoId === EGO_DISPONIBLE : null;

// Movimiento 1 = SAIDA (las llaves han salido de la agencia)
const enLaAgencia = llaveros.filter(g => Number(g.realestateKeyMovementTypeId || 0) !== 1);
const tieneLlaves = enLaAgencia.length > 0;
const llaves = tieneLlaves ? `en la agencia (${enLaAgencia.map(g => String(g.name || '').trim()).filter(Boolean).join(', ') || 'llavero'})`
  : llaveros.length ? 'han salido de la agencia' : 'no constan en eGO';

const ahora = DateTime.now().setZone(ZONA).toFormat("yyyy-MM-dd'T'HH:mm:ss");
const hechas = fichas.filter(v => String(v.date || '') < ahora && !v.notAttended);
const programadas = fichas.filter(v => String(v.date || '') >= ahora);
const texto = (p) => typeof p === 'string' ? p : String(p?.name ?? p?.description ?? p?.text ?? '');
const puntos = (campo) => [...new Set(hechas.flatMap(v => [].concat(v[campo] || []).map(texto)).map(s => s.trim()).filter(Boolean))];
const positivos = puntos('positivePoints');
const negativos = puntos('negativePoints');
const interesados = hechas.filter(v => v.interested === true).length;
const comercial = EGO_COMERCIALES[inm.assignToSecurityUserId] || '';

const lineas = !id ? [`${ref} no aparece en eGO. Guiate por la ficha de la cartera.`] : [
  `Inmueble ${ref} en eGO:`,
  `- Estado: ${estado || 'sin estado'}` + (disponible === false
    ? '. NO esta disponible: no ofrezcas visita; diselo con tacto y recomiendale otros con recomendarSimilares.'
    : ''),
  `- Llaves: ${llaves}` + (!tieneLlaves && disponible !== false
    ? (LLAVES_OBLIGATORIAS ? '. No cierres visita: avisa a la asesora para que lo coordine con el propietario.'
       : '. Puedes ofrecer la visita igual: la asesora la coordina con el propietario.')
    : ''),
  // Las fichas de visita son internas: Sara las usa para saber, no para contarlas
  `- Visitas (INTERNO, no se lo cuentes al cliente): ${hechas.length} hechas` +
    `${interesados ? ` (${interesados} con interes)` : ''}, ${programadas.length} programadas`,
  positivos.length ? `- Lo que ha gustado (INTERNO): ${positivos.slice(0, 5).join(' / ')}` : '',
  negativos.length ? `- Lo que no ha gustado (INTERNO): ${negativos.slice(0, 5).join(' / ')}` : '',
].filter(Boolean);

return [{ json: {
  encontrado: !!id,
  ego_id: id || null,
  referencia: ref,
  estado,
  disponible,
  tiene_llaves: tieneLlaves,
  llaves,
  visitas_hechas: hechas.length,
  visitas_programadas: programadas.length,
  interesados,
  puntos_positivos: positivos,
  puntos_negativos: negativos,
  comercial,
  // Una linea para el aviso de la pre-reserva a la asesora
  para_la_asesora: id ? `eGO: ${estado || 'sin estado'} · llaves ${llaves}` : '',
  respuesta: lineas.join('\n'),
} }];
