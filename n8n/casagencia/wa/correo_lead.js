// ===========================================================================
// CORREO PARA LOS LEADS QUE DEJAN SU EMAIL (tengan telefono o no)
// ---------------------------------------------------------------------------
// A todo lead que deja su correo (portales por eGO y formulario de la web) se
// le manda un correo con la ficha del inmueble y un boton para que nos escriba
// por WhatsApp; si tambien dejo telefono, ademas le sale la bienvenida por
// WhatsApp. El mensaje del boton ya lleva la referencia, asi
// Sara sabe desde el primer mensaje por que inmueble pregunta.
//   - disponible: la ficha (foto, precio, habitaciones, banos, metros, lo
//     destacado y un trozo de la descripcion) + WhatsApp + ver la ficha.
//   - ya no esta: que ya no esta disponible + 3 parecidos + WhatsApp.
// En el idioma en que escribio (es, en, fr). Se presenta como "Soy Sara, de
// Casagencia" (en el correo no se dice que es una IA). Se inyecta despues de config.js.
// ===========================================================================

const CORREO_TEXTOS = {
  es: {
    idioma: 'es',
    hola: (n) => `Hola${n ? ' ' + n : ''},`,
    intro: (portal) => `Soy Sara, de Casagencia. Hemos recibido tu solicitud de información${portal ? ' en ' + portal : ''} por este inmueble:`,
    intro_basico: (portal, ref) => `Soy Sara, de Casagencia. Hemos recibido tu solicitud de información${portal ? ' en ' + portal : ''} por el inmueble${ref ? ' con referencia ' + ref : ''}.`,
    intro_no: (portal, ref) => `Soy Sara, de Casagencia. Hemos recibido tu solicitud de información${portal ? ' en ' + portal : ''}. El inmueble por el que preguntaste${ref ? ' (ref. ' + ref + ')' : ''} ya no está disponible, pero tenemos otros parecidos que te pueden encajar:`,
    cta: '¿Quieres visitarlo o tienes alguna duda? Escríbenos por WhatsApp y te contestamos al momento.',
    cta_no: '¿Te encaja alguno o buscas otra cosa? Escríbenos por WhatsApp y te enseñamos lo que tenemos.',
    boton_wa: 'Escríbenos por WhatsApp',
    boton_ficha: 'Ver la ficha completa',
    ver: 'Ver',
    asesora: (a) => a ? `${a}, tu asesora, se ocupará de organizarte la visita.` : '',
    pie: (portal) => `Recibes este correo porque pediste información sobre un inmueble${portal ? ' en ' + portal : ''}.`,
    asunto: (t) => `Tu solicitud: ${t}`,
    asunto_no: 'Tu solicitud: te enseñamos otros parecidos',
    wa: (ref, t) => `Hola, me interesa el inmueble ref. ${ref}${t ? ' (' + t + ')' : ''}`,
    wa_no: (ref) => `Hola, pregunté por la ref. ${ref}, que ya no está disponible. Me gustaría ver otros parecidos`,
    hab: 'hab.', bano: 'baño', banos: 'baños', mes: '/mes', en: 'en',
    // Formularios de la web sin un inmueble concreto
    web: 'nuestra web',
    intro_busqueda: (r) => `Soy Sara, de Casagencia. Hemos recibido el mensaje que nos dejaste en nuestra web${r ? ' sobre ' + r : ''}. Cuéntanos qué buscas y te enseñamos lo que tenemos que encaje contigo.`,
    intro_propietario: (m, a) => `Soy Sara, de Casagencia. Hemos recibido tu mensaje sobre tu vivienda${m ? ' en ' + m : ''}.${a ? ' ' + a + ', tu asesora, se pondrá en contacto contigo para hablarlo.' : ''}`,
    cta_busqueda: '¿Hablamos? Escríbenos por WhatsApp y te contestamos al momento.',
    cta_propietario: 'Si quieres adelantarnos cómo es, escríbenos por WhatsApp.',
    asunto_busqueda: 'Hemos recibido tu mensaje',
    asunto_propietario: 'Hemos recibido tu mensaje sobre tu vivienda',
    wa_busqueda: 'Hola, os dejé un mensaje en la web y me gustaría que me ayudarais a buscar un inmueble',
    wa_propietario: 'Hola, os escribí por la web por mi vivienda',
    pie_web: 'Recibes este correo porque nos escribiste desde nuestra web.',
  },
  en: {
    idioma: 'en',
    hola: (n) => `Hi${n ? ' ' + n : ''},`,
    intro: (portal) => `I'm Sara, from Casagencia. We have received your enquiry${portal ? ' on ' + portal : ''} about this property:`,
    intro_basico: (portal, ref) => `I'm Sara, from Casagencia. We have received your enquiry${portal ? ' on ' + portal : ''} about property${ref ? ' ref. ' + ref : ''}.`,
    intro_no: (portal, ref) => `I'm Sara, from Casagencia. We have received your enquiry${portal ? ' on ' + portal : ''}. The property you asked about${ref ? ' (ref. ' + ref + ')' : ''} is no longer available, but we have similar ones that may suit you:`,
    cta: 'Would you like to visit it or do you have any questions? Message us on WhatsApp and we will reply right away.',
    cta_no: 'Does any of them suit you, or are you looking for something else? Message us on WhatsApp and we will show you what we have.',
    boton_wa: 'Message us on WhatsApp',
    boton_ficha: 'See full details',
    ver: 'View',
    asesora: (a) => a ? `${a}, your agent, will arrange the viewing.` : '',
    pie: (portal) => `You are receiving this email because you asked about a property${portal ? ' on ' + portal : ''}.`,
    asunto: (t) => `Your enquiry: ${t}`,
    asunto_no: 'Your enquiry: similar properties for you',
    wa: (ref, t) => `Hi, I'm interested in property ref. ${ref}${t ? ' (' + t + ')' : ''}`,
    wa_no: (ref) => `Hi, I asked about ref. ${ref}, which is no longer available. I'd like to see similar ones`,
    hab: 'bed', bano: 'bath', banos: 'bath', mes: '/month', en: 'in',
    web: 'our website',
    intro_busqueda: (r) => `I'm Sara, from Casagencia. We have received the message you left on our website${r ? ' about ' + r : ''}. Tell us what you are looking for and we will show you what we have.`,
    intro_propietario: (m, a) => `I'm Sara, from Casagencia. We have received your message about your property${m ? ' in ' + m : ''}.${a ? ' ' + a + ', your agent, will contact you to discuss it.' : ''}`,
    cta_busqueda: 'Shall we talk? Message us on WhatsApp and we will reply right away.',
    cta_propietario: 'If you would like to tell us about it in the meantime, message us on WhatsApp.',
    asunto_busqueda: 'We have received your message',
    asunto_propietario: 'We have received your message about your property',
    wa_busqueda: "Hi, I left you a message on your website and I'd like help finding a property",
    wa_propietario: 'Hi, I wrote to you on your website about my property',
    pie_web: 'You are receiving this email because you contacted us through our website.',
  },
  fr: {
    idioma: 'fr',
    hola: (n) => `Bonjour${n ? ' ' + n : ''},`,
    intro: (portal) => `Je suis Sara, de Casagencia. Nous avons bien reçu votre demande d'information${portal ? ' sur ' + portal : ''} concernant ce bien :`,
    intro_basico: (portal, ref) => `Je suis Sara, de Casagencia. Nous avons bien reçu votre demande d'information${portal ? ' sur ' + portal : ''} concernant le bien${ref ? ' réf. ' + ref : ''}.`,
    intro_no: (portal, ref) => `Je suis Sara, de Casagencia. Nous avons bien reçu votre demande d'information${portal ? ' sur ' + portal : ''}. Le bien qui vous intéressait${ref ? ' (réf. ' + ref + ')' : ''} n'est plus disponible, mais nous en avons d'autres similaires :`,
    cta: 'Vous souhaitez le visiter ou vous avez une question ? Écrivez-nous sur WhatsApp, nous vous répondons tout de suite.',
    cta_no: "L'un d'eux vous plaît, ou vous cherchez autre chose ? Écrivez-nous sur WhatsApp et nous vous montrons ce que nous avons.",
    boton_wa: 'Écrivez-nous sur WhatsApp',
    boton_ficha: 'Voir la fiche complète',
    ver: 'Voir',
    asesora: (a) => a ? `${a}, votre conseillère, organisera la visite.` : '',
    pie: (portal) => `Vous recevez cet e-mail car vous avez demandé des informations sur un bien${portal ? ' sur ' + portal : ''}.`,
    asunto: (t) => `Votre demande : ${t}`,
    asunto_no: 'Votre demande : des biens similaires pour vous',
    wa: (ref, t) => `Bonjour, le bien réf. ${ref}${t ? ' (' + t + ')' : ''} m'intéresse`,
    wa_no: (ref) => `Bonjour, j'ai demandé la réf. ${ref}, qui n'est plus disponible. J'aimerais voir des biens similaires`,
    hab: 'ch.', bano: 'sdb', banos: 'sdb', mes: '/mois', en: 'à',
    web: 'notre site',
    intro_busqueda: (r) => `Je suis Sara, de Casagencia. Nous avons bien reçu le message que vous nous avez laissé sur notre site${r ? ' concernant ' + r : ''}. Dites-nous ce que vous cherchez et nous vous montrons ce que nous avons.`,
    intro_propietario: (m, a) => `Je suis Sara, de Casagencia. Nous avons bien reçu votre message au sujet de votre bien${m ? ' à ' + m : ''}.${a ? ' ' + a + ', votre conseillère, vous contactera pour en parler.' : ''}`,
    cta_busqueda: 'On en parle ? Écrivez-nous sur WhatsApp, nous vous répondons tout de suite.',
    cta_propietario: 'Si vous souhaitez nous en dire plus en attendant, écrivez-nous sur WhatsApp.',
    asunto_busqueda: 'Nous avons bien reçu votre message',
    asunto_propietario: 'Nous avons bien reçu votre message au sujet de votre bien',
    wa_busqueda: "Bonjour, je vous ai laissé un message sur votre site et j'aimerais de l'aide pour trouver un bien",
    wa_propietario: 'Bonjour, je vous ai écrit sur votre site au sujet de mon bien',
    pie_web: 'Vous recevez cet e-mail car vous nous avez écrit depuis notre site.',
  },
};

