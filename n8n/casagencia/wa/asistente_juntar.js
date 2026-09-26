// [WA] 2 · Asistente · JuntarMensajes
// El cliente suele escribir en varios mensajes seguidos ("hola" / "queria ver
// el piso" / "el de la calle X"). Se han esperado 60 segundos; aqui se recogen
// todos los que haya puesto y se le pasan al agente como UN solo mensaje.
//
// Redis los guarda con LPUSH, o sea el mas nuevo primero. El nodo anterior ya
// ha comprobado que el mas nuevo es el nuestro: si no lo fuera, este turno se
// abandonaria y contestaria el ultimo, para no responder dos veces.
const d = $('EntradaMensaje').first().json;
const bruto = $('LeerBuffer').first().json.message;
const cola = Array.isArray(bruto) ? bruto : (bruto ? [bruto] : []);

const mensajes = [...cola].reverse().map(x => String(x).trim()).filter(Boolean);

return [{
  json: {
    mensaje: mensajes.length ? mensajes.join('\n') : d.contenido,
    numero_de_mensajes: mensajes.length || 1,
    telefono_e164: d.telefono_e164,
    telefono_wa: d.telefono_wa,
    nombre: d.nombre,
    conversacion_id: d.conversacion_id,
    contacto_id: d.contacto_id,
    cuenta_id: d.cuenta_id,
  }
}];
