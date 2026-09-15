# Asistente Ceballos — estado y actuaciones

Proyecto del Asistente de WhatsApp y del Asistente Telefónico de Inmobiliaria Ceballos.
La carpeta de **Automatización Documental / CRM Documental no se toca**.

- **Instancia n8n:** `https://n8n-inmo-ceballos.serversvisionarius.com`
- **Chatwoot de Ceballos:** `https://panel-inmoceballos.serversvisionarius.com` — cuenta **1**, inbox **1** (WhatsApp)
- **CRM InmoPlus (SBInmo):** `https://api.sbinmo.com` — catálogo `Ceballos`
- **Documentación de la API:** swagger por módulos, copiada en `n8n/inmoplus/*.json`

## Workflows

| ID | Nombre | Estado | Papel |
|---|---|---|---|
| `5ZZUUZGYsemFNYfX` | Asistente Whatsapp | activo | Agente de cualificación (109 nodos) |
| `240TvnaNUjhVNqwD` | Captación Leads | parado | Leads de InmoPlus → contacto y plantilla en Chatwoot |
| `UBADD6Fb75rAGFuC` | Busqueda Inmuebles | activo | Búsqueda por referencia en InmoPlus |
| `G3qBXfs4GYyVJsZT` | Llamadas entrantes | esqueleto | Webhook de Retell, sin lógica |
| `1Z8IXpt3YyYPb1ua` | Automatización Documental | activo | **No tocar** |

## 2026-09-14 — Reconducción del Chatwoot

El workflow `Asistente Whatsapp` estaba **activo** y escribía en el Chatwoot de
otro cliente (Vivalta). La regla de automatización `n8n-out` del Chatwoot de
Ceballos sí alimenta su webhook, así que el circuito estaba vivo: cada mensaje
entrante de Ceballos provocaba lecturas y escrituras de contactos en el panel
ajeno. Incidente de protección de datos en ambas direcciones.

Cambios aplicados sobre los 12 nodos afectados:

- `vivalta-panel.serversvisionarius.com/api/v1/accounts/2` → `panel-inmoceballos.serversvisionarius.com/api/v1/accounts/1`
- `chatwoot-production-5c6f.up.railway.app/api/v1/accounts/3` → el mismo destino
- `api_access_token` unificado al token de Ceballos (12 cabeceras)
- `assignee_id: 8` (agente de Vivalta) → `assignee_id: 1` (IA Ceballos, único agente que existe)

Verificado contra el servidor: 0 restos ajenos, 12 URLs correctas, un solo token,
109 nodos y el workflow sigue activo. Copia previa redactada en
`n8n/backups/asistente_whatsapp_ANTES_de_reconducir_chatwoot.json`.

### Lo que NO se ha tocado en esta pasada

- Los nombres de nodo siguen diciendo «Vivalta» (`GET CONTACT Vivalta VI`,
  `Agente Vivalta2`). Renombrarlos rompería las expresiones `$('nombre')` que los
  referencian, así que se deja para una pasada específica.
- Las 5 tools del agente (`AVISO`, `Agendar`, `Disponibilidad`, `Cancelar`,
  `Encuesta`) apuntan a workflows que **no existen** en esta instancia (404).
  El prompt termina llamando a `Aviso`, así que el cierre del flujo sigue roto.

## 2026-09-14 — Prompt de cualificación v2

Sustituido el `systemMessage` del nodo `Agente Vivalta2`. Copia en
`n8n/prompts/ceballos_whatsapp_v2.md`. Ningún otro nodo tocado (verificado por hash).

| | Antes | Ahora |
|---|---|---|
| **Compra** | financiación · vender · tiempo buscando | tiempo buscando · **zonas de interés** · vender |
| **Alquiler** | contrato · nº personas · cuándo entrar | tiempo buscando · **nº habitaciones** · nº personas · contrato **+ duración** |
| **Cierre** | — | franja (mañanas/tardes) y días, sin fecha concreta; «un compañero contacta en menos de 24 h» |

La financiación sale del flujo por decisión de Marta. El agente tiene prohibido
proponer o confirmar fechas: no dispone de la agenda de los comerciales.

### Resuelto el 2026-09-14 (ver más abajo)

Las tools de agenda ya están desconectadas y la tool `AVISO` reconstruida.

## 2026-09-14 — Tools: agenda fuera y AVISO reconstruida