// Lo que merece la pena destacar de las caracteristicas del feed (en el orden en que se ponen)
const DESTACAR = [
  [/piscina/i, { es: 'Piscina', en: 'Pool', fr: 'Piscine' }],
  [/terraza/i, { es: 'Terraza', en: 'Terrace', fr: 'Terrasse' }],
  [/garaje|parking|plaza de aparcamiento/i, { es: 'Garaje', en: 'Parking', fr: 'Parking' }],
  [/vistas al mar|vista mar/i, { es: 'Vistas al mar', en: 'Sea views', fr: 'Vue mer' }],
  [/ascensor/i, { es: 'Ascensor', en: 'Lift', fr: 'Ascenseur' }],
  [/aire acondicionado/i, { es: 'Aire acondicionado', en: 'Air conditioning', fr: 'Climatisation' }],
  [/trastero/i, { es: 'Trastero', en: 'Storage room', fr: 'Débarras' }],
  [/jard[ií]n/i, { es: 'Jardín', en: 'Garden', fr: 'Jardin' }],
  [/amueblad/i, { es: 'Amueblado', en: 'Furnished', fr: 'Meublé' }],
  [/exterior/i, { es: 'Exterior', en: 'Exterior', fr: 'Extérieur' }],
];

// El feed trae tipos en espanol y en ingles: el nombre en el idioma del correo
const TIPO_IDIOMA = [
  [/^(apartamento|apartment)$/i, { es: 'Apartamento', en: 'Apartment', fr: 'Appartement' }],
  [/^(piso|flat)$/i, { es: 'Piso', en: 'Flat', fr: 'Appartement' }],
  [/^(chalet)$/i, { es: 'Chalet', en: 'Detached house', fr: 'Maison individuelle' }],
  [/^(villa)$/i, { es: 'Villa', en: 'Villa', fr: 'Villa' }],
  [/^(d[uú]plex)$/i, { es: 'Dúplex', en: 'Duplex', fr: 'Duplex' }],
  [/^(town house|adosado)$/i, { es: 'Adosado', en: 'Townhouse', fr: 'Maison mitoyenne' }],
  [/^(village house|casa de pueblo)$/i, { es: 'Casa de pueblo', en: 'Village house', fr: 'Maison de village' }],
  [/^(casa)$/i, { es: 'Casa', en: 'House', fr: 'Maison' }],
  [/^(estudio|studio)$/i, { es: 'Estudio', en: 'Studio', fr: 'Studio' }],
  [/^(ground floor|bajo)$/i, { es: 'Bajo', en: 'Ground floor flat', fr: 'Rez-de-chaussée' }],
  [/^([aá]tico|penthouse)$/i, { es: 'Ático', en: 'Penthouse', fr: 'Attique' }],
  [/^(local comercial)$/i, { es: 'Local comercial', en: 'Commercial premises', fr: 'Local commercial' }],
  [/^(office \/ practice|oficina)$/i, { es: 'Oficina', en: 'Office', fr: 'Bureau' }],
  [/^(bar \/ restaurant)$/i, { es: 'Bar / restaurante', en: 'Bar / restaurant', fr: 'Bar / restaurant' }],
  [/land|terreno|parcela/i, { es: 'Terreno', en: 'Plot of land', fr: 'Terrain' }],
];
const tipoEn = (tipo, idioma) => {
  const t = String(tipo || '').trim();
  const m = TIPO_IDIOMA.find(([re]) => re.test(t));
  return m ? m[1][idioma] : (t || { es: 'Inmueble', en: 'Property', fr: 'Bien' }[idioma]);
};
const MUNICIPIO_BONITO = { 'benicasim': 'Benicàssim' };

