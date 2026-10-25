// [WA] 1 · Entrada de leads · ParsearEmail
// El correo de un portal, leido con portal_correo.js (que se inyecta antes).
// Aqui solo se envuelve para que salga como item del nodo.
return [{ json: leerCorreoDePortal($input.first().json) }];
