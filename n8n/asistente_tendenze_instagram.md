# Asistente Tendenze - Instagram

Asistente conversacional para los DM de Instagram, sobre Chatwoot.

- **Instancia n8n:** `https://n8n-tendenze.serversvisionarius.com`
- **ID del workflow:** `Du50z3ZBQwr6jGRF`
- **Estado:** escenario **base**, creado **desactivado**.
- **Origen:** subgrafo activo de `Asistente IA Citas Tendenze Franquicias`
  (`wWpFELMAYSrkzBnZ`), que **no se ha modificado**.

## Webhook

```
Producción: https://n8n-tendenze.serversvisionarius.com/webhook/a7f1c93e-4d62-4b85-9e17-2c6b8f0d5a41
Pruebas:    https://n8n-tendenze.serversvisionarius.com/webhook-test/a7f1c93e-4d62-4b85-9e17-2c6b8f0d5a41
```

Se alimenta del webhook de Chatwoot (evento de mensaje creado), igual que el de
Franquicias. La URL de pruebas solo escucha mientras el workflow está abierto en
el editor con *Listen for test event*.

## Clave de sesión

Instagram no tiene número de teléfono, así que la clave deja de ser el teléfono
y pasa a ser el **`conversation_id` de Chatwoot**, prefijado con la cuenta:

```
instagram:<account_id>:<conversation_id>
```

El prefijo importa: los `conversation_id` de Chatwoot son correlativos **por
cuenta**, así que sin él la conversación 5 de Instagram compartiría buffer y
memoria con la conversación 5 de otra cuenta. Redis y Postgres están compartidos
con los demás asistentes.

Se calcula una sola vez, en `Variable Conversacion/Mensaje` (campo
`clave_buffer`), y de ahí la leen los tres nodos de Redis y la memoria.

- Memoria: tabla **`n8n_chat_histories_instagram`**, 40 mensajes de ventana.
  El nodo de memoria crea la tabla solo la primera vez.

## Flujo

```
Webhook (Chatwoot)
  └─ Solo cuenta Instagram        DESACTIVADO — falta el account_id
     └─ Bot sin seleccionar no hacer nada
        └─ Bot on/off             custom_attributes.bot == "Off" -> no responde
           └─ Contenido del mensaje
              └─ Variable Conversacion/Mensaje    conversacion_id, cuenta_id, clave_buffer, mensaje
                 └─ Botón de Off/On/Nada
                    └─ Switch          audio | imagen | texto
                       ├─ audio  ─ Descarga el audio ─ Transcribe OpenAI ─ Variable Response ┐
                       ├─ imagen ─ Variable Imagen ───────────────────────────────────────── ┤
                       └─ texto  ─ Date & Time1 ─ Variable Response1 ───────────────────────  ┘
                                                                                             │
                          Variable Mensaje ──────────────────────────────────────────────────┘
                            └─ Push Redis ─ Espera 60 s ─ Obtiene todos los Mensajes
                               └─ If6 ─ Variable Conversacion/Mensaje1 ─ Borra mensajes de Redis
                                  └─ Date & Time3/2 ─ Revertir mensajes ─ Code ─ Fecha
                                     └─ Agente TENDENZE
                                        ├─ OpenAI Chat Model3
                                        ├─ Postgres Chat Memory1
                                        ├─ cambiar_etiquetas (tool)
                                        ├─ ok  ─ Divide Mensajes
                                        │         ├─ Envio 1º…5º Mensaje (con esperas)
                                        │         └─ Envió Mensaje Total
                                        └─ error ─ Envio Fallo Modelo1
```

**Agrupador de mensajes:** cada mensaje entrante se acumula en una lista de Redis
y se esperan 60 s antes de leerlos todos juntos, para que tres mensajes seguidos
del contacto produzcan una sola respuesta en vez de tres.

**Respuesta troceada:** `Divide Mensajes` parte la respuesta del agente en hasta
5 mensajes que se envían con esperas, para que el DM se lea como escribe una
persona. Si no hace falta trocear, sale por `Envió Mensaje Total`.

