// [WA] 1 · Entrada de leads · ParsearEmail
// Los portales avisan de cada solicitud por correo, cada uno con su formato.
// Se saca lo imprescindible: telefono (sin el no hay WhatsApp), nombre,
// referencia del inmueble y operacion.
const msg = $input.first().json;
const h = msg.headers ?? {};

const cabeceras = {};
for (const c of msg.payload?.headers ?? []) cabeceras[String(c.name ?? '').toLowerCase()] = c.value;

const asunto = String(msg.subject ?? h.subject ?? h.Subject ?? cabeceras.subject ?? '');
const remitente = String(
  msg.from?.value?.[0]?.address ?? msg.from?.text ?? msg.From ?? h.from ?? h.From
  ?? cabeceras.from ?? ''
);
// Ultimo recurso: si el correo llega sin parsear, se saca el texto de las
// partes en base64 del payload de Gmail.
function textoDelPayload(payload) {
  if (!payload) return '';
  const trozos = [];
  const recorrer = (p) => {
    const datos = p?.body?.data;
    if (datos && /^text\//.test(String(p.mimeType ?? ''))) {
      try { trozos.push(Buffer.from(datos, 'base64url').toString('utf8')); } catch (e) { /* se ignora */ }
    }
    for (const hijo of p?.parts ?? []) recorrer(hijo);
  };
  recorrer(payload);
  return trozos.join(' ');
}

const cuerpo = String(msg.text ?? msg.textAsHtml ?? msg.html ?? msg.snippet
  ?? textoDelPayload(msg.payload) ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;?/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

const portal = detectarPortal(remitente, asunto);
const todo = cuerpo + ' ' + asunto;

const buscar = (...res) => {
  for (const re of res) {
    const m = cuerpo.match(re) || asunto.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
};

// Telefono: se acepta con prefijo, con espacios o pegado.
const telBruto = buscar(
  /(?:tel[eé]fono|m[oó]vil|movil|phone|tlf)\s*[:\-]?\s*((?:\+?\d[\d\s().-]{7,})\d)/i,
  /((?:\+34|0034)?[\s.-]?[6789]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/
);
const tel = normalizarTelefono(telBruto);

// Los portales mandan todo en una linea ("Nombre: Ana Marti Telefono: 600..."),
// asi que el nombre se corta en cuanto asoma la siguiente etiqueta.
const SIGUIENTE_ETIQUETA = new RegExp(
  '\\s*\\b(?:tel[eé]fono|m[oó]vil|movil|tlf|phone|e-?mail|correo|ref(?:erencia)?|' +
  'c[oó]digo|mensaje|comentario|observaciones|direcci[oó]n|inmueble|anuncio|zona|precio|' +
  'operaci[oó]n|fecha)\\b.*$', 'i');

const nombre = buscar(
  /(?:nombre|contacto|de parte de|cliente)\s*[:\-]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ'’.\- ]{1,60})/i
).replace(SIGUIENTE_ETIQUETA, '').replace(/\s{2,}/g, ' ').replace(/[\s:\-]+$/, '').trim();

const email = buscar(/([\w.+-]+@[\w-]+\.[\w.]{2,})/);

// Referencia del inmueble: formatos BN-1543-V, CS-G-397-V, BN1543V...
const referencia = buscar(
  /(?:ref(?:erencia)?|c[oó]digo)\s*[:\-]?\s*([A-Z]{2}[-\s]?[A-Z0-9][-\s]?[A-Z0-9-]{1,12})/i,
  /\b([A-Z]{2}-(?:[A-Z]-)?\d{1,5}(?:-[A-Z])?)\b/
).toUpperCase().replace(/\s+/g, '');

// Operacion: lo que diga el correo y, si no, el sufijo de la referencia.
const dicePortal = /alquil|arrend|rent/i.test(todo) ? 'alquiler'
  : (/venta|compra|sale/i.test(todo) ? 'venta' : '');
const alquiler = esAlquiler(referencia, dicePortal);

const r = resolverAsesora(referencia);

return [{
  json: {
    portal,
    recibido_en: new Date().toISOString(),
    asunto,
    remitente,
    nombre,
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    telefono_valido: tel.valido,
    email_cliente: email,
    referencia,
    operacion: alquiler ? 'alquiler' : 'venta',
    es_alquiler: alquiler,
    asesora: r.asesora || '',
    asesora_conocida: r.conocida,
    email_asesora: r.email,
    // Sin telefono no se puede arrancar la conversacion: se avisa por correo
    // a la asesora y no se intenta mandar nada.
    se_puede_contactar: tel.valido,
    cuerpo_recortado: cuerpo.slice(0, 1500),
    // Lo que se le pone a la plantilla: {{1}} el nombre, {{2}} el inmueble.
    param1: nombre || 'hola',
    param2: referencia || 'que nos pediste',
  }
}];
