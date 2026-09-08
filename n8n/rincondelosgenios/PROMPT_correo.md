# Prompt para el Claude Code que tiene el correo conectado

> Copia todo lo que hay debajo de la línea. Sustituye `<<PEGA_AQUÍ_LA_API_KEY_DE_N8N>>`
> por la API key pública de n8n antes de enviarlo.

---

Necesito que termines de conectar el envío por email de un workflow de n8n que ya
está construido y probado. Solo falta la credencial de correo y activarlo.

## Contexto

- **n8n:** `https://n8n-rincondelosgenios.serversvisionarius.com`
- **API key** (cabecera `X-N8N-API-KEY`): `<<PEGA_AQUÍ_LA_API_KEY_DE_N8N>>`
- **Workflow:** `Informe diario de cumpleaños`, ID `CbGZ0vP7icXNmNVH`, ahora mismo **desactivado**
- **Destinatario del informe:** `elrincondelosgenios31@gmail.com`
- Cliente: El Rincón de los Genios, una juguetería de Valencia.

El workflow ya funciona entero: se dispara a las 21:00 (Europe/Madrid), consulta
los cumpleaños en MySQL, comprueba en Chatwoot qué se envió hoy por WhatsApp, si
se entregó, si se leyó y si la clienta ha contestado, y construye el email.

El **último nodo** es `Enviar informe por email` (`n8n-nodes-base.gmail`,
typeVersion 2.1). Está **desactivado** (`"disabled": true`) y **sin credencial**,
porque en esta instancia de n8n no hay ninguna credencial de correo.

Le llega un único item del nodo anterior (`Construye el informe`) con estos campos:

| Campo | Contenido |
|---|---|
| `destino` | `elrincondelosgenios31@gmail.com` |
| `asunto` | p. ej. `Cumpleaños 2026-09-08 — 3 enviados, 1 leído, 1 respuesta · 2 SIN ENVIAR` |
| `html` | el cuerpo del correo, **HTML completo** |
| `total`, `enviados`, `leidos`, `contestan`, `fallidos`, `noEnviados` | los totales, por si los quieres |

## Lo que necesito que hagas

1. **Crea la credencial de correo** en n8n para poder enviar desde la cuenta de
   la clienta.

   Aviso importante: **la API pública de n8n no sirve para crear una credencial
   Gmail OAuth2 funcional**, porque el OAuth necesita el paso de consentimiento
   en el navegador. Tienes dos caminos:

   - **Recomendado — SMTP** (`POST /api/v1/credentials`, tipo `smtp`): se crea
     entera desde la API con host `smtp.gmail.com`, puerto `465`, SSL, el correo
     de la clienta y una **contraseña de aplicación** de Google. Si eliges esta
     vía hay que **sustituir el nodo** `n8n-nodes-base.gmail` por
     `n8n-nodes-base.emailSend`, manteniendo el nombre `Enviar informe por email`
     y su conexión desde `Construye el informe`, con estos parámetros:

     ```json
     {
       "fromEmail": "<correo remitente>",
       "toEmail": "={{ $json.destino }}",
       "subject": "={{ $json.asunto }}",
       "emailFormat": "html",
       "html": "={{ $json.html }}",
       "options": {}
     }
     ```

   - **Gmail OAuth2**: solo si guías a la clienta por la interfaz de n8n para
     completar el consentimiento. Si vas por aquí, el nodo actual ya está listo
     (`emailType: "html"`, `appendAttribution: false`); solo hay que asignarle la
     credencial.

2. **Asigna la credencial al nodo** y **quita el `"disabled": true`**.

3. **Prueba el envío** ejecutando el workflow a mano y comprueba que el correo
   llega a `elrincondelosgenios31@gmail.com` y que **se ve como HTML**, no como
   texto plano con las etiquetas a la vista. Es lo que más suele fallar.

4. **Activa el workflow** (`PATCH`/`POST` a `/api/v1/workflows/CbGZ0vP7icXNmNVH/activate`)
   y confírmame que queda activo.

## Cómo actualizar el workflow por API

`PUT /api/v1/workflows/CbGZ0vP7icXNmNVH` acepta **solo** los campos `name`,
`nodes`, `connections` y `settings`. Cualquier otro (`active`, `id`, `tags`,
`binaryMode`…) devuelve `400 request/body must NOT have additional properties`.
Haz un `GET` primero, modifica el nodo y devuelve el objeto recortado a esos
cuatro campos.

## Lo que NO debes tocar

- El workflow `Envío de Plantillas` (`GZLn2dFb0CAXwWRP`), que está **activo** y
  manda WhatsApp reales a clientas todos los días a las 10:00.
- El workflow `Envío de Plantillas — ORIGINAL (copia de seguridad 2026-09-08)`
  (`Gd249dBM4YDhzTSb`): es la copia para revertir, debe seguir parada.
- Los demás nodos del workflow del informe. La lógica ya está probada.
