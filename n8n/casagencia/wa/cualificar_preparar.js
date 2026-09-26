// [WA][SUB] Cualificar lead · Preparar
// Recoge lo que el agente ha averiguado, lo deja listo para guardar en la ficha
// del lead y redacta el aviso para la asesora.
//
// Regla de Paco: en ALQUILER no se agenda visita. Se cualifica con las cuatro
// preguntas y llama la asesora. Aqui es donde se cierra ese circulo.
const j = $input.first().json || {};
const tel = normalizarTelefono(j.telefono);
const referencia = String(j.referencia ?? '').toUpperCase().trim();
const alquiler = esAlquiler(referencia, j.operacion);
const r = resolverAsesora(referencia);
const asesora = r.asesora || 'Laurence';

const limpio = (v) => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'undefined' ? s : '';
};

const campos = {
  q_personas:     limpio(j.personas),
  q_ingresos:     limpio(j.ingresos),
  q_mascotas:     limpio(j.mascotas),
  q_entrada:      limpio(j.entrada),
  q_duracion:     limpio(j.duracion),
  q_cuando:       limpio(j.cuando),
  q_zona:         limpio(j.zona),
  q_presupuesto:  limpio(j.presupuesto),
  q_financiacion: limpio(j.financiacion),
};

const etiquetas = alquiler
  ? [['Personas', campos.q_personas], ['Ingresos / contrato', campos.q_ingresos],
     ['Mascotas', campos.q_mascotas], ['Cuando quiere entrar', campos.q_entrada],
     ['Todo el ano o temporada', campos.q_duracion]]
  : [['Para cuando quiere comprar', campos.q_cuando], ['Zona', campos.q_zona],
     ['Presupuesto', campos.q_presupuesto], ['Financiacion', campos.q_financiacion]];

const cuerpo = [
  alquiler
    ? 'LEAD DE ALQUILER CUALIFICADO POR WHATSAPP. En alquiler no se agenda visita: hay que llamarle.'
    : 'LEAD DE COMPRA CUALIFICADO POR WHATSAPP.',
  '',
  `Cliente: ${limpio(j.nombre) || 'sin nombre'}`,
  `Telefono: ${tel.e164}`,
  `Inmueble: ${referencia || 'sin referencia'}`,
  `Operacion: ${alquiler ? 'alquiler' : 'venta'}`,
  `Asesora: ${asesora}`,
  '',
  ...etiquetas.map(([k, v]) => `${k}: ${v || 'no facilitado'}`),
  '',
  `Resumen de la conversacion: ${limpio(j.resumen) || 'sin resumen'}`,
  '',
  'Aviso generado por Sara (IA) desde WhatsApp.',
].join('\n');

// Solo se escriben en la ficha los campos que traen dato: asi una segunda
// llamada a la herramienta no borra lo que ya habiamos apuntado.
const conDato = Object.entries(campos).filter(([, v]) => v !== '');

return [{
  json: {
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    telefono_valido: tel.valido,
    nombre: limpio(j.nombre),
    referencia,
    operacion: alquiler ? 'alquiler' : 'venta',
    es_alquiler: alquiler,
    asesora,
    estado: alquiler ? 'cualificado_alquiler' : 'cualificado',
    etiqueta: alquiler ? ETIQUETAS.alquiler : ETIQUETAS.cualificado,
    ...campos,
    hay_datos: conDato.length > 0,
    campos_con_dato: conDato.map(([k]) => k),
    destinatarios: [r.email, EMAIL_DIRECCION].filter(Boolean).join(', '),
    email_asunto: `${alquiler ? 'LEAD ALQUILER' : 'LEAD COMPRA'} (WhatsApp): `
      + `${referencia || 'sin referencia'} - ${limpio(j.nombre) || 'sin nombre'} - ${tel.e164}`,
    email_cuerpo: cuerpo,
    respuesta: alquiler
      ? 'Ficha guardada y aviso enviado a ' + asesora + '. Recuerdale al cliente que en alquiler '
        + 'la visita la concierta la asesora y que ella le llama. NO le ofrezcas fecha ni hora.'
      : 'Ficha guardada y aviso enviado a ' + asesora + '. Ya puedes seguir con la visita: '
        + 'consulta los huecos y confirmala.',
  }
}];
