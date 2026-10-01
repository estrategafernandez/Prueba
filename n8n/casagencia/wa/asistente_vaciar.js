// [WA] 2 · Asistente · Uno por mensaje  (seccion "Recolectar inputs")
// En vez de leer la cola y luego borrarla (si el cliente escribe justo entre
// las dos cosas, ese mensaje se perderia), se SACAN los mensajes de Redis uno
// a uno: el nodo siguiente hace un RPOP por cada item que sale de aqui. Se
// piden unos cuantos de mas por si entra alguno en ese momento; los que sobran
// vuelven vacios y no pasa nada.
const g = $('Obtiene todos los Mensajes').first().json.message;
const n = Array.isArray(g) ? g.length : (g ? 1 : 0);
return Array.from({ length: n + 5 }, (_, i) => ({ json: { vez: i + 1 } }));
