# Asistente telefónico de Casagencia — arreglos de septiembre 2026

Sara, el asistente de voz de Casa Agencia, corre sobre **Retell** (voz + LLM) y
**n8n** (calendario, cartera de inmuebles y avisos por email).

Este directorio contiene la versión desplegada de los workflows, la librería
común que se inyecta en los nodos Code y el script que despliega ambas cosas.

## El fallo que originó todo esto

Llamada `call_98d581f35f6e5c2fed19ff1be99`, 21/09/2026 a las 09:41 (el fichero
de Drive se llamaba `Llamada - 21-09-07:46` porque n8n escribía la hora en UTC).

La clienta pidió visita **el jueves a las 14:30** y Sara se la reservó, con la
oficina cerrada por la pausa de comida. Además, la clienta dio la dirección de
su piso (calle Mestre Falla 39) y Sara le pidió el municipio cuatro veces
seguidas antes de leerle un listado genérico.

### Causa raíz

En `BuscarDisponibilidadCalendario` el horario de oficina **solo se aplicaba en
la rama que proponía alternativas**. Cuando Google Calendar decía que el hueco
estaba libre, se respondía "Disponible" sin mirar el horario. Y
`ConfirmarCitaCalendario` era un insert ciego: no validaba nada y **devolvía una
respuesta vacía**, así que Sara confirmaba citas sin saber si se habían creado.

## Qué se ha cambiado

| # | Arreglo | Dónde |
|---|---|---|
| 1 | Horario de oficina validado SIEMPRE, también cuando el calendario está libre | `lib/casagencia_comun.js` + ambos workflows |
| 2 | `confirmarCitaCalendario` devuelve `cita_confirmada` de verdad, y valida por segunda vez antes de insertar | `ConfirmarCitaCalendario` |
| 3 | Tabla de festivos independiente de los calendarios de las comerciales | `lib/casagencia_comun.js` |
| 4 | El email "CITA PRE-RESERVADA" ya solo se manda si la cita se creó | `ConfirmarCitaCalendario` |
| 5 | Búsqueda de inmuebles por dirección/calle | `BuscarPorDireccion` (nuevo) |
| 6 | Patrón de referencias permisivo: `CS-G-397-V` ya no se mutila | herramientas de Retell |
| 7 | Routing de asesora con mapa explícito; un prefijo desconocido ya no cae en Gisela | `lib/casagencia_comun.js` |
| 8 | Los eventos de día completo (cumpleaños, recordatorios) ya no borran el día entero | `rangosOcupados()` |
| 9 | Borrados los nodos sobrantes de otro cliente (Club Pilates) | `FinalizarLlamadaRetell` |
| 10 | Teléfonos normalizados a E.164 | `normalizarTelefono()` |
| 11 | Consultar una cita ya concertada por teléfono | `BuscarCitaPorTelefono` (nuevo) |
| 13 | La referencia se pide siempre antes de una búsqueda aproximada | `retell/general_prompt.md` |
| 14 | `buscarInmuebles` devolvía una respuesta VACÍA cuando no había resultados | `buscarInmuebles` |
| 15 | `XMLCacheo` vaciaba la hoja antes de descargar el feed | `XMLCacheo` |
| 16 | Direcciones reales de los 93 inmuebles, sacadas de eGO | pestaña *Direcciones* |
| 17 | En alquiler ya no se agenda: se cualifica al cliente y llama la asesora | ambos calendarios + prompt |
| 18 | `registrarMensaje` mandaba 3 correos por un Switch que podía no casar con nada | `registrarMensaje` |
| 19 | El aviso se registra en cuanto hay nombre y teléfono, no al final | prompt |
| 20 | Sara ya sabe desde qué número llaman: lo confirma en vez de pedirlo | `SaludoInicial` + prompt |
| 21 | Saludo más corto y espera de 3,5 s (después del aviso de Idealista) | agente de Retell |
| 22 | Sara puede dar la dirección exacta cuando se la piden | `buscarPorReferencia` + prompt |
| 23 | El saludo de cada comercial no llegaba a usarse nunca | `SaludoInicial` |
| 12 | Tiempos de escucha: Sara ya no se pisa con el cliente ni insiste a los 5 segundos | agente de Retell |

