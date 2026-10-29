// [WA][SUB] guardarCualificacion · Preparar
// Guarda lo que el cliente ha contestado y decide que pasa despues:
//
//   COMPRA   -> dos preguntas: si necesita vender para comprar (y si es que
//               si, donde esta esa vivienda: la conversacion se marca con la
//               etiqueta "7-vendedor") y como lo va a financiar. Se guardan y
//               Sara ofrece la visita.
//   ALQUILER -> tres preguntas: personas, ingresos y mascotas. Se guardan, se
//               avisa al comercial y la conversacion pasa a una persona: en
//               alquiler la IA no agenda, decide el equipo.
// Cuanto lleva buscando y la fecha de entrada ya no se preguntan (las averigua
// la asesora al llamar), pero los campos siguen: pueden venir del telefono o
// decirlos el cliente por su cuenta, y entonces se guardan igual.
// Lo que manda Sara llega por Start; antes pasa por ResolverReferencia, que
// cambia el numero del enlace de la web (p. ej. "26699629-A") por la referencia
// de la cartera ("BN-C-126-A"), que es la que decide a que asesora va el aviso.
const nodo = (n) => { try { return $(n).first().json; } catch (e) { return null; } };
const j = nodo('Start') || $input.first().json || {};
const tel = normalizarTelefono(j.telefono);
const c = nodo('ResolverReferencia') || {};
const referencia = referenciaBuena(c.ref_cartera, j.referencia, c.ref_del_lead);
const alquiler = esAlquiler(referencia, j.operacion);
const r = resolverAsesora(referencia);

const limpio = (v) => {
  const s = String(v ?? '').trim();
  return s && !['undefined', 'null'].includes(s.toLowerCase()) ? s : '';
};

const campos = {
  q_tiempo_buscando: limpio(j.tiempo_buscando),
  q_necesita_vender: limpio(j.necesita_vender),
  q_vivienda_venta:  limpio(j.vivienda_a_vender),
  q_financiacion:    limpio(j.financiacion),
  q_personas:        limpio(j.personas),
  q_ingresos:        limpio(j.ingresos),
  q_mascotas:        limpio(j.mascotas),
  q_entrada:         limpio(j.entrada),
  q_duracion:        limpio(j.duracion),
  q_actividad:       limpio(j.actividad),
};

const respuestas = alquiler
  ? [['Personas', campos.q_personas], ['Ingresos', campos.q_ingresos],
     ['Mascotas', campos.q_mascotas], ['Entrada', campos.q_entrada],
     ['Todo el ano o temporada', campos.q_duracion], ['Actividad', campos.q_actividad]]
  : [['Lleva buscando', campos.q_tiempo_buscando], ['Necesita vender para comprar', campos.q_necesita_vender],
     ['Vivienda que tiene que vender', campos.q_vivienda_venta], ['Financiacion', campos.q_financiacion]];

// Vendedor: lo dice Sara (es_vendedor), o ha dado la zona de la vivienda que
// vende, o su respuesta es un si. Es tambien un posible encargo de venta.
const vendedor = !alquiler && (j.es_vendedor === true || String(j.es_vendedor).toLowerCase() === 'true'
  || !!campos.q_vivienda_venta || esAfirmativo(campos.q_necesita_vender));

const resumen = limpio(j.resumen);

return [{
  json: {
    telefono_e164: tel.e164,
    telefono_wa: tel.wa_id,
    nombre: limpio(j.nombre),
    referencia,
    operacion: alquiler ? 'alquiler' : 'venta',
    es_alquiler: alquiler,
    es_vendedor: vendedor,
    etiqueta_vendedor: ETIQUETA_VENDEDOR,
    asesora: r.destinatario,
    // En alquiler pasa al equipo solo cuando estan las cuatro respuestas (lo mira
    // ¿Alquiler completo? con lo que queda guardado, que junta las de varias veces)
    estado: alquiler ? 'alquiler_cualificando' : 'cualificado',
    ...campos,
    campos_con_dato: Object.entries(campos).filter(([, v]) => v).map(([k]) => k),
    resumen_sara: resumen,
    conversacion_id: Number(j.conversacion_id || 0),
    // Lo que necesita el aviso al equipo (solo se usa en alquiler)
    aviso: {
      accion: 'INTERVENIR',
      destinatario: r.destinatario,
      referencia,
      cliente_nombre: limpio(j.nombre),
      cliente_telefono: tel.e164,
      // Al WhatsApp, lo corto: las respuestas en pocas palabras (el detalle va a eGO)
      resumen: [ 'ALQUILER cualificado', respuestas.filter(([, v]) => v).map(([, v]) => recortar(v, 45)).join(' · '),
                 resumen ].filter(Boolean).join(' · '),
      detalle: [
        'Lead de ALQUILER cualificado por WhatsApp. La IA no agenda en alquiler:',
        'decide tu si le das visita.', '',
        ...respuestas.map(([k, v]) => `${k}: ${v || 'no facilitado'}`), '',
        `Resumen: ${resumen || 'sin resumen'}`,
      ].join('\n'),
      conversacion_id: Number(j.conversacion_id || 0),
      pasar_a_humano: true,
      etiqueta: '',
    },
    // En compra lo que falta y como cerrar lo decide Respuesta, que ya tiene
    // delante la ficha guardada y sabe si la visita esta pre-reservada.
    falta_compra: alquiler ? [] : [
      ...(vendedor && !campos.q_vivienda_venta
        ? ['la direccion o zona de la vivienda que tiene que vender'] : []),
      ...(!campos.q_financiacion
        ? ['como lo va a financiar (hipoteca, recursos propios o hipoteca ya preconcedida)'] : []),
    ],
    marcado_vendedor: vendedor,
    respuesta: alquiler
      // (la de alquiler la completa Respuesta con el nombre de la asesora que recibe el aviso)
      ? `Respuestas guardadas. Dile al cliente que le pasas sus datos a ${quienSeEncarga(r.destinatario)} y que se `
        + 'pondra en contacto con el para organizar la visita. No le ofrezcas fecha ni hora.'
      : 'Respuestas guardadas.',
    // El aviso de compra solo sale cuando la visita YA esta pre-reservada: la
    // asesora recibio la pre-reserva sin estos datos porque todavia no existian.
    aviso_compra: {
      accion: 'DATOS PARA LA VISITA',
      destinatario: r.destinatario,
      referencia,
      cliente_nombre: limpio(j.nombre),
      cliente_telefono: tel.e164,
      resumen: ['Datos del cliente para la visita',
                respuestas.filter(([, v]) => v).map(([k, v]) => `${k}: ${recortar(v, 45)}`).join(' · '),
                resumen].filter(Boolean).join(' · '),
      detalle: ['Lead de COMPRA con la visita ya pre-reservada. Estos son los datos que ha dado',
                'DESPUES de reservarla, para que vayas con contexto.', '',
                ...respuestas.map(([k, v]) => `${k}: ${v || 'no facilitado'}`), '',
                `Resumen: ${resumen || 'sin resumen'}`].join('\n'),
      conversacion_id: Number(j.conversacion_id || 0),
      // No es una intervencion: la visita sigue su curso y la IA sigue atendiendo
      pasar_a_humano: false,
      etiqueta: '',
    },
  }
}];
