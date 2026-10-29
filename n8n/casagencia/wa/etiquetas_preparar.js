// [WA][SUB] Etiquetar · Preparar
// Lo que se pide poner y, si llega una referencia de eGO, la etiqueta de su
// inmueble (bn-1563-v). Una referencia que no lo es (el numero de la web, una
// cortada) no se convierte en etiqueta: se ignora y se ponen las demas.
const j = $('Start').first().json;
const etiquetas = String(j.etiquetas ?? '').split(',').map(s => s.trim()).filter(Boolean);
const referencia = String(j.referencia ?? '').trim().toUpperCase();
const etiqueta_referencia = etiquetaDeReferencia(referencia);
return [{ json: {
  conversacion_id: Number(j.conversacion_id || 0),
  etiquetas: etiquetas.join(','),
  referencia: etiqueta_referencia ? referencia : '',
  etiqueta_referencia,
  hay_algo: etiquetas.length > 0 || !!etiqueta_referencia,
} }];
