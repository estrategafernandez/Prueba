// [WA] 13 · Envios que no llegan · PrepararReenvio
// Lo que hace falta para volver a mandarle la MISMA plantilla, a la MISMA
// conversacion. No se reconstruye del mensaje fallido (Chatwoot no guarda ahi
// los parametros): se saca de su ficha, que es de donde salio la primera vez.
// El enlace y el {{3}} del alquiler los vuelve a resolver EnviarPlantilla
// mirando la cartera, asi que aqui no hay que tocarlos.
return $input.all().map((i) => {
  const j = i.json;
  const nombre = String(j.nombre || '').trim();
  return { json: {
    ...j,
    telefono: j.telefono_e164 || ('+' + String(j.telefono_wa || '')),
    // La plantilla abierta lleva un texto libre en el {{2}} que la ficha NO
    // guarda: no se puede repetir. En su lugar va la bienvenida que le toque
    // (compra o alquiler), que EnviarPlantilla rellena con la cartera.
    plantilla: [PLANTILLAS.abierta.nombre, PLANTILLAS.aviso.nombre].includes(j.plantilla)
      ? '' : (j.plantilla || ''),
    param1: paramPlantilla(nombre.split(/\s+/)[0] || '\u{1F44B}', 60),
    // {{2}} lo rellena EnviarPlantilla con el enlace de la cartera si va vacio
    param2: j.enlace || '',
    param3: '',
    operacion: j.operacion || '',
    portal: j.portal || '',
    email: j.email_cliente || '',
  } };
});
