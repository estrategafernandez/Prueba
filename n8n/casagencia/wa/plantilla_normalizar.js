// [WA][SUB] EnviarPlantilla · Normalizar
// Deja el telefono como lo quiere Meta y la plantilla con su idioma EXACTO.
const j = $('Start').first().json || {};
// {{2}} es el enlace del anuncio. Si el correo del portal no lo traia, el de la
// web de Casagencia (sale de wa_cartera, que lo construye con el id del feed).
const enlaceWeb = String($input.first().json?.enlace ?? '').trim();
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
    referencia: String(j.referencia || '').toUpperCase(),
    operacion: alquiler ? 'alquiler' : 'venta',
    portal: String(j.portal || ''),
    plantilla: plantilla.nombre,
    idioma: plantilla.idioma,
    param1: paramPlantilla(j.param1 || String(j.nombre || '').split(' ')[0] || '\u{1F44B}', 60),
    param2: paramPlantilla(esUrl(j.param2) ? j.param2
      : (enlaceWeb || j.param2 || (j.referencia ? 'ref. ' + j.referencia : 'tu solicitud')), 300),
    conversacion_id: Number(j.conversacion_id || 0),
  }
}];