const sinPartir = (ref) => String(ref || '').replace(/-/g, '\u2011');
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const municipioDe = (m) => {
  const primero = String(m ?? '').split(' / ')[0].trim();
  return MUNICIPIO_BONITO[sinAcentos(primero)] || primero;
};
const enlaceWhatsApp = (texto) => `https://wa.me/${WHATSAPP_IA}?text=${encodeURIComponent(texto)}`;

function precioTexto(precio, alquiler, t) {
  const n = Number(precio || 0);
  return n ? n.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' €' + (alquiler ? t.mes : '') : '';
}

function tituloInmueble(f, t) {
  return `${tipoEn(f.tipo_inmueble, t.idioma)} ${t.en} ${municipioDe(f.municipio)}`.trim();
}

// Con espacios que no se parten (3 hab., 103 m²) y "1 baño" en singular
function datosInmueble(f, t) {
  const nb = '\u00a0';
  return [f.habitaciones ? `${f.habitaciones}${nb}${t.hab}` : '',
          f.banos ? `${f.banos}${nb}${Number(f.banos) === 1 ? t.bano : t.banos}` : '',
          f.superficie ? `${f.superficie}${nb}m²` : ''].filter(Boolean).join(' · ');
}

function resumenDescripcion(texto, max = 300) {
  let d = String(texto ?? '').replace(/\s+/g, ' ').replace(/^CASAGENCIA INMOBILIARIA (VENDE|PRESENTA|ALQUILA)[.:…\s]*/i, '').trim();
  d = d.charAt(0).toUpperCase() + d.slice(1);
  if (d.length <= max) return d;
  const corte = d.slice(0, max);
  const punto = corte.lastIndexOf('. ');
  return (punto > max * 0.5 ? corte.slice(0, punto + 1) : corte.slice(0, corte.lastIndexOf(' ')) + '…');
}

