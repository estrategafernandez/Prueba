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

## Cómo está organizado en n8n

En esta instancia **los proyectos y las carpetas están bloqueados por licencia**
(`/api/v1/projects` contesta 403), así que las dos líneas de trabajo se separan
con lo que sí hay:

- **Etiqueta** `Asistente telefonico` o `Asistente WhatsApp`, que en n8n sale
  como filtro en la barra lateral.
- **Prefijo en el nombre**: `[TEL] …` y `[WA] …`, para que la lista se agrupe
  sola aunque no se filtre.

Los dos constructores ponen el prefijo solos, así que no hay que acordarse.
Si algún día se activa la licencia con proyectos, se pasan a dos proyectos de
verdad y los prefijos se pueden quitar.

## Asistente de WhatsApp (proyecto aparte)

Es **otro proyecto**: sus workflows llevan `[WA]` y la etiqueta *Asistente
WhatsApp*, y **ninguno llama a un workflow del teléfono**. Comparten los mismos
**datos** (el Google Sheet de la cartera y los calendarios de Carmen y Gisela),
no la ejecución. La lógica de agenda (horario, festivos, huecos y la segunda
comprobación antes de escribir) se reutiliza inyectando los ficheros de
`nodes/` en nodos propios de WhatsApp, sin tocarlos: un cambio de horario o de
festivos vale para los dos canales.

### La línea y las plantillas

Línea **+34 864 89 37 94** (Casa Agencia Inmobiliaria), verificada, conectada y
en calidad verde. Chatwoot en `panel-casa-agencia.serversvisionarius.com`,
cuenta 1, inbox 1 *WhatsApp*.

| Plantilla | Idioma en Meta | `{{1}}` | `{{2}}` |
|---|---|---|---|
| `bienvenida_compra` | `es` | nombre del cliente | enlace del anuncio |
| `bienvenida_alquiler` | **`en`** | nombre del cliente | enlace del anuncio |
| `plantilla_aviso` | **`en`** | quien lo recibe | origen (📞/💬) + qué + resumen corto + qué hacer + enlace al chat |

> Dos de las tres están dadas de alta en **inglés** aunque el texto sea en
> español. Meta rechaza el envío si el código de idioma no es exactamente el
> registrado, así que en `wa/config.js` van con `en`. Las tres son de categoría
> *Marketing*: Meta puede frenar su entrega. Para los avisos internos sería
> mejor *Utilidad*.

### Avisos al equipo: SOLO por WhatsApp (desde el 2-10-2026)

Todos los avisos, del asistente de WhatsApp **y del telefónico**, salen por
`[WA][SUB] AvisoEquipo`, con la `plantilla_aviso`, **a la comercial que toca y
a Paco** (`DIRECCION` en `wa/config.js`). Ya no se manda ningún correo.

- Empiezan diciendo de dónde vienen: **📞 ASISTENTE TELEFÓNICO** o **💬 ASISTENTE
  WHATSAPP**, y qué es (PRE-RESERVA, LLAMADA, AVISO, INTERVENIR, RECORDATORIO).
- Resumen **corto**: 220 caracteres como mucho, sin partir palabras (`…`), y el
  aviso entero 600 (`AVISO_RESUMEN_MAX`, `AVISO_MAX`). El detalle completo va a
  la nota del historial de eGO.
- Teléfono: los correos de cada llamada (`FinalizarLlamadaRetell`), de la
  pre-reserva (`ConfirmarCitaCalendario`) y del recado (`registrarMensaje`) se
  han cambiado por este aviso. La grabación se sigue subiendo a Drive y está en
  la nota del panel. El recado solo se le da a Sara por enviado si Meta lo acepta.
- **Sin repetir**: cada aviso queda apuntado (tabla `avisos_enviados`). Si
  durante una llamada ya salió el recado o la pre-reserva, al colgar no se manda
  además el aviso de LLAMADA (la llamada entra igual en el panel).
- En pruebas, un solo WhatsApp al que prueba ("Carmen y Paco").

### El circuito

1. **Entra el lead por correo** (`[WA] 1`): teléfono, nombre, referencia y el
   **enlace del anuncio**. Compra → `bienvenida_compra`; alquiler →
   `bienvenida_alquiler`. No se escribe dos veces por el mismo inmueble.
