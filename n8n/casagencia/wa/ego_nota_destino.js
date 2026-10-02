// [EGO][SUB] NotaEnEgo · Destino
// Donde se deja la nota del historial en eGO, por el telefono del cliente:
//   1. su CONTACTO, si existe (lo crean las comerciales al trabajar el cliente);
//   2. si no, su LEAD mas reciente (los de los portales no traen contacto).
// Comprobado: ListEntityByPageFastSearch busca por telefono y ListLeadByPage
// por los 9 ultimos digitos. InsertNote: objectName 2 = contacto, 3 = lead.
const p = $('Preparar').first().json;
const datos = (n) => { try { return $(n).first().json?.datos ?? null; } catch (e) { return null; } };
const conTelefono = (o) => JSON.stringify(o || {}).replace(/[\s+().-]/g, '').includes(p.nueve);
const contactos = [].concat(datos('BuscarContacto')?.searchList || []).filter(conTelefono);
const leads = [].concat(datos('BuscarLead')?.leads || [])
  .filter(l => String(l.phone || '').replace(/\D/g, '').endsWith(p.nueve))
  .sort((a, b) => String(b.createDate || '').localeCompare(String(a.createDate || '')));

const contacto = contactos[0];
const lead = leads[0];
return [{ json: {
  objeto_id: contacto ? contacto.id : (lead ? lead.id : null),
  objeto: contacto ? 2 : (lead ? 3 : 0),
  donde: contacto ? `contacto ${contacto.id} (${[contacto.firstName, contacto.lastName].filter(Boolean).join(' ').trim()})`
    : lead ? `lead ${lead.id} (${lead.realestateReference || 'sin inmueble'})` : 'no esta en eGO',
  texto: p.texto,
  tipo_historial: p.tipo_historial,
} }];
