// [WA] 1 · Leads de la web · LeerFormulario
// Formulario de contacto de casagencia.com. Lo manda la web de eGO desde
// web@websites.egorealestate.com con el asunto "Contacto del WebSite" (o
// "Contact from Website" / "Contact du site" si se rellena en ingles o frances):
//
//   Petición de Contacto  Origen del contacto: https://www.casagencia.com/contacto
//   Nombre: ...  Email: ...  Teléfono: ...  Observaciones: ...  RGPD: ...  IP: ...
//
// Solo se cogen estos: los de los portales ya entran en eGO y salen de alli.
const j = $input.first().json || {};
const de = String(j.from?.text ?? j.from ?? '').toLowerCase();
const asunto = String(j.subject ?? '');
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
    es_de_la_web: /websites\.egorealestate\.com/.test(de),
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
