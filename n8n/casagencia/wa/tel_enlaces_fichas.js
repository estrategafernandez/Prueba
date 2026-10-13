// [TEL] EnviarPorWhatsApp · FilasDeLosInmuebles
// Una fila por cada inmueble que se le ha mandado, para dar de alta su ficha en
// wa_leads. Asi, cuando el cliente conteste por WhatsApp, Sara ya sabe de que
// inmuebles se habia hablado por telefono y tiene su ficha delante.
const c = $('ComponerMensaje').first().json;
const enviadas = new Set(c.referencias_enviadas.map(r => String(r).toUpperCase()));
const inmuebles = $('BuscarEnlaces').all().map(i => i.json)
  .filter(r => r && enviadas.has(String(r.ref).toUpperCase()));

return inmuebles.map(r => {
  const alquiler = String(r.tipo_transaccion || '').toLowerCase().includes('alquil');
  return { json: {
    telefono_wa: c.telefono_wa,
    telefono_e164: c.telefono_e164,
    referencia: String(r.ref),
    nombre: c.nombre,
    operacion: alquiler ? 'alquiler' : 'venta',
    es_alquiler: alquiler,
    asesora: resolverAsesora(r.ref).destinatario,
    enlace: String(r.enlace || ''),
  } };
});