Extras que aparecieron por el camino:

- `singleEvents: true` en las lecturas de calendario. Sin esto Google no expande
  los eventos periódicos, así que una reunión semanal **no se veía** y Sara
  reservaba encima.
- Toda la lógica de calendario usa ahora la misma credencial de Google
  (`Google Calendar Paco`). Antes la disponibilidad se consultaba con la cuenta
  de Laurence y la cita se insertaba con la de Paco.
- Zona horaria `Europe/Madrid` fijada en los workflows; los audios de Drive ya
  se nombran con la hora española y el teléfono del llamante.
- Arreglada la condición rota de `Switch1` en `FinalizarLlamadaRetell`
  (le faltaba el `||`, así que la rama de Laurence no enrutaba).
- `singleEvents: true` también evita reservar encima de eventos periódicos que
  antes eran invisibles para el sistema.
- Las coordenadas de la hoja están corruptas (Google Sheets se come el punto
  decimal: `39.977276046` se guarda como `39977276046`). Hoy no las usa nadie,
  así que se deja documentado en vez de arriesgar el formato de `precio`.

## De dónde salen las direcciones

Ni el feed XML de Janela ni la web pública de casagencia.com publican la calle:
solo municipio, zona, código postal y coordenadas. **Pero el CRM de eGO sí la
tiene, y para los 93 inmuebles de la cartera.**

Están volcadas en la pestaña **Direcciones** de la hoja *Inmuebles*
(`ref`, `direccion`, `numero`, `cp`, `origen`, …), que `XMLCacheo` nunca toca.
`BuscarPorDireccion` la lee y le da el peso más alto.

Para refrescarlas cuando entre cartera nueva:

```bash
python3 ego_direcciones.py     # lee eGO y reescribe la pestaña Direcciones
```

El script entra en eGO con las credenciales del CRM (variables de entorno
`EGO_USER` y `EGO_PASS`), pagina el listado para sacar el mapa
referencia -> id y lee de cada ficha `location[address]`,
`realestate[details][building_number]` y `location[zipcode]`. **Solo hace GET:
no modifica nada en eGO.**

## El saludo de cada número

La cabecera `Diversion` lista los desvíos **del más reciente al original**, así
que el **último** es el número que marcó el cliente. Ese es el que manda el
saludo. El código leía el primero, que siempre es el de Twilio: por eso todas
las llamadas sonaban a "general" y el saludo de cada comercial no se usó nunca.

Cadenas que aparecen de verdad en las llamadas:

| Cadena de desvío | El cliente marcó | Saludo |
| --- | --- | --- |
| general ← Carmen ← Idealista | Idealista (864870199) | genérico |
| general ← Gisela | móvil de Gisela (690027772) | "…la IA de Gisela" |
| general ← Carmen | móvil de Carmen (654907386) | "…la IA de Carmen" |
| general ← Carmen ← Fotocasa | Fotocasa (936060117) | genérico |
| general | número general (864893794) | genérico |
| general ← Gisela ← 864870288 | un portal sin identificar | genérico |

Las líneas de portal entran por el móvil de una comercial, pero el cliente
llama por un anuncio y no la conoce: por eso saludo genérico, como estaba
configurado. El nodo guarda en `linea_comercial` por quién entró, por si algún
día hace falta.

**Cualquier número que no sea de los nuestros, o una llamada sin cabecera de
desvío, recibe el saludo genérico.** Antes no casaba con ninguna rama del
Switch, nadie respondía y el asistente arrancaba sin saludo.

Los textos viven en `nodes/sal_datos.js`. `tests_saludo.js` cubre los 19 casos.

