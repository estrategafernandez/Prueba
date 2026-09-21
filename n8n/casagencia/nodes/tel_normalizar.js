// BuscarCitaPorTelefono · NormalizarTelefono
const body = ($input.first().json.body) ?? {};
const ahora = DateTime.now().setZone(ZONA);
const tel = normalizarTelefono(body.telefono);

return [{
  json: {
    telefono_e164: tel.e164,
    telefono_nacional: tel.nacional,
    telefono_digitos: tel.digitos,
    telefono_valido: tel.valido,
    // Ventana de busqueda. n8n recorre los dos calendarios de forma secuencial,
    // asi que ampliarla penaliza directamente el tiempo de respuesta en llamada.
    desde_iso: ahora.minus({ days: 3 }).startOf('day').toISO(),
    hasta_iso: ahora.plus({ days: 60 }).endOf('day').toISO(),
    ahora_iso: ahora.toISO()
  }
}];