function boton(url, texto, fondo, color = '#ffffff', borde = fondo) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>`
    + `<td align="center" bgcolor="${fondo}" style="border-radius:8px;border:2px solid ${borde};">`
    + `<a href="${escHtml(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;`
    + `font-size:16px;font-weight:bold;color:${color};text-decoration:none;border-radius:8px;">${escHtml(texto)}</a></td></tr></table>`;
}

function tarjetaPequena(f, t) {
  const alquiler = /alquil/i.test(String(f.tipo_transaccion || ''));
  return `<tr><td style="padding:0 0 14px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" `
    + `style="border:1px solid #e6e4dc;border-radius:10px;overflow:hidden;"><tr>`
    + (f.imagen ? `<td width="150" valign="top" style="width:150px;"><a href="${escHtml(f.enlace)}" target="_blank">`
      + `<img src="${escHtml(f.imagen)}" width="150" alt="" style="display:block;width:150px;height:auto;border:0;"></a></td>` : '')
    + `<td valign="top" style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif;color:#3d3d3b;">`
    + `<div style="font-size:15px;font-weight:bold;">${escHtml(tituloInmueble(f, t))}${f.zona ? ' · ' + escHtml(f.zona) : ''}</div>`
    + `<div style="font-size:17px;font-weight:bold;color:#2e9c8e;padding:4px 0;">${escHtml(precioTexto(f.precio, alquiler, t))}</div>`
    + `<div style="font-size:13px;color:#6b6a66;">${escHtml(datosInmueble(f, t))}</div>`
    + `<div style="padding-top:8px;"><a href="${escHtml(f.enlace)}" target="_blank" style="font-size:13px;color:#2e9c8e;font-weight:bold;">${escHtml(t.ver)} →</a></div>`
    + `</td></tr></table></td></tr>`;
}

