// [WA] 5 · Leads de eGO · Separar
// ListLeadByPage devuelve { leads: [...], totalRows }. Un item por lead, con
// lo minimo para apuntarlo; el detalle se pide despues lead a lead.
const r = $input.first().json || {};
const datos = r.datos ?? r;
const leads = Array.isArray(datos?.leads) ? datos.leads : (Array.isArray(datos) ? datos : []);
const fuera = [];
for (const l of leads) {
  const id = l.id ?? l.leadId ?? l.ID;
  if (id == null) continue;
  fuera.push({ json: {
    lead_id: String(id),
    nombre: String(l.name ?? l.title ?? '').trim(),
    telefono: String(l.phone ?? '').trim(),
    creado: l.createDate ?? l.dateCreated ?? '',
  } });
}
return fuera.length ? fuera : [{ json: { vacio: true, error: r.ok === false ? (r.error || 'eGO no ha respondido') : '' } }];
