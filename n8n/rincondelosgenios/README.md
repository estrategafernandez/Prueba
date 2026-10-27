# El Rincón de los Genios — felicitaciones de cumpleaños por WhatsApp

Automatización que, **10 días antes** del cumpleaños de cada niño registrado en
PrestaShop, crea un cupón de 5 € (mínimo de compra 30 €) y envía a su madre o
padre la plantilla de WhatsApp `descuento_2` con la imagen, el código y el botón
de copiar código.

**Horario:** los envíos salen **todos los días a las 10:00** (Europe/Madrid) y el
informe para la clienta se manda **a las 13:30**.

- **n8n:** `https://n8n-rincondelosgenios.serversvisionarius.com`
- **Chatwoot:** `https://chatwoot-rincondelosgenios.serversvisionarius.com` (v4.16.1, cuenta 1, inbox 1 `whatsapp_cloud`)
- **Tienda:** `https://elrincondelosgenios.com` (PrestaShop)

## Workflows en n8n

| Workflow | ID | Estado | Qué es |
|---|---|---|---|
| Envío de Plantillas | `GZLn2dFb0CAXwWRP` | **ACTIVO** | El de producción (10:00) |
| Reintento de cumpleaños fallidos | `1QcXQTNrJX3Co6zA` | **ACTIVO** | Rescata los fallos del día (10:30, 11:30 y 12:30) |
| Envío de Plantillas — ORIGINAL (copia de seguridad 2026-09-08) | `Gd249dBM4YDhzTSb` | parado | Copia intacta de la versión anterior, para revertir |
| Informe diario de cumpleaños | `CbGZ0vP7icXNmNVH` | parado | Informe por email con Resend. **Falta la API key** |

## Qué se ha cambiado

### 1. El envío ahora pasa por Chatwoot, no por la Graph API

Antes la plantilla se mandaba directamente a `graph.facebook.com` y en Chatwoot
solo quedaba una **nota privada** (invisible para la clienta). El panel no
registraba el envío real, así que no había forma de saber si se entregaba o se
leía, y las conversaciones eran incomprensibles para quien las mirara.

Ahora se envía con `POST /conversations/{id}/messages` incluyendo
`template_params`, que en Chatwoot 4.x dispara `Whatsapp::SendOnWhatsappService`
→ `send_template_message`. Esto:

- manda **un solo** mensaje (no se duplica con la Graph API),
- lo deja como **mensaje saliente público** en el panel, con el texto completo,
- y hace que Chatwoot reciba de Meta los webhooks de estado, así que el mensaje
  pasa por `sent` → `delivered` → `read`. **Ahí está el "si lo han leído".**

Chatwoot **no renderiza** en su interfaz ni la imagen de cabecera ni los botones
(limitación conocida), pero **sí los envía**: la clienta los recibe igual.

El formato de `processed_params` es el "enhanced" de Chatwoot 4.x:

```json
{
  "header":  { "media_url": "…/cumple.jpeg", "media_type": "image" },
  "body":    { "1": "<madre>", "2": "<peque>", "3": "<cupón>" },
  "buttons": [ { "type": "hueco" }, { "type": "copy_code", "parameter": "<cupón>" } ]
}
```

> El botón 0 de la plantilla es una URL fija sin variable, así que **no** lleva
> parámetros. Se deja un hueco (`{"type":"hueco"}`) porque
> `Whatsapp::TemplateProcessorService` usa el índice del array como índice de
> botón: sin ese hueco el `copy_code` iría al índice 0 y Meta lo rechazaría.
> El hueco se descarta solo (no es `url` y no tiene `parameter`).

### Pruebas hechas antes de dar el cambio por bueno (2026-09-08)

Se clonó el workflow en uno temporal disparado por webhook, sustituyendo **solo**
las fuentes de datos (la consulta MySQL y las dos llamadas a PrestaShop) por
datos de prueba. Los **24 nodos restantes se compararon uno a uno con los de
producción y eran idénticos**, así que lo que se ejecutó es exactamente la
cadena real, incluidas las expresiones de n8n.

| Prueba | Rama | Teléfono | Resultado |
|---|---|---|---|
| 1 | contacto ya existente | `608563923` | normalizado a `34608563923`, mensaje 5827 en la conversación 970, **`delivered`** |
| 2 | contacto nuevo | `00447700900123` | normalizado a `447700900123`, contacto y conversación creados, mensaje 5828 enviado |

La prueba 2 reproduce **el caso exacto que tumbó la ejecución del 5 de
septiembre**: antes se le añadía `+34` a un número británico y Chatwoot lo
rechazaba, abortando el resto de la lista. Ahora se resuelve bien y sigue.