2. **Bienvenida** (`[WA][SUB] EnviarPlantilla`): por Chatwoot, para que la
   conversación nazca en el panel. Etiqueta `1-bienvenida_ia`.
3. **Contesta el cliente** (`[WA] 2`, con la estructura estándar de Blue): texto,
   **notas de voz** (se transcriben) e **imágenes** (se describen); se juntan
   60 s de mensajes y se contesta una vez. Etiqueta `2-en_proceso`.
4. **Compra**: tres preguntas (cuánto tiempo lleva buscando, si necesita vender
   para comprar —y si es que sí, la dirección o zona de esa vivienda, con la
   etiqueta `vendedor`— y cómo lo financia: hipoteca, recursos propios o
   hipoteca preconcedida) y directamente la visita. Se **pre-reserva**: va al
   calendario de la asesora como `PRE-RESERVA` (en amarillo, con lo que sabemos
   del cliente), lo que bloquea el hueco; le llega un **aviso por WhatsApp** para
   que llame al cliente y la confirme (o la mueva); al cliente se le dice que
   *la cita NO está confirmada hasta que le llame la asesora*; etiqueta
   `3-agendada_ia`.
5. **Alquiler**: las cuatro preguntas exactas del teléfono (personas, ingresos,
   mascotas, fecha de entrada). **No se agenda**: aviso al comercial y etiqueta
   `4-intervenir`; la IA deja de contestar y decide una persona.
6. **24 horas antes** de cada visita pre-reservada por WhatsApp, recordatorio
   por WhatsApp a la asesora (`[WA] 3`, cada hora, sin repetir): si aún no la ha
   confirmado, que llame al cliente.

La IA también resuelve dudas con la **ficha completa** del inmueble (incluida la
descripción entera del anuncio), busca en toda la cartera con todos los filtros
y **recomienda inmuebles parecidos** cuando el que pidió no le encaja.

### `[WA] 2` con la estructura estándar de Blue

Las mismas siete secciones que el *Asistente* de Blue, con los mismos nombres:

1. **Llega el mensaje de WhatsApp**: se descarta lo que no es del cliente, y el
   aviso repetido (Chatwoot a veces avisa dos veces del mismo mensaje: Redis
   marca cada id y solo pasa una vez).
2. **Filtrar si el bot está encendido o apagado**: `Bot on/off` (más la etiqueta
   `4-intervenir`). Blue tiene además `Bot sin seleccionar no hacer nada`;
   Casagencia contesta también a los contactos sin valor.
3. **Separar audio, texto e imagen**: el audio se baja de Chatwoot y lo
   transcribe OpenAI (`[nota de voz] …`); la imagen la describe OpenAI y, si es
   la captura de un anuncio, copia referencia, precio y dirección (`[imagen]
   …`); vídeo, documento, ubicación o contacto se le dicen a Sara tal cual.
4. **Recolectar inputs**: `Push Redis` → `Espera 60 segundos` → `Obtiene todos
   los Mensajes` → solo sigue el turno del **más nuevo**.
5. **Cálculo de la fecha actual**, la ficha del lead y la del inmueble.
6. **Generar respuesta del asistente** (Sara, `gpt-5.1`, memoria en Postgres).
   La base de conocimiento va en el prompt (Blue la tiene en Supabase).
7. **Se estructura y envía en varias partes** (hasta 5 mensajes, 2,5 s entre uno
   y otro).

La cola de Redis tiene tres arreglos sobre la de Blue, con un test para cada uno
(`tests_whatsapp.js`, sección 14):

- Cada entrada lleva el **id del mensaje**: dos mensajes iguales seguidos ("ok",
  "ok") ya no se confunden, y se juntan **en el orden en que los escribió**
  aunque el audio tarde más en transcribirse que el texto que mandó después.
- Los mensajes se **sacan de Redis uno a uno** (RPOP) en vez de leer y borrar
  la lista: si el cliente escribe justo en ese momento, su mensaje entra en esta
  respuesta en lugar de perderse.