**Desconectadas** `Agendar`, `Disponibilidad` y `Cancelar`: se retira su conexión
`ai_tool` con el agente y se marcan como desactivadas. Ya no aparecen en la lista
de herramientas del modelo, así que no puede intentar cerrar citas. Los nodos se
conservan por si hiciera falta recuperarlos.

**Creada** `AVISO Ceballos` (`FptrwOsEst1T6t4f`, 14 nodos), exportada en
`n8n/workflows/aviso_ceballos.json`. La tool `AVISO` del agente ya apunta a ella.

Recibe seis campos: `resumen`, `disponibilidad`, `operacion`, `inmueble`,
`nombre_cliente` y `telefono_cliente`. Los cuatro primeros los redacta el agente;
los dos últimos salen del webhook.

Flujo: busca el contacto del comercial en Chatwoot, lo crea si no existe,
**reutiliza su conversación abierta en lugar de abrir un hilo nuevo**, y envía la
plantilla `aviso_abierta` con `{{1}}` = nombre del comercial y `{{2}}` = el aviso.

### Por qué el contenido se aplana

WhatsApp **rechaza** las variables de plantilla que contengan saltos de línea,
tabuladores o más de cuatro espacios seguidos (error 132000). Un resumen de
conversación es multilínea por naturaleza, así que el nodo `Destinatarios del
aviso` lo colapsa a una sola línea separando por ` · `, recorta a 900 caracteres
(el límite de Meta es 1024) y usa un texto por defecto si no llega nada.
Probado con Node contra saltos, retornos de carro, tabuladores, espacios
múltiples, un resumen de 3.200 caracteres y entrada vacía.

### Credencial

Las llamadas a Chatwoot de este workflow usan la credencial de n8n
**«Chatwoot Ceballos (api_access_token)»**, no el token en texto plano. Los
workflows antiguos siguen con el token embebido; conviene migrarlos.

### PENDIENTE para que funcione

1. **Los teléfonos de Alejandro y María Ángeles**, en el nodo `Destinatarios del
   aviso`. Están como `PENDIENTE_ALEJANDRO` y `PENDIENTE_MARIA_ANGELES`; el
   workflow lanza un error explícito si no hay ninguno configurado.
2. **Que Meta apruebe `aviso_abierta`**, que sigue en revisión.

## 2026-09-15 — Captación de leads y seguimientos

Arquitectura tomada del desarrollo de DCano (`EnviarPlantillaNuevosLeadsInmovilla`
y `Escenario 3 - Seguimientos Leads por Etiquetas`), adaptada a InmoPlus. Solo se
copió el patrón: ningún dato, token ni identificador de aquel cliente.

### `Captacion Leads InmoPlus` (`PL2FWPNGR0VgDjnG`, 27 nodos, parado)

Cada 10 minutos: login en InmoPlus → `ListadoLeads` con `Valorado=2` (solo los que
nadie ha tocado) desde hace 2 días → normaliza teléfono → descarta los repetidos
contra la tabla `LeadsInteresados` (teléfono + inmueble) → consulta el inmueble
para saber si es venta o alquiler por `nVenta`/`nAlquiler` → busca o crea el
contacto en Chatwoot → reutiliza su conversación o la crea → envía
`plantilla_compra` o `plantilla_alquiler` → **inserta el mensaje en
`n8n_chat_histories`** con `session_id = +teléfono`, que es la memoria del agente
→ etiqueta `1-bienvenida_ia` + `compra`/`alquiler` → registra el lead.

### `Seguimientos Leads Ceballos` (`x7XoS7kiTeeIET9l`, 11 nodos, parado)

Cada 30 minutos recorre las conversaciones abiertas y decide por etiquetas:

| Estado | Condición | Acción |
|---|---|---|
| `1-bienvenida_ia` | 12 h útiles sin respuesta | envía `seguimiento_1` |
| `seguimiento_1` | 24 h útiles más sin respuesta | envía `seguimiento_2` |
| `seguimiento_2` | — | fin del automático |
| cualquiera | el cliente escribe | pasa a `2-en_proceso` |
| `2-en_proceso`, `3-agendada_ia`, `4-intervenir` | — | el automático no toca nada |