Ambas ejecuciones terminaron en `success`, sin un solo nodo en error. Los
artefactos de prueba (workflow temporal y contacto del número Ofcom) se
borraron; el mensaje de la prueba 1 se dejó a propósito para poder verlo en el
panel.

### 2. Los teléfonos extranjeros ya no paran la ejecución

El 5 de septiembre una clienta con el móvil guardado como `00447969110220`
tumbó la ejecución entera: se le añadía `+34` a pelo y Chatwoot rechazaba el
contacto. Se perdió su felicitación **y la de la clienta siguiente**, sin que
nadie se enterara. Además, los números guardados con `+` (por ejemplo
`+19712120543`) se descartaban en silencio.

El nodo `Formateamos Número` ahora normaliza a E.164 de verdad:

| Entrada | Salida |
|---|---|
| `603487083` | `+34603487083` |
| `600 111 222`, `661-426-508` | `+34600111222`, `+34661426508` |
| `00447969110220` | `+447969110220` |
| `+19712120543` | `+19712120543` |
| `0034612345678` | `+34612345678` |
| vacío, `12345` | descartado **con motivo**, sin romper nada |

Si no hay `phone_mobile` se usa `phone` como respaldo. Un teléfono no válido ya
no descarta en silencio: sale en el informe diario con el motivo.

### 3. Un fallo suelto ya no aborta el resto

`GET CONTACT Cintia`, `Crea Contacto Cintia`, `Crear Conversación`,
`Coger Id conversations`, `Crear descuentos`, `Crear descuentos1` y los dos
nodos de envío llevan `onError: continueErrorOutput` con la salida de error
devuelta al bucle. Si una clienta falla, se salta esa y sigue con las demás.

También se ha fijado `timezone: Europe/Madrid` en los ajustes del workflow, que
antes dependía del valor por defecto de la instancia.

### 4. Hermanos que cumplen el mismo día

**Sin cambios, a propósito.** Si una clienta tiene dos hijos que cumplen el
mismo día recibe dos mensajes y dos cupones, que es lo que se quiere.

## Informe diario por email

`Informe diario de cumpleaños` (`CbGZ0vP7icXNmNVH`) se ejecuta **a las 13:30**,
repite la misma consulta de cumpleaños que el workflow de envío y comprueba en
Chatwoot qué pasó realmente con cada uno. Es un **auditor independiente**: no
lee el estado interno del otro workflow, así que también detecta a quien se
quedó sin mensaje.

Envía a **elrincondelosgenios31@gmail.com** una tabla con, por cada cumple:
clienta, peque, teléfono, si se envió, el estado (`Enviado` / `Entregado` /
`Leído` / `FALLIDO`), si ha contestado (distinguiendo respuestas reales de
autorespuestas) y la incidencia si no se pudo enviar. Arriba, cinco totales.

`ejemplo_informe.html` es una muestra del correo con datos de ejemplo.

El envío se hace con **Resend**: el nodo `Enviar informe por email` es un HTTP
Request a `https://api.resend.com/emails` que manda el objeto `resend_body` que
prepara el nodo anterior. n8n llama a Resend directamente, sin pasar por Vercel.

> **PENDIENTE (2 cosas):** el nodo está **desactivado** porque faltan la
> credencial `httpHeaderAuth` con `Authorization: Bearer re_…` y el remitente
> real (en `Construye el informe` pone `__TU_DOMINIO__`). Está todo detallado en
> `PROMPT_correo.md`.

### Probado (2026-09-08)

Clonado en un workflow temporal con webhook, sustituyendo solo MySQL y PrestaShop:

| Caso | Resultado |
|---|---|
| Una clienta con envío hecho | detecta el mensaje, `Enviado` / `Entregado` / sin respuesta |
| Día sin ningún cumpleaños | no revienta: informa «Hoy no había ningún cumpleaños que felicitar» |

Comprueba también que una **nota privada no cuenta como envío**, así que si algún
día se volviera al método antiguo el informe lo marcaría como no enviado.

## El incidente del 8, 26 y 27 de octubre

Tres días en los que **todos** los envíos del lote fallaron. Chatwoot guardaba
el error genérico `2: Service temporarily unavailable`, pero en una de las
muestras Meta lo concretó en **`131053: Media upload error`**.

La causa: la plantilla lleva la imagen **por enlace**, así que Meta tiene que
descargarla de `elrincondelosgenios.com` **una vez por cada mensaje**. Cuando esa
descarga le falla, el mensaje entero se cae — y como todos los del día comparten
la misma imagen, se cae el lote completo. De ahí que sea siempre todo o nada.

Se cerró con un experimento, no con una suposición. Misma plantilla, mismo
destinatario, mismos minutos, cambiando solo el host de la imagen:

