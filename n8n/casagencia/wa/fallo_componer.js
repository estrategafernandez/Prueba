// [WA] 13 · Envios que no llegan · ComponerAviso
// El aviso a la comercial: a quien no le ha llegado, por que, y por donde se le
// puede contestar. Se le pasa la conversacion a una persona (4-intervenir) para
// que el bot no siga hablando solo contra una pared.
const j = $('SoloLosNuevos').first().json;
const tel = j.telefono_e164 || ('+' + String(j.telefono_wa || ''));
const porCorreo = String(j.email_cliente || '').trim();

const linea = j.hay_que_llamar
  ? `No le ha llegado el WhatsApp a ${j.nombre || tel}: ${j.motivo}. Llamale tu`
  : `No le ha llegado el WhatsApp a ${j.nombre || tel}: ${j.motivo}`;

return [{ json: {
  ...j,
  aviso: {
    accion: 'NO LE LLEGA',
    destinatario: j.asesora,
    referencia: j.referencia || '',
    cliente_nombre: j.nombre || '',
    cliente_telefono: tel,
    resumen: [linea, porCorreo ? `correo: ${porCorreo}` : 'sin correo'].join(' · '),
    detalle: [
      `A ${j.nombre || tel} NO le ha llegado el mensaje de WhatsApp.`,
      `Motivo: ${j.motivo}.`,
      j.codigo ? `(codigo de WhatsApp ${j.codigo})` : '',
      '',
      `Telefono: ${tel}`,
      porCorreo ? `Correo: ${porCorreo}` : 'No dejo correo.',
      j.referencia ? `Inmueble: ${j.referencia}` : '',
      '',
      j.hay_que_llamar
        ? 'Contactale tu por telefono o por correo: por WhatsApp no se le puede.'
        : 'Se revisa por nuestra parte; no hace falta que hagas nada.',
    ].filter(Boolean).join('\n'),
    conversacion_id: Number(j.conversacion_id || 0),
    pasar_a_humano: true,
    etiqueta: ETIQUETAS.intervenir,
  },
} }];