// Formulario de la web que no habla de un inmueble concreto: alguien que busca
// (te ensenamos lo que tenemos) o un propietario (su asesora le llamara).
function correoGeneral(l, t, idioma, nombre) {
  const busca = l.general === 'busqueda';
  const asunto = busca ? t.asunto_busqueda : t.asunto_propietario;
  const intro = busca ? t.intro_busqueda(String(l.resumen || '').trim())
    : t.intro_propietario(municipioDe(l.municipio || ''), l.asesora || '');
  const cta = busca ? t.cta_busqueda : t.cta_propietario;
  const waTexto = busca ? t.wa_busqueda : t.wa_propietario;
  const wa = enlaceWhatsApp(waTexto);
  const p = (txt, extra = '') => `<p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#3d3d3b;${extra}">${txt}</p>`;
  const html = `<!doctype html><html lang="${idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escHtml(asunto)}</title></head><body style="margin:0;padding:0;background:#f4f3ef;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f3ef;"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;">`
    + `<tr><td align="center" style="padding:26px 32px 8px 32px;"><img src="${LOGO_CASAGENCIA}" width="96" height="96" alt="Casagencia Inmobiliaria" style="display:block;border:0;"></td></tr>`
    + `<tr><td style="padding:12px 32px 4px 32px;">` + p(escHtml(t.hola(nombre)), 'font-weight:bold;') + p(escHtml(intro)) + `</td></tr>`
    + `<tr><td style="padding:10px 32px 8px 32px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2fbf8;border-radius:12px;"><tr><td style="padding:20px 20px 22px 20px;">`
    + p(escHtml(cta), 'text-align:center;') + boton(wa, t.boton_wa, '#25D366')
    + `</td></tr></table></td></tr>`
    + `<tr><td style="padding:22px 32px 26px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8d8c86;text-align:center;">`
    + `<strong style="color:#3d3d3b;">Casagencia Inmobiliaria</strong> · Benicàssim · Castellón<br>`
    + `<a href="https://www.casagencia.com" target="_blank" style="color:#2e9c8e;">www.casagencia.com</a><br><br>${escHtml(t.pie_web)}`
    + `</td></tr></table></td></tr></table></body></html>`;
  const texto = [t.hola(nombre), '', intro, '', cta, `${t.boton_wa}: ${wa}`, '',
    'Casagencia Inmobiliaria · www.casagencia.com', t.pie_web].join('\n');
  return { asunto, html, texto, whatsapp_url: wa, whatsapp_texto: waTexto, idioma, modo: l.general };
}

