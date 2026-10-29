// [WA][SUB] Etiquetar · DatosDeLaEtiqueta
// La etiqueta nueva: oculta en la barra lateral, con la referencia EXACTA de eGO
// en la descripcion (el nombre Chatwoot lo pasa a minusculas) y, si esta en la
// cartera, que inmueble es.
const p = $('Preparar').first().json;
const ficha = $input.first().json || {};
return [{ json: { etiqueta: datosEtiquetaReferencia(p.referencia, ficha.tipo_inmueble ? ficha : null) } }];
