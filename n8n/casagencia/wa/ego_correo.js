// [WA] 5 · Leads de eGO · ComponerCorreo (uno por lead sin telefono)
// El lead solo ha dejado su correo: se le prepara el correo con la ficha del
// inmueble (wa/correo_lead.js) y un boton para escribirnos por WhatsApp con la
// referencia ya puesta. Se guarda en leads_entrantes; sale cuando se conecte el
// buzon (CORREO_LEADS.activo) y con MODO_LEADS = 'real'.
const d = $('Decidir').item.json;
const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } };
const ficha = parse($json.ficha) || null;
const parecidos = [].concat(parse($json.parecidos) || []);
const c = componerCorreoLead({ nombre: d.nombre, idioma: d.idioma, referencia: d.referencia, portal: d.portal,
                               disponible: d.disponible, asesora: d.asesora }, ficha, parecidos);
return { json: {
  ...c,
  registro_id: $('Registrar').item.json.id,
  para: d.email_cliente,
  // Si el cliente contesta al correo, le llega a su asesora
  responder_a: (EQUIPO[d.asesora] || {}).email || '',
  enviar: CORREO_LEADS.activo === true && MODO_LEADS === 'real',
} };
