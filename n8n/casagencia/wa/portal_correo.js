// LEER EL CORREO DE UN PORTAL (idealista, fotocasa, habitaclia)
// ---------------------------------------------------------------------------
// Cada portal avisa por correo con su formato. Se saca lo imprescindible:
// telefono (sin el no hay WhatsApp), nombre, referencia del inmueble, enlace y
// operacion. Esta aqui como libreria para que la usen los dos sitios que leen
// correos: el nodo ParsearEmail y LeerFormulario de [WA][SUB] LeadDeLaWeb.
function leerCorreoDePortal(msg) {
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

  // Telefono. En los mensajes del chat de idealista va SUELTO, sin etiqueta y con
  // prefijo de otro pais, asi que no basta con buscar "Telefono:". Por orden de
  // fiabilidad: el enlace tel: del propio correo, la etiqueta, el formato
  // espanol y, por ultimo, cualquier numero con + delante (un precio o un
  // codigo de anuncio nunca lo lleva).
  const crudo = String(msg.html ?? msg.textAsHtml ?? '') + ' ' + cuerpo;
  const delEnlace = (crudo.match(/tel:\s*(\+?[\d\s().-]{7,}\d)/i) || [])[1] || '';
  const telBruto = delEnlace || buscar(
    /(?:tel[eé]fono|m[oó]vil|movil|phone|tlf)\s*[:\-]?\s*((?:\+?\d[\d\s().-]{7,})\d)/i,
    /((?:\+34|0034)?[\s.-]?[6789]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/,
    /(\+\d{1,3}[\s.-]?\d[\d\s().-]{6,}\d)/
  );
  const tel = normalizarTelefono(telBruto);

  // Los portales mandan todo en una linea ("Nombre: Ana Marti Telefono: 600..."),
  // asi que el nombre se corta en cuanto asoma la siguiente etiqueta.
  const SIGUIENTE_ETIQUETA = new RegExp(
    '\\s*\\b(?:tel[eé]fono|m[oó]vil|movil|tlf|phone|e-?mail|correo|ref(?:erencia)?|' +
    'c[oó]digo|mensaje|comentario|observaciones|direcci[oó]n|inmueble|anuncio|zona|precio|' +
    'operaci[oó]n|fecha)\\b.*$', 'i');

  const nombre = (buscar(
    /(?:nombre|contacto|de parte de|cliente)\s*[:\-]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ'’.\- ]{1,60})/i
  // En el chat de idealista no hay etiqueta: el nombre va suelto justo delante
  // del telefono ("Iuliana 617 34 32 25"). Se coge lo que haya pegado a el.
  ) || buscar(
    /([A-ZÁÉÍÓÚÑ][a-záéíóúñ'’.\-]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ'’.\-]+){0,3})\s+(?:\+?\d[\d\s().-]{7,}\d)/
  )).replace(SIGUIENTE_ETIQUETA, '').replace(/\s{2,}/g, ' ').replace(/[\s:\-]+$/, '').trim();

  const email = buscar(/([\w.+-]+@[\w-]+\.[\w.]{2,})/);

  // Referencia del inmueble: formatos BN-1543-V, CS-G-397-V, BN1543V...
  // Primero la que YA tiene forma de referencia nuestra y solo despues la que
  // vaya detras de "Ref."/"Codigo": si no, en "Código del anuncio: 112890" se
  // llevaba las dos primeras palabras y la referencia salia "DELANUNCIO".
  const referencia = buscar(
    /\b([A-Z]{2}-(?:[A-Z]-)?\d{1,5}(?:-[A-Z])?)\b/,
    /(?:ref(?:erencia)?|c[oó]digo)\s*[:\-.]?\s*([A-Z]{2}[-\s]?(?:[A-Z][-\s]?)?\d{1,5}[-\s]?[A-Z]?)\b/i
  ).toUpperCase().replace(/\s+/g, '');

  // Operacion: lo que diga el correo y, si no, el sufijo de la referencia.
  const dicePortal = /alquil|arrend|rent/i.test(todo) ? 'alquiler'
    : (/venta|compra|sale/i.test(todo) ? 'venta' : '');
  const alquiler = esAlquiler(referencia, dicePortal);

  const r = resolverAsesora(referencia);

  // Enlace del anuncio para la plantilla ({{2}}). Se busca en el HTML ANTES de
  // quitar las etiquetas, porque los portales lo meten en un <a href>. Solo valen
  // enlaces a la ficha: nunca los de darse de baja, seguimiento o logos.
  const bruto = [msg.html, msg.textAsHtml, msg.text, textoDelPayload(msg.payload)].filter(Boolean).join(' ');
  const urls = [...String(bruto).matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map(m => m[0].replace(/&amp;/g, '&').replace(/[.,;]+$/, ''));
  const FICHA = [
    /idealista\.com\/inmueble\/\d+/i,
    /fotocasa\.es\/.+\/\d{6,}\/d/i,
    /habitaclia\.com\/.+-i\d+/i,
    /casagencia\.com\/inmueble\//i,
  ];
  let enlace = '';
  for (const patron of FICHA) {
    const u = urls.find(x => patron.test(x));
    if (u) { enlace = u.split('?')[0]; break; }
  }

  // --- Lo que ha escrito el cliente -----------------------------------------
  // En los mensajes del chat de idealista el correo trae, por este orden: el
  // nombre suelto, el telefono, el correo, LO QUE HA ESCRITO y un bloque
  // "Contacto +" con lo que ha ido contestando en el portal. Eso es lo que hay
  // que contestarle: si se tira a la basura, le llega una bienvenida generica
  // que no tiene nada que ver con lo que ha preguntado.
  const ETIQUETAS_PORTAL = ['Interesado en comprar', 'Interesado en alquilar', 'Quiere información de',
    'Quiere informacion de', 'Quiere visitar el inmueble', 'Tiene pensado comprar en',
    'Tiene pensado alquilar en', 'Forma de pago', 'Necesita financiación', 'Necesita financiacion'];
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Donde acaba el valor de un campo: en cuanto asoma el siguiente, el boton de
  // responder o el bloque del inmueble.
  const CORTE_SRC = '(?=\\s*(?:' + ETIQUETAS_PORTAL.map(esc).join('|')
    + '|Contacto\\s*\\+|Responder desde|Ref\\.|C[oó]digo del anuncio|Piso en |Casa en |Chalet en )|$)';
  const CORTE = new RegExp(CORTE_SRC, 'i');

  // Cada "Etiqueta: valor" del bloque Contacto +
  const respuestas_portal = [];
  for (const et of ETIQUETAS_PORTAL) {
    // La misma etiqueta sale varias veces ("Interesado en comprar" es a la vez
    // el si/no y "1a vivienda"), asi que se cogen todas y no solo la primera.
    for (const m of cuerpo.matchAll(new RegExp(esc(et) + '\\s*:\\s*(.{1,160}?)' + CORTE_SRC, 'gi'))) {
      const valor = m[1].trim().replace(/[\s:·-]+$/, '');
      const linea = `${et}: ${valor}`;
      if (valor && !respuestas_portal.includes(linea)) respuestas_portal.push(linea);
    }
  }
  // Lo que pregunta en concreto ("Quiere información de: a que planta es")
  const preguntaPortal = (respuestas_portal.find(x => /^Quiere informaci/i.test(x)) || '')
    .replace(/^[^:]+:\s*/, '');

  // El mensaje libre: va entre su correo y el bloque de respuestas
  let mensajeCliente = '';
  if (email) {
    const tras = cuerpo.slice(cuerpo.indexOf(email) + email.length);
    mensajeCliente = tras.split(CORTE)[0].trim().replace(/^[\s:·-]+/, '');
    if (mensajeCliente.length > 400) mensajeCliente = '';   // no era el mensaje, era el correo entero
  }

  // Nombre para el saludo: el del formulario y, si no hay, el del email.
  const delEmail = (email.split('@')[0] || '').split(/[._\-\d]/)[0];
  const saludo = nombre.split(' ')[0]
    || (delEmail.length > 2 ? delEmail[0].toUpperCase() + delEmail.slice(1).toLowerCase() : '');

  const plantilla = alquiler ? PLANTILLAS.alquiler : PLANTILLAS.compra;

  return {
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
      enlace,
    operacion: alquiler ? 'alquiler' : 'venta',
    es_alquiler: alquiler,
    asesora: r.destinatario,
    asesora_conocida: r.conocida,
    email_asesora: r.email,
      // Sin telefono no se puede arrancar la conversacion: se avisa por correo
      // a la comercial y no se intenta mandar nada.
    se_puede_contactar: tel.valido,
    cuerpo_recortado: cuerpo.slice(0, 1500),
    // Lo que ha escrito y lo que ya ha contestado en el portal
    mensaje_cliente: mensajeCliente.slice(0, 600),
    pregunta: preguntaPortal.slice(0, 300),
    respuestas_portal,
      // La plantilla de bienvenida: {{1}} el nombre, {{2}} el enlace del anuncio
    plantilla: plantilla.nombre,
    idioma: plantilla.idioma,
    param1: saludo || '\u{1F44B}',
    param2: enlace || (referencia ? `ref. ${referencia}` : `tu solicitud en ${portal}`),
  };
}
