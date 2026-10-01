// [WA] 5 · Leads de eGO · Decidir
// Con el detalle del lead (GetLead) y el de su inmueble (GetRealestate):
//   - de que portal viene, quien es y a que comercial lo ha asignado eGO;
//   - si el inmueble sigue DISPONIBLE (y en la cartera publicada);
//   - que primer WhatsApp le toca (leads.js) y a que asesora le toca por la
//     referencia (BN/OR Carmen, CS/VR Gisela), para compararlo con eGO.
const base = $('Separar').item.json;
const lead = $('DetalleLead').item.json?.datos || {};
const inm = (() => { try { return $('DetalleInmueble').item.json?.datos || {}; } catch (e) { return {}; } })();
const cartera = (() => { try { return $('EnLaCartera').item.json || {}; } catch (e) { return {}; } })();
const estados = (() => { try { return $('EstadosDeInmueble').first().json?.datos || []; } catch (e) { return []; } })();
const empleados = (() => { try { return $('Empleados').first().json?.datos || []; } catch (e) { return []; } })();

const referencia = String(inm.reference || cartera.ref || '').toUpperCase();
const estadoNombre = String((estados.find(e => String(e.id) === String(inm.realestateStatusId)) || {}).name || '');
// Disponible: el estado de eGO lo dice y, ademas, sigue publicado en el feed de la web
const estadoOk = !estadoNombre || /disponible|activ|publicad|available/i.test(estadoNombre);
const disponible = referencia ? (estadoOk && !!cartera.ref) : null;

const tel = normalizarTelefono(lead.phone || base.telefono);
const origen = String(lead.leadOrigin?.name ?? lead.leadOrigin ?? lead.originId ?? '');
const idAsignado = lead.assignToSecurityUserId ?? lead.securityUserId ?? null;
const empleado = empleados.find(e => String(e.id ?? e.securityUserId ?? e.ID) === String(idAsignado)) || {};
const asignadoEgo = [empleado.firstName, empleado.lastName].filter(Boolean).join(' ') || (idAsignado ? `usuario ${idAsignado}` : '');
const porReferencia = resolverAsesora(referencia).destinatario;

const d = decidirPrimerMensaje({
  tipo: esAlquiler(referencia, '') ? 'alquiler' : 'compra',
  referencia,
  disponible,
  enlace: cartera.enlace || '',
  operacion: cartera.tipo_transaccion || '',
  nombre: lead.name || base.nombre,
  idioma: 'es',
});

return [{ json: {
  ...d,
  lead_id: base.lead_id,
  telefono_e164: tel.e164,
  telefono_wa: tel.wa_id,
  se_puede_contactar: tel.valido,
  nombre: String(lead.name || base.nombre || '').trim(),
  email_cliente: String(lead.email || '').toLowerCase(),
  referencia,
  enlace: cartera.enlace || '',
  portal: origen,
  tipo: d.es_alquiler ? 'alquiler' : 'compra',
  estado_inmueble: estadoNombre || (cartera.ref ? 'en la cartera publicada' : 'no esta en la cartera publicada'),
  disponible,
  // Contacto: eGO lo asocia al lead como potencialClientId
  contacto_creado: !!lead.potencialClientId,
  contacto_id: lead.potencialClientId || null,
  asignado_ego: asignadoEgo,
  asesora_por_referencia: porReferencia,
  asignacion_coincide: !asignadoEgo || new RegExp(porReferencia, 'i').test(asignadoEgo),
  notas: `Lead de eGO (${origen || 'internet'}): ${String(lead.obs || '').replace(/\s+/g, ' ').slice(0, 1200)}`,
  asunto: String(lead.title || ''),
} }];
