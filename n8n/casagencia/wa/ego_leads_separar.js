// [WA] 5 · Leads de eGO · Separar
// ListLeadByPage devuelve { leads: [...], totalRows } y cada lead ya trae todo
// lo que hace falta (comprobado con la API): telefono (0034...), inmueble
// (realestateReference / realestateId), portal (portalId), venta o alquiler
// (masterLeadType) y la comercial que le ha puesto eGO (assignToSecurityUser*).
// Solo los de los PORTALES: los que meten las comerciales a mano no llevan portal.
const r = $input.first().json || {};
const leads = Array.isArray(r.datos?.leads) ? r.datos.leads : [];
const es = (o) => String(o?.['ES-ES'] ?? o?.['EN-GB'] ?? '').trim();
const fuera = [];
for (const l of leads) {
  if (l?.id == null || !Number(l.portalId || 0)) continue;
  const solicitud = es(l.leadSubOrigin?.nameMls);           // "Idealista ES Solicitud de Visita"
  const obs = String(l.obs ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  fuera.push({ json: {
    lead_id: String(l.id),
    nombre: String(l.name ?? l.title ?? '').trim(),
    telefono: String(l.phone ?? '').trim(),
    email: String(l.email ?? '').trim().toLowerCase(),
    referencia: String(l.realestateReference ?? '').toUpperCase().trim(),
    realestate_id: Number(l.realestateId || 0),
    portal_id: Number(l.portalId),
    portal: EGO_PORTALES[l.portalId] || solicitud.split(/\s+/)[0] || `Portal ${l.portalId}`,
    solicitud,
    operacion: es(l.masterLeadType?.name).toLowerCase(),   // venta / alquiler
    asignado_ids: [].concat(l.assignToSecurityUserIds?.length ? l.assignToSecurityUserIds
      : (l.assignToSecurityUserId ? [l.assignToSecurityUserId] : [])),
    asignado_nombres: [].concat(l.assignToSecurityUserNames || []),
    // Lo que escribio el cliente en el portal (despues de la cabecera del portal)
    mensaje: (obs.includes('\n') ? obs.split('\n').slice(1).join(' ') : '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    obs: obs.replace(/\s+/g, ' ').trim().slice(0, 1200),
    creado: l.createDate || '',
  } });
}
const error = r.ok === false ? (r.error || 'eGO no ha respondido') : '';
return fuera.length ? fuera : [{ json: { vacio: true, error } }];
