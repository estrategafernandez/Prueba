# Asistente IA Citas Tendenze Franquicias — dos arreglos

Workflow `wWpFELMAYSrkzBnZ`, **activo**. Se cambiaron dos nodos; el resto
(125 nodos, conexiones y ajustes) quedó intacto.

`franquicias_backup_antes_del_arreglo.json` es la copia previa al cambio, por si
hay que revertir. Lleva los tokens sustituidos por marcadores.

## 1. Token inválido en el fallback de `Divide Mensajes`

`Envió Mensaje Total` usaba el token `dMV8w6z118bS78vzRuhez8Kt`, que **está
revocado**:

```
GET /api/v1/accounts/5/conversations/59/labels
  con dMV8w6z…  ->  401 {"error":"Invalid Access Token"}
  con KTmLyn…   ->  200
```

No era, como parecía al leer el flujo, que cambiara el remitente según si la
respuesta se troceaba. `Divide Mensajes` tiene `onError: continueErrorOutput`,
así que su segunda salida es la **rama de error**: `Envió Mensaje Total` es el
respaldo que manda la respuesta entera cuando falla el troceado. Con el token
muerto, ese respaldo devolvía 401 y el lead se quedaba **sin ninguna respuesta**.

Alcance real: de las **26 ejecuciones** entre el 2026-09-03 y el 2026-09-12, el
fallback **no llegó a dispararse ninguna vez** (`Divide Mensajes` además tiene
`retryOnFail`). Era una mina dormida, no una avería en curso.

Arreglo: el token pasa a `KTmLyn391cG9hHFvrrHDG65K`, el mismo de los otros siete
nodos que hablan con Chatwoot, que corresponde al agente `IA TENDENZE`.

## 2. `Cliente ID` inexistente en el contexto del agente

El campo `text` de `Agente TENDENZE` era:

```
Datos del cliente:
- Nombre: {{ $('Webhook').first().json.body.meta.sender.name }}
- Cliente ID: {{ $json.cliente }}

Mensaje del cliente: {{ $('Revertir mensajes').first().json.mensajes_invertidos }}
```

Lo que entra al agente viene del nodo `Fecha`, que solo produce `fecha` y
`hora`. `$json.cliente` no existe ahí, así que en cada turno el prompt recibía
literalmente `Cliente ID: undefined`.

Arreglo: se elimina esa línea. No se ha añadido nada en su lugar — meter la
fecha cambiaría el comportamiento del agente y eso es otra decisión.

Queda pendiente decidir qué hacer con el nodo `Fecha`: calcula `fecha` y `hora`
en cada ejecución y **nadie las usa**. O se inyectan en el prompt, o el nodo
sobra.