**Las horas son útiles, no de reloj.** Solo corren entre las 9 y las 21, así que a
quien se le escribe a las 22:00 no se le persigue a las 7:00. Por eso los umbrales
son 12 y 24 y no 24 y 48: con una ventana de 12 h al día, 12 h útiles equivalen a
unas 24 h naturales. Si se cambia la ventana hay que recalcularlos.

Dos detalles que se replicaron a propósito del diseño de DCano:

- **«Ha contestado» es «ha escrito alguna vez»**, no «el último mensaje es suyo».
  En cuanto el asistente responde, el último vuelve a ser saliente y la
  conversación parecería sin contestar, con lo que se le mandaría un seguimiento
  a alguien que está hablando con nosotros ahora mismo.
- **Adopción con tope de 48 h**: al activar el escenario no se escribe a leads
  parados desde hace días.

Probado con Node: 9 escenarios (los dos seguimientos, cliente que contesta,
cliente que contesta y recibe respuesta, adopción, adopción antigua, fuera de
horario y cómputo de horas útiles).

### Etiquetas nuevas

Se crearon en Chatwoot `seguimiento_1` y `seguimiento_2`, que no existían y son el
estado del embudo. Las 6 anteriores siguen igual.

### Credenciales

Se crearon dos credenciales de n8n y los workflows nuevos las usan en lugar de
llevar secretos dentro: **Chatwoot Ceballos (api_access_token)** e **InmoPlus
Ceballos (login bot)**. Los workflows antiguos siguen con los valores embebidos.

### PENDIENTE

1. **Ninguna plantilla está aprobada.** Las cinco (`plantilla_compra`,
   `plantilla_alquiler`, `seguimiento_1`, `seguimiento_2`, `aviso_abierta`) están
   en revisión, y Meta **rechaza el envío de plantillas no aprobadas**. Todo queda
   configurado, pero no enviará hasta que Meta las apruebe.
2. **Cuántas variables lleva cada plantilla.** `plantilla_compra` y
   `plantilla_alquiler` están montadas con dos (`{{1}}` nombre, `{{2}}` inmueble)
   y los seguimientos con una (`{{1}}` nombre). Si el número real no coincide,
   Meta rechaza el envío: hace falta el cuerpo exacto de cada una.
3. **Los dos escenarios están parados.** No se activan hasta que lo anterior esté
   resuelto y se pruebe con un lead real.

## 2026-09-15 — Inventario web y enlace en las plantillas

### `Inventario Web Ceballos` (`frDxLN3ejiFxrQ5H`, 7 nodos, parado)

Cada hora descarga los 4 listados públicos de inmobiliariaceballos.com
(compra y alquiler × Guadalajara y Madrid) con `rows=500`, que trae el catálogo
entero en una petición por listado en vez de recorrer 10 páginas de 15. Extrae
cada inmueble del HTML y guarda en la tabla **`InventarioWeb`** los que aún no
estén, con su **URL pública**, referencia, tipo, zona, precio y superficie.

El tipo sale del `alt` de la foto y no del `<h2>`, porque en muchas fichas el
`<h2>` es un titular comercial. El precio centinela 99.999.999 € se guarda como
«A consultar».

**Salvaguarda:** cada listado publica su total en `sTotInm`. Si el número de
inmuebles extraídos no cuadra, el nodo lanza un error y no inserta nada, para
que un cambio de maquetación se vea en las ejecuciones en lugar de colar datos
a medias. Probado con Node contra los listados reales (141, 2 y 1 inmuebles) y
contra HTML alterado, que efectivamente falla.

Solo inserta lo que falta, nunca borra. La tabla es el mapa
referencia → URL pública, y esa relación no cambia. Un inmueble retirado se
queda en la tabla; no molesta porque solo se consulta por referencia.

### El enlace en la plantilla de bienvenida

`plantilla_compra` y `plantilla_alquiler` llevan dos variables: `{{1}}` el
nombre del cliente y `{{2}}` **el enlace a la ficha en la web**.

`Captacion Leads InmoPlus` busca ahora la referencia del lead en `InventarioWeb`
y usa esa URL. Si el inmueble no estuviera todavía en la tabla, cae al listado
de la web filtrado por esa referencia, para que la variable nunca vaya vacía —
Meta rechaza el envío si falta un parámetro.

Las plantillas de seguimiento llevan **una sola variable**, el nombre.

### Prompt v3

