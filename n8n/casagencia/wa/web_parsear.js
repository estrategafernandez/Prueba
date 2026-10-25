// [WA] 1 · Leads de la web · LeerFormulario
// Formulario de contacto de casagencia.com. Lo manda la web de eGO desde
// web@websites.egorealestate.com con el asunto "Contacto del WebSite" (o
// "Contact from Website" / "Contact du site" si se rellena en ingles o frances):
//
//   Petición de Contacto  Origen del contacto: https://www.casagencia.com/contacto
//   Nombre: ...  Email: ...  Teléfono: ...  Observaciones: ...  RGPD: ...  IP: ...
//
// Y tambien los MENSAJES DE LOS PORTALES (el chat de idealista y compania):
// esos no crean lead en eGO, asi que si no entraran por aqui no entrarian por
// ningun lado. Se leen con leerCorreoDePortal (portal_correo.js) y salen con la
// misma forma que el formulario, para que el resto del flujo no cambie.
// Llega el correo entero (de [WA] 1, uno por uno) como texto JSON en "correo"
let j = $input.first().json || {};
if (typeof j.correo === 'string') { try { j = JSON.parse(j.correo); } catch (e) { j = {}; } }
const de = String(j.from?.text ?? j.from ?? '').toLowerCase();
const asunto = String(j.subject ?? '');
const esDeLaWeb = /websites\.egorealestate\.com/.test(de);

// --- Mensaje de un portal ---------------------------------------------------
const PORTALES_CORREO = ['Idealista', 'Fotocasa', 'Habitaclia'];
if (!esDeLaWeb && PORTALES_CORREO.includes(detectarPortal(de, asunto))) {
  const p = leerCorreoDePortal(j);
  // Un lead de verdad trae SIEMPRE el inmueble y una forma de contestarle. Pedir
  // las dos cosas es lo que deja fuera lo demas que manda un portal (boletines,
  // facturas, "tu anuncio caduca"), que si no acabaria dado de alta como lead.
  // Y que sea de estos dias. Al ampliar el buzon a los portales, un repoll de
  // Gmail podria traerse correos viejos y escribirle otra vez a gente a la que
  // ya se atendio hace meses (el candado de wa_leads solo cubre 30 dias).
  const cuando = j.date ? DateTime.fromJSDate(new Date(j.date)) : null;
  const reciente = !cuando || !cuando.isValid
    || cuando > DateTime.now().minus({ days: DIAS_CORREO_PORTAL });
  const sirve = !!((p.telefono_e164 || p.email_cliente) && p.referencia && reciente);
  return [{ json: {
    procesable: sirve,
    es_de_la_web: false,
    fuente: 'portal',
    // El portal YA dice que es: no se deja a la clasificacion que lo adivine
    // con la morralla del correo (pies de pagina, textos del portal...).
    tipo_forzado: p.es_alquiler ? 'alquiler' : 'compra',
    mensaje_id: j.id ?? '',
    fecha: j.date ?? '',
    origen_url: p.enlace || '',
    idioma: 'es',
    nombre: String(p.nombre || '').slice(0, 80),
    email_cliente: p.email_cliente,
    telefono_e164: p.telefono_e164,
    telefono_wa: p.telefono_wa,
    se_puede_contactar: p.se_puede_contactar,
    mensaje: String(p.cuerpo_recortado || '').slice(0, 1500),
    referencia: p.referencia,
    id_web: '',
    portal: p.portal,
    asunto,
  } }];
}
const texto = String(j.text || String(j.html ?? '').replace(/<[^>]+>/g, ' '))
  .replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
const plano = texto.replace(/\n/g, ' ');

// Etiquetas en los tres idiomas del formulario. Cada campo acaba donde empieza el siguiente.
const CAMPOS = {
  origen: ['Origen del contacto', 'Contact Source', 'Origine du contact'],
  nombre: ['Nombre', 'Name', 'Nom et Prénom', 'Nom'],
  email: ['Email', 'E-mail'],
  telefono: ['Teléfono', 'Telefono', 'Phone', 'Téléphone', 'Telephone'],
  mensaje: ['Observaciones', 'Remarks', 'Remarques', 'Message', 'Mensaje'],
};
const todas = Object.values(CAMPOS).flat().concat(['RGPD', 'GDPR', 'IP', 'User Agent']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fin = '(?=\\s+(?:' + todas.map(esc).join('|') + ')\\s*:|$)';
const campo = (k) => {
  for (const et of CAMPOS[k]) {
    const m = plano.match(new RegExp('(?:^|\\s)' + esc(et) + '\\s*:\\s*(.*?)' + fin, 'i'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
};

const origen = campo('origen');
const idioma = /\/en(-[a-z]{2})?\//i.test(origen) || /^Contact (from|Form)/i.test(asunto) ? 'en'
  : /\/fr(-[a-z]{2})?\//i.test(origen) || /Contact du site/i.test(asunto) ? 'fr'
  : /\/de(-[a-z]{2})?\//i.test(origen) ? 'de' : 'es';
const mensaje = campo('mensaje').slice(0, 1500);
const tel = normalizarTelefono(campo('telefono'));
// Si el formulario era el de una ficha, la referencia viene en el mensaje o en la URL
const refTexto = (mensaje.match(/\b([A-Z]{2}(?:-[A-Z])?-\d{2,5}-[A-Z])\b/) || [])[1] || '';
const idWeb = (origen.match(/\/inmueble\/[^/]+\/(\d{5,})/) || [])[1] || '';

return [{
  json: {
    procesable: esDeLaWeb,
    es_de_la_web: esDeLaWeb,
    fuente: 'web',
    tipo_forzado: '',
    mensaje_id: j.id ?? '',
    fecha: j.date ?? '',
    origen_url: origen,
    idioma,
    nombre: campo('nombre').slice(0, 80),
    email_cliente: campo('email').toLowerCase(),
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    se_puede_contactar: tel.valido,
    mensaje,
    referencia: refTexto,
    id_web: idWeb,
    portal: 'Web',
    asunto,
  }
}];
