// [WA] 1 · Leads de la web · Decidir
// Junta el formulario, lo que ha entendido OpenAI del mensaje y, si hablaba de
// un inmueble concreto, si sigue en la cartera. Decide el primer WhatsApp.
const f = $('LeerFormulario').first().json;
let c = {};
try {
  const r = $('Clasificar').first().json;
  c = JSON.parse(r.choices?.[0]?.message?.content || '{}');
} catch (e) { c = {}; }
let inmueble = {};
try { inmueble = $('LeerInmueble').first().json || {}; } catch (e) { inmueble = {}; }

const referencia = String(f.referencia || c.referencia || '').toUpperCase();
// Sin mensaje pero con telefono puede ser un cliente de verdad: saludo general
const tipo = !String(f.mensaje || '').trim() && f.se_puede_contactar ? 'sin_mensaje' : (c.tipo || 'otro');
const enCartera = !!inmueble.ref;
const d = decidirPrimerMensaje({
  tipo,
  referencia,
  // Si dio una referencia y ya no esta en la cartera, ya no esta disponible
  disponible: referencia ? enCartera : null,
  enlace: inmueble.enlace || '',
  operacion: inmueble.tipo_transaccion || '',
  nombre: f.nombre,
  idioma: f.idioma !== 'es' ? f.idioma : (c.idioma || 'es'),
  resumen_cliente: String(c.resumen_cliente || '').slice(0, 160),
  municipio: String(c.municipio || inmueble.municipio || ''),
});

return [{ json: {
  ...f,
  ...d,
  referencia,
  tipo,
  municipio: c.municipio || '',
  resumen: String(c.resumen || f.mensaje || '').replace(/\s+/g, ' ').slice(0, 400),
  enlace: inmueble.enlace || '',
  notas: `Formulario de la web (${f.origen_url || 'casagencia.com'}): ${f.mensaje}`.slice(0, 1500),
} }];