- Si Chatwoot manda dos avisos casi a la vez puede meter en los dos el último
  mensaje; el otro se **rescata** de la conversación (solo los entrantes de ese
  rato, nunca lo ya contestado ni lo de un turno posterior).

Probado en real el 1-10-2026: dos mensajes seguidos + el aviso repetido →
una sola respuesta a los dos y el repetido descartado; una nota de voz + una
foto con pie → transcrita, descrita y contestadas juntas.

### Cada referencia, su asesora y su calendario

La referencia manda, igual que en el teléfono: **BN** y **OR** → Carmen
(`carmen@casagencia.com`, L-V 9:30-14:00 y 16:00-19:30, sábado 10:00-14:00);
**CS** y **VR** → Gisela (`gisela@casagencia.com`, L-V 9:00-14:00 y
16:00-19:00, sábado cerrado). Comprobado con toda la cartera real (sección 15
de los tests): las 93 referencias tienen asesora, los avisos van a ella y las
72 de venta se agendan en **su** calendario con **su** horario. Una referencia
con un prefijo desconocido no se agenda en ningún calendario.

### Asignación en el panel (el reparto del teléfono)

La conversación se **asigna en Chatwoot a la asesora de la referencia**, igual
que reparte el teléfono: **BN / OR** (Benicàssim, Oropesa…) → **Carmen**;
**CS / VR** (Castellón, Vila-real…) → **Gisela**; sin referencia, a quien vaya
el aviso (o Laurence). Se hace al mandar la bienvenida, en cada aviso al equipo
y en cada llamada. Si la conversación ya la tiene una comercial, no se toca: un
cambio hecho a mano se respeta.

### Llamadas del asistente telefónico en el panel (`[TEL] Llamada al panel`)

Cada llamada que atiende el asistente telefónico entra en el panel, en la
conversación del contacto (por su teléfono; si no existe se crea, con el nombre
que OpenAI saca de la transcripción si lo dijo):

- etiqueta `0-llamada_telefonica`;
- nota privada: *LLAMADA DE LA IA — Colgó la IA / Nos llamó · teléfono · día y
  hora · duración*, el resumen, el tono del cliente, la asesora y la
  **grabación**, subida como audio para escucharla dentro de la conversación
  (Retell la sirve como fichero genérico y Chatwoot la ponía para descargar);
- se asigna a la asesora de la llamada;
- **aviso por WhatsApp** a la asesora y a Paco con el resumen y el enlace al chat
  (si la llamada ha durado al menos 15 s). Sustituye a los correos de cada llamada.

Cambios en el teléfono: `[TEL] FinalizarLlamadaRetell` tiene un nodo más,
*Llamada al panel*, que le pasa la llamada sin esperar, y ya no manda los
correos de cada llamada (el aviso va por WhatsApp). Sigue subiendo la grabación
a Drive. Está todo en `build_workflows.py` (`--solo=` para desplegar solo uno). Cada llamada entra
una sola vez (tabla `tel_llamadas_panel`).

### De dónde salen los leads (revisado el 1-10-2026)

Buzón **formularioscasagencia@gmail.com** (credencial *Correo Formulario*),
revisado solo en lectura:

