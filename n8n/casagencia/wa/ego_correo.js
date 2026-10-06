// [WA] 5 (portales) y [WA][SUB] LeadDeLaWeb · ComponerCorreo (uno por lead con email)
// A todo lead que deja su correo, tenga telefono o no, se le prepara el correo
// con la ficha del inmueble (wa/correo_lead.js) y un boton para escribirnos por
// WhatsApp con la referencia ya puesta. Si es un formulario de la web sin
// inmueble, el correo general (busca algo / propietario). Se guarda en
// leads_entrantes y sale del Gmail de su asesora (CORREO_LEADS.activo y
// MODO_LEADS = 'real'). No se repite: si en los ultimos 30 dias ya se le mando
// el correo de ese inmueble a esa direccion (ya_enviado), no sale otra vez.
const d = $('Decidir').item.json;
const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } };
const ficha = parse($json.ficha) || null;
const parecidos = [].concat(parse($json.parecidos) || []);
const general = d.accion === 'busqueda' && !d.referencia ? 'busqueda' : d.accion === 'captacion' ? 'propietario' : '';
const c = componerCorreoLead({ nombre: d.nombre, idioma: d.idioma, referencia: d.referencia, portal: d.portal,
                               disponible: d.disponible ?? (d.accion !== 'no_disponible'), asesora: d.asesora,
                               general, resumen: d.resumen_cliente, municipio: d.municipio }, ficha, parecidos);
const yaEnviado = $json.ya_enviado === true || $json.ya_enviado === 'true';
return { json: {
  ...c,
  registro_id: $('Registrar').item.json.id,
  para: d.email_cliente,
  // Si el cliente contesta al correo, le llega a su asesora
  responder_a: (EQUIPO[d.asesora] || {}).email || '',
  ya_enviado: yaEnviado,
  enviar: CORREO_LEADS.activo === true && MODO_LEADS === 'real' && !yaEnviado,
  // Buzon desde el que sale: el de su asesora (Gisela; los demas, desde el de Carmen)
  remitente: d.asesora === 'Gisela' ? 'Gisela' : 'Carmen',
  nombre_remitente: CORREO_LEADS.nombre,
  copia: CORREO_LEADS.copia || '',
} };
