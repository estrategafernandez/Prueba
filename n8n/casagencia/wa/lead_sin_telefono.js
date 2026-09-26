// [WA] 1 · Entrada de leads · AvisoSinTelefono
// Si el correo del portal no trae un telefono usable no hay WhatsApp posible.
// En vez de perder el lead, se le manda el aviso a la asesora que le toca.
const j = $input.first().json;
const destinos = [j.email_asesora || EMAIL_POR_ASESORA.Laurence, EMAIL_DIRECCION]
  .filter(Boolean).join(', ');

return [{
  json: {
    destinatarios: destinos,
    asunto: `LEAD SIN TELEFONO (${j.portal}): ${j.referencia || 'sin referencia'}`,
    cuerpo: [
      'Ha entrado un lead de un portal pero el correo no trae un telefono valido,',
      'asi que la IA no ha podido arrancar la conversacion de WhatsApp.',
      '',
      `Portal: ${j.portal}`,
      `Inmueble: ${j.referencia || 'sin referencia'}`,
      `Operacion: ${j.operacion}`,
      `Nombre: ${j.nombre || 'sin nombre'}`,
      `Email del cliente: ${j.email_cliente || 'sin email'}`,
      '',
      'Asunto del correo original:',
      j.asunto,
      '',
      'Texto del correo (recortado):',
      j.cuerpo_recortado,
    ].join('\n'),
  }
}];