Ahí también se recoge el **teléfono del cliente** y se pasa al asistente como
`{{telefono_cliente_hablado}}`, para que Sara lo confirme ("¿le llamamos a este
mismo número?") en vez de pedirlo cifra a cifra.

## Alquiler: no se agenda

Petición de Casagencia (septiembre 2026). El mercado de alquiler está muy
tensionado y buena parte de los interesados no pasa la criba de la asesora; si
Sara agendase todas las visitas, el calendario se llenaría de citas que luego
hay que deshacer.

En alquiler o traspaso, Sara **no consulta el calendario ni crea citas**.
Cualifica al cliente y registra un aviso; la asesora de la zona llama y agenda
ella la visita ya cribada.

Las preguntas de cualificación (una a una, sin insistir si no quiere contestar):

1. ¿Para cuántas personas sería la vivienda?
2. ¿Cuentan con ingresos fijos demostrables, como una nómina o un contrato de trabajo?
3. ¿Conviven con alguna mascota?
4. ¿Para qué fecha necesitarían entrar a vivir?
5. ¿Lo buscan para todo el año o para una temporada? (si no se sabe ya)

Sara no valora las respuestas ni le dice al cliente si cumple requisitos: eso lo
decide la asesora. En locales, oficinas y traspasos se salta las preguntas de
personas y mascotas.

El aviso llega con el asunto `LEAD ALQUILER (sin agendar)` y la cualificación en
el cuerpo. Como con el horario, **el bloqueo está en el servidor**: aunque el
modelo se despistara e intentara agendar, las dos herramientas de calendario
rechazan la petición con `alquiler_sin_agenda`.

Se considera alquiler si la operación lo dice **o** si la referencia acaba en
`-A`. Basta una de las dos señales: hay un traspaso de local marcado como
alquiler cuya referencia acaba en `-V`.

## Orden de búsqueda

La referencia es la única forma exacta de localizar un inmueble; la dirección,
la zona y las características son aproximadas y pueden acabar enseñándole al
cliente un piso que no es el suyo. Por eso Sara pregunta **una sola vez**:

> "¿Tiene a mano la referencia del anuncio? Si la tiene, voy directa a ese inmueble."

- La tiene → `buscarPorReferencia`, y no se le pregunta nada más.
- No la tiene → se da por hecho que no hay referencia **el resto de la llamada**
  y se pasa a `buscarPorDireccion` (si ha dado una calle) o a `buscarInmuebles`
  (municipio y características).

La pregunta se hace **una vez por llamada**. Insistir después de un "no" es lo
que generó la queja original de la agencia.

## Asistente de WhatsApp (nuevo, sin activar)

Montado a partir del escenario principal de Blue Inmobiliaria (Chatwoot + Meta
+ Postgres para la memoria + Redis para juntar mensajes), pero **sin duplicar
nada de lo que ya funciona**: las herramientas del agente de WhatsApp son los
mismos webhooks que usa Sara por teléfono. Cartera, calendario, horario,
festivos y la regla de «en alquiler no se agenda» se cambian en un solo sitio y
valen para los dos canales.

En el n8n de Blue no se ha tocado nada: solo se ha leído.

### Cómo va el circuito

1. **Entra el lead por correo.** Cada portal avisa de la solicitud por email.
   `[WA] 1` lee el buzón, saca teléfono, nombre y referencia, y da de alta la
   ficha del lead. Si ya le escribimos por ese mismo inmueble, no se le vuelve
   a escribir (salvo que hayan pasado 30 días). Si el correo no trae teléfono,
   el aviso va por correo a la asesora que le toca.
2. **Primer mensaje.** `[WA][SUB] EnviarPlantilla` crea el contacto y la
   conversación en Chatwoot y manda la plantilla aprobada de Meta. La
   conversación nace en el panel, así que las asesoras la ven desde el minuto
   uno. Ese primer mensaje se siembra en la memoria del agente para que Sara no
   se vuelva a presentar.
3. **Conversación.** `[WA] 2` recibe el webhook de Chatwoot, espera 60 segundos
   para juntar los mensajes que el cliente manda seguidos, y contesta **una
   vez** con todo el contexto. Antes de escribir lee la ficha del lead: de qué
   portal vino, qué inmueble pidió, si es compra o alquiler, qué asesora le toca
   y **qué preguntas están ya contestadas**, para no repetirlas.
4. **Cualificación.** Tres o cuatro preguntas, de una en una:
   - **Compra**: para cuándo, zona, presupuesto y financiación.
   - **Alquiler**: personas, ingresos demostrables, mascotas y cuándo necesita
     entrar (más «todo el año o temporada» si encaja).
5. **Cierre.** En compra, la visita se cierra en la agenda de la asesora, como
   pre-reserva pendiente de confirmar. En alquiler **no se agenda nada**: se
   cualifica, se avisa a la asesora por correo y ella llama.

### Los interruptores de las asesoras

El bot se calla solo cuando:

- lo último lo ha escrito la agencia,
- el mensaje es un audio o una imagen (sin texto),
- la conversación está **resuelta**,
- la conversación tiene la etiqueta **`intervenir`**,
- o el atributo **`bot`** del contacto está en **`Off`**.

Las dos últimas son el interruptor de mano: en cuanto una asesora entra a la
conversación, Sara deja de contestar.

### Los workflows

| | |
|---|---|
| `[WA] 0 · Esquema de base de datos` | Crea las tablas. Se ejecuta a mano una vez. |
| `[WA] 1 · Leads de portales por correo` | Lee el buzón y arranca la conversación. |
| `[WA] 2 · Asistente de WhatsApp` | El agente: buffer de Redis, memoria en Postgres y las 9 herramientas. |
| `[WA][SUB] EnviarPlantilla` | Contacto + conversación en Chatwoot + plantilla de Meta. |
| `[WA][SUB] CualificarLead` | Guarda las respuestas y avisa a la asesora. |
| `[WA][SUB] Etiquetar` | Marca el estado en el panel sin borrar las etiquetas de las personas. |
| `[WA][SUB] BuscarPorReferencia` / `BuscarPorDireccion` / `BuscarInmuebles` | Puentes a la cartera. |
| `[WA][SUB] ConsultarHuecos` / `ConfirmarVisita` | Puentes al calendario, con el guardarraíl de alquiler delante. |
| `[WA][SUB] ConsultarCita` / `AvisarAsesora` | Puentes a las herramientas que ya existían. |

**Todos se crean desactivados a propósito.** Nada se dispara hasta que alguien
los active.

### Lo que falta para poder activarlo

Está todo montado menos lo que depende de infraestructura que aún no existe.
En `wa/config.js` hay cuatro valores marcados `PENDIENTE`:

1. **Chatwoot**: la URL, el id de la cuenta y el id del inbox de WhatsApp.
2. **Meta**: el `waba_id` y el nombre de la plantilla aprobada (con su texto,
   para que el panel muestre lo mismo que le llega al cliente).
3. **El buzón de correo** donde entran los avisos de los portales, y el filtro
   de Gmail del nodo `CorreoNuevo`.
4. **La credencial de OpenAI** del nodo `ModeloOpenAI`, que se elige en n8n.

Los tokens de Chatwoot y de Meta **no van en el código**: están en las
credenciales `Chatwoot Casagencia` y `Meta WhatsApp Casagencia`, creadas ya en
n8n con valor `PENDIENTE`.

Cuando esté eso: rellenar `wa/config.js`, `python3 build_whatsapp.py --deploy`,
ejecutar una vez `[WA] 0`, apuntar el webhook de Chatwoot al webhook de
`[WA] 2` y activar primero `[WA] 2` y después `[WA] 1`.

## Estructura

```
lib/casagencia_comun.js   horarios, festivos, teléfonos, routing y ocupación
nodes/*.js                el cuerpo de cada nodo Code
build_workflows.py        ensambla los JSON y los despliega
workflows/*.json          lo que hay desplegado ahora mismo
retell/general_prompt.md  el prompt de Sara
retell/update_retell.py   despliega prompt, herramientas y ajustes del agente
tests_logica.js           30 tests de horarios, festivos, teléfonos y routing
tests_alquiler.js         tests del bloqueo de agenda en alquiler y del aviso
tests_saludo.js           19 tests del saludo de cada número y de las cadenas de desvío
tests_busquedas.js        tests de búsqueda por dirección y de cita por teléfono
tests_direccion_produccion.py   consulta las direcciones reales contra producción
tests_busquedas_produccion.py   referencia, municipio, negativos y consultas vagas
tests_whatsapp.js         tests del asistente de WhatsApp (correos, buffer, cualificación)
wa/config.js              configuración común de WhatsApp: Chatwoot, Meta, portales, asesoras
wa/*.js                   el cuerpo de cada nodo Code de los workflows [WA]
wa/prompt_asistente.md    el prompt del agente de WhatsApp
wa/ids.json               qué id tiene cada workflow [WA] en n8n
build_whatsapp.py         ensambla y despliega los 13 workflows [WA]
workflows_wa/*.json       lo generado para WhatsApp
ego_direcciones.py        relee las direcciones desde eGO y reescribe la pestaña
backup_20260921/          el estado anterior, por si hay que revertir
```

## Cómo desplegar un cambio

La librería y los nodos **no se editan dentro de n8n**: se edita aquí y se
vuelve a desplegar, porque el código se inyecta en cada nodo Code.

```bash
node tests_logica.js && node tests_busquedas.js     # requiere: npm i luxon

export N8N_API_KEY=...
python3 build_workflows.py --deploy

export RETELL_API_KEY=...
python3 retell/update_retell.py --apply             # actualiza Y publica

# WhatsApp (crea lo que falte y actualiza el resto, siempre desactivado)
node tests_whatsapp.js
python3 build_whatsapp.py --deploy
```

El número de teléfono de Retell usa `latest_published`, así que un cambio en el
agente **no entra en producción hasta que se publica**. `update_retell.py` lo
publica al final.

## Cómo va la búsqueda ahora

Medido contra producción con las 93 direcciones reales de eGO:

| | |
|---|---|
| Acierto en primera posición | **85 / 93 (91 %)** |
| El inmueble está entre las 3 opciones | **92 / 93 (98 %)** |
| Devuelve fiabilidad alta (Sara puede confirmarlo directamente) | 62 / 93 |
| No lo encuentra | 1 / 93 |

Los 7 casos en los que el correcto no sale el primero son **ambigüedad real**:
hay dos inmuebles en la misma calle (Rey Don Jaime, Cardona Vives, Estatut,
Sequiota, Ferrandis Salvador, les Useres, Pedrapiquers). Ahí lo correcto es
justo lo que hace: enseñar los dos y preguntar cuál es.

Las calles que no existen en la cartera devuelven `sin_coincidencias`, y las
consultas vagas ("el centro", "calle") devuelven `demasiado_generico`: en
ningún caso se le lee al cliente un listado que no ha pedido.

> Ojo al medir: la hoja de cálculo tiene límite de lecturas por minuto. Lanzar
> las 93 consultas seguidas y sin pausa provoca errores que **no** son fallos de
> la búsqueda. Los scripts de prueba dejan 1,5 s entre consultas.

## Pendiente

- **Festivos locales.** `FESTIVOS.TODOS` trae los de fecha fija (nacionales y
  9 d'Octubre). Las fiestas locales de Benicàssim, Oropesa, Castellón y
  Vila-real están vacías: hay que rellenarlas en `lib/casagencia_comun.js`.
- **Direcciones de la cartera nueva.** Las 93 actuales están cargadas desde
  eGO. Cuando entren inmuebles nuevos hay que volver a lanzar
  `ego_direcciones.py`, o apuntar la dirección a mano en la pestaña.
- **Qué es el número 864870288.** Aparece en 2 llamadas, siempre con aviso de
  portal y entrando por el móvil de Gisela. Recibe el saludo genérico, que es
  lo razonable, pero conviene que Paco confirme de qué portal es.
- **Permisos de las grabaciones.** `Share file` sigue publicando cada audio con
  `role: writer, type: anyone`: cualquiera con el enlace puede editarlas.
