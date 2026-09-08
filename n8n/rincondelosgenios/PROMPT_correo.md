# Prompt para el Claude Code que tiene Resend conectado

> Copia todo lo que hay debajo de la línea. Sustituye `<<API_KEY_DE_N8N>>` por la
> API key pública de n8n.

---

Tengo un workflow de n8n ya construido y probado al que solo le falta la clave de
Resend para enviar un informe diario por correo. **No hay que programar nada
nuevo**: el nodo de envío ya está montado, solo hay que darle credencial y
remitente.

## Contexto

- **n8n:** `https://n8n-rincondelosgenios.serversvisionarius.com`
- **API key** (cabecera `X-N8N-API-KEY`): `<<API_KEY_DE_N8N>>`
- **Workflow:** `Informe diario de cumpleaños`, ID `CbGZ0vP7icXNmNVH`, **desactivado**
- **Destinatario:** `elrincondelosgenios31@gmail.com`
- Cliente: El Rincón de los Genios, juguetería de Valencia.

El workflow se dispara a las 13:30 (Europe/Madrid), consulta los cumpleaños en
MySQL, comprueba en Chatwoot qué se envió hoy por WhatsApp, si se entregó, si se
leyó y si la clienta ha contestado, y compone el correo. Todo eso ya funciona:
está probado con datos reales, tanto el caso con cumpleaños como el día sin
ninguno.

**Aviso para que no te compliques:** n8n llama a la API de Resend directamente
por HTTPS. **Vercel no pinta nada aquí** — no hay que desplegar ninguna función
ni endpoint intermedio. Solo hace falta la API key y un dominio verificado en
Resend.

## Lo que ya está hecho

El nodo `Enviar informe por email` es un **HTTP Request** listo para Resend:

```
POST https://api.resend.com/emails
authentication:  genericCredentialType
genericAuthType: httpHeaderAuth        ← sin credencial asignada todavía
headers:         Content-Type: application/json
body (json):     ={{ JSON.stringify($json.resend_body) }}
```

El nodo anterior, `Construye el informe`, ya deja preparado `resend_body` con la
forma exacta que espera Resend:

```json
{ "from": "...", "to": ["elrincondelosgenios31@gmail.com"], "subject": "...", "html": "..." }
```

## Lo que necesito que hagas (3 pasos)

### 1. Credencial de Resend

Créala por API — es una cabecera fija, no lleva OAuth:

```
POST /api/v1/credentials
{
  "name": "Resend (Authorization)",
  "type": "httpHeaderAuth",
  "data": { "name": "Authorization", "value": "Bearer re_XXXXXXXX" }
}
```

Guarda el `id` que devuelve y asígnalo al nodo `Enviar informe por email`:

```json
"credentials": { "httpHeaderAuth": { "id": "<id devuelto>", "name": "Resend (Authorization)" } }
```

### 2. Remitente

En el nodo **`Construye el informe`** (nodo Code), arriba del todo hay:

```js
const REMITENTE = 'El Rincón de los Genios <informes@__TU_DOMINIO__>';
```

Cambia `__TU_DOMINIO__` por el dominio **verificado en Resend**. Si el dominio no
está verificado, Resend responde 403 y no se envía nada. Deja el nombre visible
tal cual, que queda bien en la bandeja de la clienta.

### 3. Activar

Quita el `"disabled": true` del nodo de envío y activa el workflow:
`POST /api/v1/workflows/CbGZ0vP7icXNmNVH/activate`.

## Cómo probarlo antes de darlo por bueno

No esperes a las 13:30. Duplica el workflow en uno temporal, cámbiale el
disparador por un nodo **Webhook**, actívalo y llámalo con un POST. Revisa la
ejecución por API (`/api/v1/executions/<id>?includeData=true`) y comprueba:

- que el nodo de Resend devuelve un `id` de mensaje,
- que el correo llega a `elrincondelosgenios31@gmail.com`,
- y sobre todo que **se ve como HTML**, con la tabla y las tarjetas de totales,
  no como texto plano con las etiquetas a la vista.

Borra el workflow temporal cuando termines.

## Cómo actualizar el workflow por API

`PUT /api/v1/workflows/CbGZ0vP7icXNmNVH` acepta **solo** `name`, `nodes`,
`connections` y `settings`. Cualquier otro campo (`active`, `id`, `tags`,
`binaryMode`…) devuelve `400 request/body must NOT have additional properties`.
Haz un `GET` primero, modifica y devuelve el objeto recortado a esos cuatro campos.

## Lo que NO debes tocar

- `Envío de Plantillas` (`GZLn2dFb0CAXwWRP`): está **activo** y manda WhatsApp
  reales a clientas todos los días a las 10:00.
- `Envío de Plantillas — ORIGINAL (copia de seguridad 2026-09-08)`
  (`Gd249dBM4YDhzTSb`): es la copia para revertir, debe seguir parada.
- El resto de nodos del workflow del informe. La lógica ya está probada y
  cualquier cambio ahí puede romper la detección de los envíos.