// l: { nombre, idioma, referencia, portal, disponible, asesora,
//      general: 'busqueda' | 'propietario' (formulario de la web sin inmueble), resumen, municipio }
// ficha: fila de wa_cartera (o null si ya no esta); parecidos: filas de wa_cartera
function componerCorreoLead(l, ficha, parecidos = []) {
  const idioma = ['es', 'en', 'fr'].includes(l.idioma) ? l.idioma : 'es';
  const t = CORREO_TEXTOS[idioma];
  const ref = String(l.referencia || '').toUpperCase();
  const nombre = String(l.nombre || '').trim().split(/\s+/)[0] || '';
  const esWeb = /^web$/i.test(String(l.portal || '').trim());
  const portal = esWeb ? t.web : String(l.portal || '').trim();
  if (l.general === 'busqueda' || l.general === 'propietario') return correoGeneral(l, t, idioma, nombre);
  const hayFicha = !!(ficha && ficha.ref) && l.disponible !== false;
  // Disponible pero sin ficha en la web (no esta publicado): sin tarjeta, con la referencia
  const basico = !hayFicha && l.disponible !== false;
  const alquiler = hayFicha && /alquil/i.test(String(ficha.tipo_transaccion || ''));
  const titulo = hayFicha ? tituloInmueble(ficha, t) : '';
  const waTexto = hayFicha || basico ? t.wa(ref, titulo) : t.wa_no(ref);
  const wa = enlaceWhatsApp(waTexto);
  const destacados = hayFicha
    ? DESTACAR.filter(([re]) => re.test(String(ficha.caracteristicas || '') + ' ' + String(ficha.descripcion || '')))
        .map(([, n]) => n[idioma]).slice(0, 4)
    : [];
  const precio = hayFicha ? precioTexto(ficha.precio, alquiler, t) : '';
  const asunto = hayFicha ? t.asunto([titulo, precio].filter(Boolean).join(' · '))
    : basico ? t.asunto(ref ? 'ref. ' + ref : (portal || 'Casagencia')) : t.asunto_no;

  const p = (txt, extra = '') => `<p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#3d3d3b;${extra}">${txt}</p>`;
  const tarjeta = hayFicha
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6e4dc;border-radius:12px;overflow:hidden;">`
      + (ficha.imagen ? `<tr><td style="line-height:0;font-size:0;"><a href="${escHtml(ficha.enlace)}" target="_blank"><img src="${escHtml(ficha.imagen)}" width="536" alt="${escHtml(titulo)}" `
        + `style="display:block;width:100%;max-width:536px;height:auto;border:0;"></a></td></tr>` : '')
      + `<tr><td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;color:#3d3d3b;">`
      + `<div style="font-size:19px;font-weight:bold;">${escHtml(titulo)}${ficha.zona ? ' · ' + escHtml(ficha.zona) : ''}</div>`
      + (precio ? `<div style="font-size:24px;font-weight:bold;color:#2e9c8e;padding:6px 0 4px 0;">${escHtml(precio)}</div>` : '')
      + `<div style="font-size:14px;color:#6b6a66;padding-bottom:10px;">${escHtml(datosInmueble(ficha, t))}${ref ? ` · <span style="white-space:nowrap;">ref. ${escHtml(ref)}</span>` : ''}</div>`
      + (destacados.length ? `<div style="padding-bottom:12px;">${destacados.map(d => `<span style="display:inline-block;background:#e8f6f4;color:#24766b;`
        + `font-size:13px;font-weight:bold;padding:5px 10px;border-radius:14px;margin:0 6px 6px 0;">${escHtml(d)}</span>`).join('')}</div>` : '')
      // La descripcion del anuncio esta en espanol: solo en los correos en espanol
      + (idioma === 'es' ? `<div style="font-size:14px;line-height:1.55;color:#55544f;padding-bottom:14px;">${escHtml(resumenDescripcion(ficha.descripcion))}</div>` : '<div style="height:6px;"></div>')
      + (ficha.enlace ? boton(ficha.enlace, t.boton_ficha, '#ffffff', '#2e9c8e', '#5bc4b6') : '')
      + `</td></tr></table>`
    : basico ? ''
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${parecidos.slice(0, 3).map(f => tarjetaPequena(f, t)).join('')}</table>`;

  const html = `<!doctype html><html lang="${idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escHtml(asunto)}</title></head><body style="margin:0;padding:0;background:#f4f3ef;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f3ef;"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;">`
    + `<tr><td align="center" style="padding:26px 32px 8px 32px;"><img src="${LOGO_CASAGENCIA}" width="96" height="96" alt="Casagencia Inmobiliaria" style="display:block;border:0;"></td></tr>`
    + `<tr><td style="padding:12px 32px 4px 32px;">`
    + p(escHtml(t.hola(nombre)), 'font-weight:bold;')
    + p(escHtml(hayFicha ? t.intro(portal) : basico ? t.intro_basico(portal, sinPartir(ref)) : t.intro_no(portal, sinPartir(ref))))
    + `</td></tr><tr><td style="padding:4px 32px 8px 32px;">${tarjeta}</td></tr>`
    + `<tr><td style="padding:18px 32px 8px 32px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2fbf8;border-radius:12px;"><tr><td style="padding:20px 20px 22px 20px;">`
    + p(escHtml(hayFicha || basico ? t.cta : t.cta_no), 'text-align:center;')
    + boton(wa, t.boton_wa, '#25D366')
    + ((hayFicha || basico) && l.asesora ? `<p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b6a66;text-align:center;">${escHtml(t.asesora(l.asesora))}</p>` : '')
    + `</td></tr></table></td></tr>`
    + `<tr><td style="padding:22px 32px 26px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8d8c86;text-align:center;">`
    + `<strong style="color:#3d3d3b;">Casagencia Inmobiliaria</strong> · Benicàssim · Castellón<br>`
    + `<a href="https://www.casagencia.com" target="_blank" style="color:#2e9c8e;">www.casagencia.com</a><br><br>${escHtml(esWeb ? t.pie_web : t.pie(portal))}`
    + `</td></tr></table></td></tr></table></body></html>`;

  const texto = [
    t.hola(nombre), '', hayFicha ? t.intro(portal) : basico ? t.intro_basico(portal, ref) : t.intro_no(portal, ref), '',
    ...(hayFicha
      ? [[titulo, ficha.zona].filter(Boolean).join(' · '), precio, datosInmueble(ficha, t) + (ref ? ` · ref. ${ref}` : ''),
         destacados.join(' · '), '', idioma === 'es' ? resumenDescripcion(ficha.descripcion) : '', '', `${t.boton_ficha}: ${ficha.enlace}`]
      : basico ? [] : parecidos.slice(0, 3).map(f => `- ${tituloInmueble(f, t)} · ${precioTexto(f.precio, /alquil/i.test(String(f.tipo_transaccion || '')), t)} · ${f.enlace}`)),
    '', hayFicha || basico ? t.cta : t.cta_no, `${t.boton_wa}: ${wa}`, '',
    'Casagencia Inmobiliaria · www.casagencia.com', esWeb ? t.pie_web : t.pie(portal),
  ].filter(x => x !== null && x !== undefined).join('\n');

  return { asunto, html, texto, whatsapp_url: wa, whatsapp_texto: waTexto, idioma,
           modo: hayFicha ? 'ficha' : basico ? 'sin_ficha' : 'ya_no_esta' };
}