- **Formularios de la web** (`web@websites.egorealestate.com`, "Contacto del
  WebSite"): 27 desde el 25 de mayo, 1-2 por semana. Todos son el formulario
  general (sin inmueble). Estos **no entran en eGO**: se cogen del correo.
- **Portales** (Idealista, Fotocasa, reenviados por `forward@egorealestate.com`):
  cruzados correo a correo con los avisos de eGO de 5 días, **todos entran en
  eGO** 1-3 minutos después. eGO tiene además los de Properstar, que no llegan al
  correo. Se cogen de la API de eGO.
- Las "llamadas atendidas" de Idealista no son leads de eGO: las coge el
  asistente telefónico.

> **Ojo:** desde esta misma cuenta sale otra automatización que ya escribe a los
> leads: correos "Te hemos escrito por WhatsApp | Casagencia" (62 en 4 días,
> firmados por Gisela o Carmen, con enlace a un WhatsApp) y "Contacto ha
> solicitado visita (formulario)" a las comerciales con "notas de la
> conversación". Antes de poner los leads en real hay que apagarla, o el cliente
> recibirá dos WhatsApp.

### `[WA] 1` · Leads de la web (correo) — ACTIVO en modo preparado

Solo los correos de la web. OpenAI lee el mensaje (compra, alquiler, alquiler de
temporada, propietario que quiere vender o alquilar, u otra cosa) y se decide el
primer WhatsApp (`wa/leads.js`):

| Caso | Primer WhatsApp |
|---|---|
| Habla de un inmueble disponible | `bienvenida_compra` / `bienvenida_alquiler` con su enlace |
| El inmueble ya no está (vendido, reservado, retirado o no publicado) | `plantilla_abierta`: ya no está disponible, ¿te enseño otros? |
| Formulario general (lo normal en la web) | `plantilla_abierta` con lo que busca, en su idioma (es/en/fr) |
| Propietario | `plantilla_abierta` y aviso a la asesora de su zona (captación) |
| Spam, proveedores, pruebas | nada |

Las bienvenidas dicen "por este inmueble…": sin inmueble no encajan, por eso la
web usa la plantilla abierta. Probado con los 27 formularios reales: 15
buscadores, 6 propietarios y 9 que no eran clientes.

Con `MODO_LEADS = 'preparado'` (`wa/config.js`) todo se apunta en la tabla
`leads_entrantes` y **no se manda nada** (salvo a los teléfonos de prueba). Con
`'real'` se da de alta el lead y sale el WhatsApp.

El trigger de Gmail puede traer varios correos de golpe: cada uno se trata por
separado en `[WA][SUB] LeadDeLaWeb`, para que no se pierda ninguno.

### eGO (API) — conectado y probado el 2-10-2026

Las visitas **se siguen agendando solo en Google Calendar**: no se crea nada en
la agenda ni en las fichas de visita de eGO. De eGO se **lee** (estado, llaves,
fichas de visita, leads) y solo se **escribe** la nota del historial.

- `[EGO][SUB] Llamar a eGO`: login con la credencial **eGO API** (la contraseña
  está solo en n8n) y sesión guardada 50 min en Redis (`ego:sesion`). Las
  respuestas se leen como texto; las listas van repetidas
  (`?realestateIds=1&realestateIds=2`) y `applicationIds: []` se rellena con la
  agencia (4338).
- `[WA] 5 · Leads de eGO (portales)` — **ACTIVO en modo preparado**: cada 5
  minutos, los leads de portales (`portalId`) de las últimas 3 horas (eGO guarda
  las fechas en UTC). Cada lead ya trae teléfono, inmueble, venta/alquiler y
  comercial; del inmueble se pide el estado (`GetRealestate`). Disponible (2) →
  bienvenida con el enlace de la web (o la referencia si no está en la web);
  reservado, vendido, alquilado o retirado → `plantilla_abierta` (ya no está,
  ¿te enseño otros?) en el idioma del mensaje.
- `[EGO][SUB] FichaCRM`: por la referencia (`CheckRealestateReference`), el
  **estado**, las **llaves** (llavero del inmueble en la agencia;
  `ListRealestateKeyGroup`) y las **fichas de visita** (hechas, programadas,
  interés, puntos positivos y negativos: internos). La usa Sara con la
  herramienta `consultarCRM` antes de ofrecer visita, y la pre-reserva para
  poner en el aviso a la asesora el estado y las llaves.
- `[EGO][SUB] NotaEnEgo`: nota en el historial del cliente (tipo *WhatsApp* o
  *Llamada*), en su **contacto** si existe y, si no, en su **lead** más
  reciente. La ponen los avisos de WhatsApp (pre-reserva, intervenir, aviso) y
  cada llamada del asistente telefónico.

Lo comprobado con los datos reales:

- Los leads de los portales **no crean contacto** en eGO (`potencialClientId`
  vacío); el contacto lo crea la comercial cuando trabaja al cliente. Por eso la
  nota va al contacto si lo hay y, si no, al lead.
- La **asignación de eGO coincide** con el reparto por referencia en los 35
  leads revisados (BN/OR Carmen, CS/VR Gisela). Se usa la regla de la
  referencia y lo de eGO queda apuntado al lado (`asignacion_coincide`).
- **Llaves**: solo unos pocos inmuebles tienen llavero en eGO, así que no tener
  llaves registradas no impide ofrecer visita (`LLAVES_OBLIGATORIAS = false`):
  se le dice a la asesora en el aviso.
- Los reservados y vendidos no están en el feed de la web: si alguien pide uno,
  ya sale como no disponible.

**Un solo interruptor para salir**: `MODO_LEADS` en `wa/config.js`. Con
`'preparado'` los leads (web y eGO) se apuntan en `leads_entrantes` sin mandar
nada y no se escriben notas en eGO; con `'real'` se manda el primer WhatsApp y
se escriben las notas. Con los teléfonos de prueba funciona siempre en real.

### La cartera de WhatsApp (`[WA] 4`)

La hoja del teléfono (`[TEL] XMLCacheo`) **corta las descripciones a 500
caracteres**, y ahí se pierde justo lo que pregunta un cliente: en el BN-1528-V,
que incluye plaza de parking y trastero, cómo son los baños y los honorarios de
la agencia. Sin tocar el teléfono, `[WA] 4` lee cada hora el mismo feed de eGO y
lo guarda **completo** en la tabla `wa_cartera`: descripción entera, superficie,
características en español y el **enlace de la web** de cada inmueble.

El enlace se construye con el id del feed sin el `05` del principio
(`0525370429` → `…/inmueble/…/25370429`): la web abre la ficha con el id,
pongas lo que pongas delante. Comprobado con los 83 inmuebles que tenían enlace
conocido. Con eso Sara puede mandar el enlace de lo que recomienda, y la
bienvenida lleva enlace aunque el correo del portal no lo traiga.

La ficha del inmueble por el que preguntó el cliente **va cargada en el
contexto de cada turno**: Sara la tiene delante sin llamar a ninguna
herramienta.

### Etiquetas del panel (las de Blue)

`1-bienvenida_ia` · `2-en_proceso` · `3-agendada_ia` · `4-intervenir` y,
además, `vendedor` (el comprador tiene que vender una vivienda: posible
captación) y `0-llamada_telefonica` (la conversación tiene llamadas del
asistente telefónico).

Las tres primeras son el estado y nunca van hacia atrás. `4-intervenir` se suma
y hace que la IA deje de contestar: es el interruptor de las comerciales.

Además, como en Blue, el **atributo `bot` del contacto** (On/Off, creado en el
panel): con `Off` la IA se calla; con `On` **o sin valor** (*Select value*)
contesta. La plantilla de bienvenida pone `bot = On` si el contacto no lo tenía
(un Off puesto a mano no se toca). Blue no contesta a los contactos sin valor;
Casagencia sí (`SOLO_CONTACTOS_CON_BOT = false` en `wa/config.js`).

Nunca contesta a lo que escribe la agencia ni a los móviles del equipo (los
avisos salen de esta misma línea, y la respuesta automática del WhatsApp de una
comercial entra aquí).

### Chatwoot → n8n

Automatización de Chatwoot *"IA WhatsApp: mensajes del cliente a n8n"*: cada
mensaje **entrante** del inbox WhatsApp se manda a `…/webhook/wa-asistente`
(`send_webhook_event`, como en Blue). Llega como
`event: automation_event.message_created` con la conversación entera; la
entrada lo acepta, y hay un test con el payload real (anonimizado) en
`tests_datos/`.

Automatización *"4-intervenir quita 2-en_proceso"* (en el propio Chatwoot, sin
n8n): al actualizarse una conversación que tiene `4-intervenir`, se le quita
`2-en_proceso`. Cubre cuando la pone una persona a mano; cuando la pone la IA
lo hace ya `[WA][SUB] Etiquetar` (`wa/etiquetas_unir.js`), que además no vuelve
a poner `2-en_proceso` mientras siga `4-intervenir`.

### Utilidades

- **`[WA] 9 · Lead a mano`**: da de alta un lead y le manda la bienvenida, como
  si hubiera llegado por correo. `POST /webhook/wa-lead-manual` con la cabecera
  de la credencial *WA lead a mano* y `{telefono, nombre, referencia, enlace,
  reiniciar}`. Para leads que entran por teléfono y para pruebas.
- **`[WA] 8 · Prueba sin IA`**: escucha en la misma ruta que `[WA] 2` y monta
  el contexto exacto que leería Sara, sin contestar. **No puede estar activo a
  la vez que `[WA] 2`.**
- `POST /webhook/wa-refrescar-cartera` (misma clave) refresca la cartera al
  momento.

### Estado: EN MARCHA desde el 1-10-2026

Activos: `[WA] 2` (asistente), `[WA] 3` (recordatorio), `[WA] 4` (cartera),
`[WA] 9` (lead a mano) y todos los `[WA][SUB]`. Modelo `gpt-5.1` con la
credencial *OpenAI Casagencia*. **Todo en real**: las visitas se escriben en el
calendario de la asesora y los avisos le llegan a ella y a Paco, solo por
WhatsApp.

Los leads entrantes (web y eGO) están preparados pero sin mandar nada (ver
arriba). Mientras tanto, los leads se pueden lanzar a mano con `[WA] 9`.

### Modo prueba

En `wa/pruebas.local.json` (no está en git) se pueden poner teléfonos de prueba:
con ellos el asistente funciona igual, pero los avisos van a quien prueba y las
visitas NO se escriben en la agenda real. Ahora mismo la lista está **vacía**.

```json
{"telefonos": ["34600000000"], "avisar_movil": "34600000000", "avisar_email": "x@y.com"}
```

### Lo que se corrigió probando con la línea real

- Reservaba sin preguntar "¿te la reservo?" y la volvía a reservar si el cliente
  insistía. Ahora pregunta antes y, si la misma visita ya está reservada, no la
  repite (comprobado en la ficha del lead, no solo en el prompt).
- Para "algo parecido más barato" copiaba los datos del piso como filtros y
  contestaba que no había nada. Ahora usa `recomendarSimilares` con precio
  máximo, y la búsqueda relaja los filtros secundarios en vez de devolver cero.
- Negrita de markdown (`**así**`) que en WhatsApp se ve mal: se convierte sola.

Esta versión de n8n **no deja activar un workflow si los sub-workflows que usa
no están publicados**. Orden: primero `Etiquetar` y `AvisoEquipo`; después los
demás `[WA][SUB]`; después `[WA] 2`, `[WA] 3` y por último `[WA] 1`. Activar un
sub-workflow no tiene riesgo: solo se ejecuta cuando alguien lo llama.


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
wa/cartera.js             lectura de la cartera: ficha, búsqueda y similares
wa/ids.json               qué id tiene cada workflow [WA] en n8n
build_whatsapp.py         ensambla y despliega los 18 workflows [WA]
tests_datos/              cartera real, muestra del feed y payload real de Chatwoot
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

- **Festivos locales.** `FESTIVOS.TODOS` ya trae las 12 fiestas oficiales de la
  Comunitat Valenciana de 2027, incluidas las tres movibles de marzo (San José,
  Viernes Santo y Lunes de Pascua), que antes faltaban. Lo que sigue vacío son
  las **dos fiestas locales de cada municipio**: Benicàssim, Oropesa, Castellón
  y Vila-real. Cada ayuntamiento las decide por su cuenta y todavía no están
  publicadas para 2027; hay que rellenarlas en `lib/casagencia_comun.js`.

  > Cuidado al actualizar el año: las tres de marzo **cambian de fecha** porque
  > dependen de la Pascua. Copiar las del año anterior es un error. Hay un test
  > en `tests_logica.js` que compara la lista contra las 12 oficiales.
- **Direcciones de la cartera nueva.** Las 93 actuales están cargadas desde
  eGO. Cuando entren inmuebles nuevos hay que volver a lanzar
  `ego_direcciones.py`, o apuntar la dirección a mano en la pestaña.
- **Qué es el número 864870288.** Aparece en 2 llamadas, siempre con aviso de
  portal y entrando por el móvil de Gisela. Recibe el saludo genérico, que es
  lo razonable, pero conviene que Paco confirme de qué portal es.
- **Permisos de las grabaciones.** `Share file` sigue publicando cada audio con
  `role: writer, type: anyone`: cualquiera con el enlace puede editarlas.