Se añade el contexto de origen: el cliente llega de un portal, ya ha recibido la
bienvenida con el enlace y ha visto la ficha, así que el agente no debe
presentarle el inmueble desde cero ni reenviar el enlace. La estructura de
preguntas de la v2 no se toca.

### Nota

La tabla `InventarioWeb` tiene una fila de prueba con referencia `TEST-1` que la
API de n8n no deja borrar (`DELETE` no permitido). Es inocua, pero conviene
quitarla desde la interfaz.

## 2026-09-15 — Asistente telefónico y verificación de referencias

### Las referencias de InmoPlus y de la web SON la misma

Comprobado sin autenticarme, usando el webhook `busqueda-referencia` que ya está
en producción: se le pasan referencias sacadas de la web y las encuentra en el CRM.
`P-1644` devuelve el mismo piso que raspa el inventario (224 m², 5 hab., 3 baños,
665.000 €) y `C-849` los mismos 272 m². De paso confirma que el precio centinela
99.999.999 € **viene de InmoPlus**, no es una rareza de la web.

Por tanto el enlace de `InventarioWeb` se puede casar con el lead por referencia,
que es como está montado `Captacion Leads InmoPlus`.

### El telefónico ya tenía la búsqueda por referencia

El agente de Retell (`agent_fe3fc67932af0a16aa9d4f014e`) usa un Conversation Flow
(`conversation_flow_61c97778ee61`) que ya traía la tool `Busqueda_referencia`
apuntando al webhook de n8n. No hacía falta añadirla.

### `AVISO Telefonico Ceballos` (`0tAqTuD02FaQreB0`, 4 nodos, activo)

Webhook `POST /webhook/aviso-telefonico` que Retell llama al terminar la llamada.
Normaliza lo que manda Retell (`{name, args:{...}}`) y llama al sub-workflow
`AVISO Ceballos`, de modo que el aviso del telefónico y el de WhatsApp comparten
la misma lógica, el mismo aplanado y la misma plantilla.

En el flujo de Retell se añadió la tool `Aviso_comercial` y un nodo `function`
**Aviso al comercial**. Los tres subagentes de cualificación (Alquiler, Compra y
el genérico) terminaban en `None`, sin llevar a ningún sitio ni siquiera a colgar:
ahora los tres pasan por el aviso y de ahí a `End Call`.

### Probado de punta a punta

Se llamó al webhook con datos de prueba. La cadena entera funcionó —contacto,
conversación y mensaje creados en Chatwoot— y el envío **falló en Meta con
`(#132001) Template name does not exist in the translation`**, que es exactamente
el error de una plantilla sin aprobar. Ningún WhatsApp llegó a entregarse.

Sirve como prueba de dos cosas: la integración está bien y lo único que falta es
la aprobación de las plantillas.

La prueba dejó creados en Chatwoot los contactos de Alejandro y María Ángeles,
que hacían falta igualmente, con un mensaje fallido cada uno.

### Detalle que costó encontrar

Un nodo `webhook` creado por API **no se registra si le falta el campo
`webhookId`**. El workflow aparece como activo pero la URL devuelve 404 sin más
pistas. Hay que asignarle un UUID y usar `typeVersion` 2.1, como el webhook que
ya funcionaba.

### PENDIENTE

- El flujo de Retell está **sin publicar** (`is_published: false`). Los cambios
  están en la versión 10, que es la que usa el agente, pero conviene revisarlo y
  publicarlo desde el panel de Retell.

## Etiquetas de Chatwoot

Existen las 6 y son correctas, pero **ningún nodo las asigna todavía**.

`1-bienvenida_ia` · `2-en_proceso` · `3-agendada_ia` · `4-intervenir` · `alquiler` · `compra`

## Plantillas de Meta

Cuatro plantillas en revisión: `plantilla_compra`, `plantilla_alquiler`,
`seguimiento_1`, `seguimiento_2`. Todas en categoría MARKETING e idioma **English**,
pese a tener el cuerpo en castellano: al enviarlas hay que mandar `"language": "en"`.

Formato de envío por Chatwoot (el que ya usa el proyecto):

```json
{
  "content": "<texto ya compuesto>",
  "template_params": {
    "name": "plantilla_compra",
    "category": "MARKETING",
    "language": "en",
    "processed_params": { "body": { "1": "<nombre>" } }
  }
}
```

Pendiente: el cuerpo completo de cada plantilla para saber cuántas variables
lleva y qué significa cada una.