## Qué se dejó fuera del original, y por qué

El asistente de Franquicias tiene 125 nodos, pero **solo 54 están cableados al
webhook**. Los otros 61 están sueltos en el lienzo y no se ejecutan nunca:

- Las tools de citas, bonos, clientes y Shopify (`crear_cita`, `anular_cita`,
  `buscar_disponibilidad`, `GenerarEnlaceDtoShopify`…). El agente de Franquicias
  solo tiene conectada **una** tool: `cambiar_etiquetas`.
- El vector store `Base de Conocimiento` y toda la ingesta
  `Google Drive Trigger → Download → Text Splitter → Add to Supabase`.

Clonar la ingesta habría sido activamente dañino: dos workflows volcando los
mismos documentos en la misma tabla de Supabase duplican los vectores y empeoran
la recuperación **de los dos** asistentes. Si el asistente de Instagram necesita
base de conocimiento, lo correcto es **leer** del vector store existente, no
montar una segunda ingesta.

## Cambios respecto al original

| | Franquicias | Instagram |
|---|---|---|
| Clave de sesión y buffer | `sender.phone_number` | `instagram:<cuenta>:<conversación>` |
| Tabla de memoria | `n8n_chat_histories_franquicias` | `n8n_chat_histories_instagram` |
| Token de Chatwoot | dos distintos (ver abajo) | uno solo |
| Contexto al agente | `Cliente ID: {{ $json.cliente }}` → indefinido | nombre, conversación, fecha y hora |
| Nodos | 125 (54 vivos) | 58 (54 vivos + guarda + 3 notas) |

Dos arreglos que conviene conocer porque **el original sigue teniendo ambos**:

1. **Token inconsistente.** En Franquicias, `Envió Mensaje Total` usa un
   `api_access_token` distinto del de `Envio 1º…5º Mensaje`, así que el
   remitente que aparece en Chatwoot cambia según si la respuesta se troceó o
   no. Aquí se ha unificado.
2. **`Cliente ID` indefinido.** El contexto del agente incluía
   `{{ $json.cliente }}`, campo que en ese punto del flujo no existe, así que al
   prompt llegaba `Cliente ID: undefined` en cada turno.

## Cuenta

Atiende **solo la cuenta 7** de Chatwoot (Instagram). El filtro está en el nodo
`Solo cuenta Instagram`, ya activo: cualquier webhook de otra cuenta se
descarta. La clave de sesión queda `instagram:7:<conversation_id>`.

## Permisos: resueltos

`IA TENDENZE` es administrador de la cuenta 7 y el token del workflow accede
sin problemas. Comprobado contra la API:

```
GET /accounts/7/inboxes       -> 200
GET /accounts/7/conversations -> 200
GET /accounts/7/labels        -> 200
GET /accounts/7/contacts      -> 200
```

La tool `cambiar_etiquetas` (`UqWUJbxUgMGjIeSn`) toma `CuentaId` del webhook y
usa este mismo token, así que funciona con la cuenta 7 sin tocar nada.

## Pendiente

1. **Conectar el canal de Instagram.** La cuenta 7 aún no tiene ningún inbox
   (`/accounts/7/inboxes` devuelve vacío) y 0 conversaciones. Sin inbox no hay
   webhook que dispare este workflow.
2. **Prompt definitivo** → nodo `Agente TENDENZE`. Lleva uno provisional que
   solo fija idioma, tono y los límites mínimos.
3. **Webhook de Chatwoot** de la cuenta 7 apuntando a la URL de producción.
4. **Etiquetas.** La cuenta 7 no tiene ninguna definida. Si el prompt va a
   apoyarse en `cambiar_etiquetas`, hay que decidir qué taxonomía crear ahí.
5. **Carpeta**: la API pública de n8n no expone carpetas, hay que moverlo
   arrastrándolo en la interfaz.

## Sobre este JSON

`asistente_tendenze_instagram.json` lleva el token de Chatwoot sustituido por
`__CHATWOOT_API_ACCESS_TOKEN__` para no publicarlo en el repositorio. El
workflow que está en n8n sí lo tiene puesto.
