// [WA][SUB] EnviarPlantilla · Normalizar
// Deja el telefono como lo quiere Meta y la plantilla con su idioma EXACTO.
const j = $('Start').first().json || {};
// {{2}} es el enlace del anuncio. Si el correo del portal no lo traia, el de la
// web de Casagencia (sale de wa_cartera, que lo construye con el id del feed).
const enlaceWeb = String($input.first().json?.enlace ?? '').trim();
// {{3}} de la bienvenida de alquiler: si es temporal o de larga duracion. Lo
// normal es que lo mande quien llama (decidirPrimerMensaje); si no, se mira la
// cartera, que es de donde sale.
const modalidadCartera = String($input.first().json?.modalidad ?? '').trim();
const esUrl = (x) => /^https?:\/\//.test(String(x ?? '').trim());
const tel = normalizarTelefono(j.telefono);
const alquiler = esAlquiler(j.referencia, j.operacion);
const porDefecto = alquiler ? PLANTILLAS.alquiler : PLANTILLAS.compra;

// Si llega una plantilla conocida, su idioma sale de la configuracion: el que
// venga de fuera puede estar mal y Meta rechaza el envio por eso.
const conocida = Object.values(PLANTILLAS).find(p => p.nombre === String(j.plantilla || '').trim());
const plantilla = conocida || porDefecto;

return [{
  json: {
    telefono_e164: tel.e164,
    wa_id: tel.wa_id,
    telefono_valido: tel.valido,
    nombre: String(j.nombre || '').trim(),
    // El correo de la solicitud, para ponerlo en el contacto del panel
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(j.email ?? '').trim()) ? String(j.email).trim().toLowerCase() : '',
    referencia: String(j.referencia || '').toUpperCase(),
    operacion: alquiler ? 'alquiler' : 'venta',
    portal: String(j.portal || ''),
    plantilla: plantilla.nombre,
    idioma: plantilla.idioma,
    param1: paramPlantilla(j.param1 || String(j.nombre || '').split(' ')[0] || '\u{1F44B}', 60),
    // En las bienvenidas {{2}} es el enlace; en la plantilla abierta es un texto
    param2: plantilla.nombre === PLANTILLAS.abierta.nombre
      ? paramPlantilla(j.param2 || '', 900)
      : paramPlantilla(esUrl(j.param2) ? j.param2
        : (enlaceWeb || j.param2 || (j.referencia ? 'ref. ' + j.referencia : 'tu solicitud')), 300),
    // {{3}} solo existe en la bienvenida de alquiler. Nunca puede ir vacio:
    // Meta rechaza el envio con un parametro en blanco.
    param3: plantilla.nombre !== PLANTILLAS.alquiler.nombre ? ''
      : paramPlantilla(String(j.param3 || '').trim() || MODALIDAD_PLANTILLA[modalidadCartera]
        || MODALIDAD_PLANTILLA_SIN_SABER, 300),
    conversacion_id: Number(j.conversacion_id || 0),
    // En el panel, la conversacion para la asesora de la referencia (como el telefono)
    asesora: resolverAsesora(j.referencia).destinatario,
    // Si la comercial de la zona esta de vacaciones, la conversacion es de quien
    // la sustituye (y vuelve a ser suya sola cuando vuelve)
    agente_id: esPrueba(j.telefono) ? 0 : agenteDeHoy(resolverAsesora(j.referencia).destinatario),
  }
}];
