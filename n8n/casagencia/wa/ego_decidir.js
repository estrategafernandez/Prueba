// [WA] 5 · Leads de eGO · Decidir
// Un item por lead nuevo. Con el estado de su inmueble en eGO (GetRealestate,
// en el mismo orden) y la cartera publicada en la web (el enlace):
//   - disponible (estado 2 en eGO) -> bienvenida_compra / _alquiler con el enlace;
//   - reservado, vendido, alquilado, retirado... -> plantilla_abierta: ya no
//     esta disponible y Sara le ensena otros;
//   - la comercial que puso eGO y la que toca por la referencia (BN/OR Carmen,
//     CS/VR Gisela), para comprobar que coinciden.
const nuevos = $('SoloNuevos').all();
let inmuebles = [];
try { inmuebles = $('EstadoDelInmueble').all(); } catch (e) { inmuebles = []; }
let cartera = [];
try { cartera = $('LaCartera').first().json.filas || []; } catch (e) { cartera = []; }
if (typeof cartera === 'string') { try { cartera = JSON.parse(cartera); } catch (e) { cartera = []; } }
const porRef = Object.fromEntries([].concat(cartera).map(c => [String(c.ref || '').toUpperCase(), c]));

return nuevos.map((n, k) => {
  const b = n.json;
  const r = inmuebles[k]?.json || {};
  const inm = r.ok && r.datos && typeof r.datos === 'object' ? r.datos : {};
  const c = porRef[b.referencia] || {};
  const estadoId = Number(inm.realestateStatusId || 0);
  const estado = EGO_ESTADOS[estadoId] || (estadoId ? `estado ${estadoId}` : '');
  // Lo dice eGO; si eGO no ha contestado, que siga publicado en la web
  const disponible = !b.referencia ? null : (estadoId ? estadoId === EGO_DISPONIBLE : !!c.ref);
  const tel = normalizarTelefono(b.telefono);
  const alquiler = esAlquiler(b.referencia, b.operacion);
  const d = decidirPrimerMensaje({
    tipo: alquiler ? 'alquiler' : 'compra',
    referencia: b.referencia,
    disponible,
    // Si no esta en la web, la bienvenida lleva la referencia en vez del enlace
    enlace: c.enlace || (b.referencia ? `ref. ${b.referencia}` : ''),
    operacion: b.operacion,
    nombre: b.nombre,
    idioma: idiomaDe(b.mensaje),
    municipio: c.municipio || '',
  });
  const asignadoEgo = b.asignado_ids.map(id => EGO_COMERCIALES[id]).filter(Boolean)[0]
    || String(b.asignado_nombres[0] || '').split(' ')[0];
  const porReferencia = resolverAsesora(b.referencia, c.municipio).destinatario;
  return { json: {
    ...d,
    lead_id: b.lead_id,
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    se_puede_contactar: tel.valido,
    // Se manda de verdad solo con MODO_LEADS = 'real' (o a un telefono de prueba)
    enviar: tel.valido && !!d.plantilla && leadsEnReal(tel.e164),
    nombre: b.nombre,
    email_cliente: b.email,
    referencia: b.referencia,
    enlace: c.enlace || '',
    portal: b.portal,
    solicitud: b.solicitud,
    tipo: alquiler ? 'alquiler' : 'compra',
    estado_inmueble: estado || (c.ref ? 'publicado en la web' : 'sin datos'),
    disponible,
    // eGO no crea contacto con los leads de los portales (potencialClientId vacio)
    contacto_creado: false,
    asignado_ego: asignadoEgo,
    asesora_por_referencia: porReferencia,
    asignacion_coincide: !asignadoEgo || asignadoEgo === porReferencia,
    notas: `Lead de eGO (${b.solicitud || b.portal}): ${b.mensaje || b.obs}`.slice(0, 1500),
    asunto: b.solicitud,
  }, pairedItem: { item: k } };
});