| Imagen servida desde | Resultado |
|---|---|
| `elrincondelosgenios.com` | `failed` · `131053` (3 repeticiones) |
| URL inexistente (control negativo) | `failed` · `131053` |
| CDN externo (control positivo) | **entregado** |
| Copia alojada en el propio Chatwoot | **entregado** |

El fichero es válido —Meta lo acepta si se le sube directamente— y la URL
responde HTTP 200 a todo el mundo **menos a los servidores de Meta**.

### Arreglo aplicado

`Prepara Plantilla` y `Prepara Plantilla1` ya no apuntan a la web de la tienda,
sino a una copia de `cumple.jpeg` alojada como adjunto dentro de Chatwoot.

> **Es provisional.** La imagen cuelga de un mensaje concreto: si alguien borra
> esa nota interna o se purgan conversaciones antiguas, vuelve a romperse todo.
> Lo correcto es servirla desde un CDN (Vercel) y cambiar esa URL.

## Reintento automático

`Reintento de cumpleaños fallidos` (`1QcXQTNrJX3Co6zA`) corre a las **10:30,
11:30 y 12:30**. No se coordina con el workflow de envío: **reconstruye todo
leyendo Chatwoot**, así que también cubre envíos hechos a mano.

```
Conversaciones con actividad de hoy
  └─ Leer sus mensajes
     └─ Plantillas de hoy en "failed"
        ├─ agrupadas por cupón (cada cupón = una clienta)
        ├─ madre, peque y cupón se extraen del propio texto del mensaje
        └─ Reenviar con el MISMO cupón y la imagen buena
```

Las reglas de seguridad son lo importante:

- **No duplica.** Si ya existe un envío vivo con ese cupón, no se toca. Un
  `sent` cuenta como vivo: puede estar pendiente de que la clienta encienda el
  móvil.
- **No reintenta errores de destinatario**, porque reintentar no cambiaría nada:
  `131026` (no es usuario de WhatsApp), `131050` (baja de marketing), `131047`,
  `131049`, `131051`, `130472` y las familias `132xxx` y `133xxx`.
- **Margen de 5 minutos**: ignora fallos recién creados, para no pisarse con el
  envío de las 10:00.
- **Tope de 3 envíos** por clienta y día.

### Probado (2026-10-27)

Clonado en un workflow temporal por webhook, provocando un fallo real (plantilla
apuntando a una imagen inexistente):

| Comprobación | Resultado |
|---|---|
| Conversaciones revisadas | 16 |
| Detectados para reintentar | **1** — solo el fallo provocado |
| Los 15 envíos correctos del día | **intactos**, no los tocó |
| El rescate | reenviado y **entregado** |

La segunda fila es la que importa: en esas mismas conversaciones había 15
mensajes fallidos de la mañana, y no reintentó ninguno porque todos tenían ya un
envío correcto con el mismo cupón.

## Cómo revertir

Si algo va mal, en n8n:

1. Desactivar **Envío de Plantillas** (`GZLn2dFb0CAXwWRP`).
2. Activar **Envío de Plantillas — ORIGINAL (copia de seguridad 2026-09-08)** (`Gd249dBM4YDhzTSb`).

Vuelve exactamente al comportamiento anterior. `_backup_envio_plantillas_ORIGINAL.json`
es el mismo contenido en fichero.

## Pendiente / recomendado

- **Subir `cumple.jpeg` a un CDN (Vercel)** y apuntar ahí los dos nodos
  `Prepara Plantilla`. Es el único arreglo definitivo del incidente de octubre.
- **Rotar los tokens.** El de Chatwoot y el permanente de Meta están escritos a
  mano en las cabeceras de más de diez nodos en vez de estar en credenciales de
  n8n, y quedan expuestos en el JSON y en los datos de cada ejecución.
- **No hay workflow de error** configurado: si el envío revienta, nadie se entera
  hasta el informe de las 13:30.
- Quedan 8 nodos activos pero inalcanzables y 11 desactivados, herencia de otro
  cliente (los nombres «Cintia» y «Adolfo»). No estorban, pero son ruido.
- La imagen de la plantilla se sirve desde `elrincondelosgenios.com`; si la web
  cae, Meta rechaza el envío. Mejor subirla a Meta y usar el *media handle*.

## Sobre estos JSON

Son copias **con los secretos sustituidos** por marcadores:

- `__CHATWOOT_API_ACCESS_TOKEN__` → cabecera `api_access_token` de Chatwoot
- `__META_GRAPH_ACCESS_TOKEN__` → `Authorization: Bearer …` de la Graph API

Si se reimportan hay que reponerlos. Los workflows que están en n8n ya los tienen.
