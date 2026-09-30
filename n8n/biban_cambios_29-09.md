# Biban Gestió — Cambios preparados (29/09/2026)

**Estado:** subidos a n8n el 29/09 (~23:30 UTC) con aprobación del cliente. Los tres workflows siguen activos.

Copias de seguridad creadas en n8n (inactivas):
- `w90KKMR3iCeOHKvr` — BACKUP Agente AT 29-09 (no activar)
- `ZzQsZAhRr0Xl60JO` — BACKUP Aviso 29-09 (no activar)
- `jqoPxiuA5ED7dGLH` — BACKUP Aviso_insta 29-09 (no activar)

Ya hecho: borrada la memoria del agente para +34608563923 (6 registros en `n8n_chat_histories`).

## Agente AT (`9l8UOsqXN3Bn53ao`)

### 1. Referencia común para las tools (arregla el error del llavero)
- Nuevo nodo `Referencia Instagram` (entre `Edit Fields9`/`Edit Fields10` y `Buscar ref. y descripción`).
- `Edit Fields8`, `prompt Instagram`, `prompt solicitudes` y `PROMPT` llevan ahora `referencia` y `embudo`
  (`instagram` / `solicitudes`).
- `Llavero.Referencia`, `Agendar.Ref_Inmueble`, `Disponibilidad.referencía` → `$('PROMPT').first().json.referencia`
  (antes `$('Edit Fields3')`, que no existe en Instagram, o `$json.referencia`, siempre vacío).
- `Aviso_insta.referencia` → `inst_` + `$('PROMPT').first().json.referencia`.
- `Execute Workflow` (Búsqueda descripción) usa `Referencia Instagram` (antes `If2.ref_numero`, nulo en la rama sin ref).

### 2. Enlace del inmueble
- El bloque INMUEBLE del prompt de Instagram incluye la referencia y
  `https://propietats.bibangestio.com/es/ref-<ref>`, y el Bloque 3 obliga a copiar esa URL literal (nunca
  "[enlace]") y a mandarla si piden fotos. Precio en formato español ("1.250 €/mes").

### 3. Referencia activa de la conversación (arregla "piso equivocado")
- `Mensaje NO contiene "ref.xxxx"?` busca la ref en **todo el lote** de mensajes agrupados (antes solo en el último)
  y se queda con la más reciente.
- Nuevo `Etiquetas y atributos actuales` (GET conversación) → `Marcamos etiqueta2` → nuevo `Guardar ref actual`.
- `Marcamos etiqueta2` envía **etiquetas actuales + `inst_<ref>`**. La versión de hoy mandaba solo `inst_<ref>` y,
  como Chatwoot **reemplaza** la lista (comprobado), borraba `compra`, `seguimiento_x`, `4-intevenir`…
- `Guardar ref actual` guarda `ref_actual` en los atributos de la conversación, fusionando con los que ya
  había (el POST de Chatwoot también reemplaza).
- Rama sin ref: `Consultar Etiquetas Contacto` lee la conversación completa; `NO contiene "inst_"` considera
  `ref_actual` o etiquetas `inst_`; `Edit Fields9` usa `ref_actual` y, en conversaciones antiguas sin ese
  atributo, la `inst_` de número más alto.

### 4. Aviso vs Aviso_insta
- Descripciones exclusivas: `Aviso` solo para solicitudes de Mobilia; `Aviso_insta` solo para Instagram.
- Cada prompt dice explícitamente qué tool de aviso usar y prohíbe la otra.
- `Motivo_escalado` (ambas tools) y los prompts piden un **resumen completo** (50-120 palabras, un párrafo,
  todas las respuestas de cualificación) en lugar de "20-30 palabras".

### 5. Respuesta vacía de la IA
- `Agente Bibán` con `onError: continueRegularOutput` (un fallo del agente ya no corta la ejecución).
- `Filter5` → IF `¿Respuesta válida?` (no vacía, sin "Agent stopped" ni "JSON"; antes la condición era OR y
  dejaba pasar casi todo). Si no es válida: `Mensaje espera (sin respuesta IA)` al cliente →
  `Nota interna (sin respuesta IA)` → `Aviso equipo (sin respuesta IA)` (plantilla a la oficina vía Aviso_insta).
- `Filter6` → IF `¿Partes válidas?`: si `Divide Mensajes` devuelve basura, se envía la respuesta completa del agente.
- `Envió Mensaje Total` no era una expresión (habría enviado literalmente `{{ $json.output }}`); corregido.

### 6. Prompts (Instagram y solicitudes)
- Dos intentos por pregunta de cualificación: si no responde, se reformula **una vez** con otras palabras;
  al segundo intento sin respuesta, "no respondido" y siguiente.
- Si preguntan "¿para qué tantas preguntas?": son preguntas para ver si podemos ayudarle con esta vivienda y
  comprobar que se cumplen los requisitos que se piden para esta propiedad (p. ej. los del propietario).
- Llavero con error → se trata como "no disponible", sin mencionar errores al cliente.
- Textos completos: `prompts/biban_instagram_v2.md` y `prompts/biban_solicitudes_v2.md`.

## Aviso (`jjJkk3l6Z6fzW64u`) y Aviso_insta (`8zxiYZJE3BIHePAN`)
- `Code in JavaScript`: ya no corta el motivo a 200 caracteres; quita saltos de línea y tabuladores
  (no se admiten en parámetros de plantilla de WhatsApp) y limita a 900 caracteres.

## Sin cambios, por decisión del cliente
- Consulta Llavero: si hay llavero se agenda, aunque la llave esté "En uso".
- Presentación "Bibán Assessors" en Instagram (intencionada).

## Test del embudo Instagram alquiler (conv 215, Jaime)

Mensajes entrantes simulados enviando al webhook `Chatwoot-n8n` el mismo payload que Chatwoot
(cada mensaje simulado queda como nota privada "🧪 TEST" en la conversación).

| # | Cliente | Resultado |
|---|---|---|
| 1 | Mensaje del reel con `ref-1204` | ✅ `inst_1204` añadida, `ref_actual=1204`, apertura + 1ª pregunta |
| 2 | "Tiene ascensor?" | ✅ responde con la ref guardada · ⚠️ repite la pregunta casi literal |
| 3 | "Y cuándo se podría ir a verlo?" | ✅ tras 2 intentos, la da por no respondida y pasa a la 2ª |
| 4 | "¿Para qué tantas preguntas?" | ✅ explicación pedida · ⚠️ repite la pregunta literal |
| 5 | Asalariados, indefinido y temporal | ✅ no repregunta el contrato · ⚠️ "gracias por compartirlo" |
| 6-7 | Ingresos x3 / nacionales | ✅ |
| 7 | — | ✅ enlace real y "1.250 €/mes" · ⚠️ enlace en formato Markdown `[url](url)` |
| 8 | "Me encaja, quiero visitarlo" | ✅ Llavero funciona: NO disponible → pide día |
| 9 | "El jueves por la tarde, desde las 17h" | ✅ `aviso_insta` con resumen completo (361 car.) · ⚠️ no manda el formulario |
| 10 | "Genial, gracias!" | 🔴 segundo `aviso_insta` a la oficina (duplicado) + Llavero otra vez; manda el formulario |
| 11-13 | Cambio a `ref-1203` y vuelta a `ref-1204` | ✅ etiquetas acumuladas, `ref_actual` cambia y la pregunta sin ref usa la 1204 |

Sin probar: rama con llave (Agendar) y fallback de respuesta vacía (no se puede forzar sin tocar el flujo).

## Segunda tanda (30/09, madrugada)

Subida con aprobación del cliente. Copias previas: las de la primera tanda siguen en n8n (inactivas).

**Aviso_insta (`8zxiYZJE3BIHePAN`)** — un solo aviso por conversación y referencia:
`Code` → `Conversación actual` (GET) → `¿Aviso ya enviado?` (compara `aviso_insta_ref` de la conversación con la
referencia; las alertas `error_ia` siempre pasan) → sí: `Aviso duplicado bloqueado` · no: `Telefono Oficina1` →
`Marcar aviso enviado` (guarda `aviso_insta_ref` y `aviso_insta_fecha` fusionando atributos) → `Aviso enviado`.
La plantilla usa ahora el motivo limpio del nodo Code (antes usaba el del disparador, sin limpiar).

**Aviso (`jjJkk3l6Z6fzW64u`)** — los tres nodos de WhatsApp usan el motivo limpio del nodo Code.

**Agente AT**
- `Ficha web` (GET `propietats.bibangestio.com/es/ref-<ref>`) → `Extraer ficha web` (descripción completa y
  características) entre `Referencia Instagram` y `Buscar ref. y descripción`; `Edit Fields8` pasa `ficha_web` al prompt.
- Prompt Instagram: bloque "Ficha publicada en la web" (manda sobre el resumen interno); cada pregunta tiene frase de
  1ª vez y de 2º intento; el precio y el enlace solo se envían al terminar las preguntas y siempre antes de hablar de
  visita; el formulario va en el mismo turno que el aviso; gestión cerrada tras avisar; sin nueva presentación
  si cambia de referencia; resumen del aviso en una línea por campos, solo con datos de cualificación y cifras reales.
- Tool `Aviso_insta`: máximo una llamada por referencia; formato del resumen en la descripción del parámetro.
- Los enlaces Markdown no se tocan: Chatwoot ya los convierte para WhatsApp (comprobado por el cliente).

### Test final (conv 215, memoria y atributos reiniciados)

| # | Cliente | Resultado |
|---|---|---|
| 1 | Mensaje del reel `ref-1204` | ✅ etiqueta + `ref_actual`, apertura |
| 2 | ¿Ascensor? ¿Mascotas? | ✅ responde y retoma la 1ª pregunta **reformulada** |
| 3 | ¿Cuándo se puede ver? | ✅ no adelanta precio; 1ª sin respuesta → 2ª |
| 4 | ¿Para qué tantas preguntas? | ✅ explicación pedida + 2ª con otra frase |
| 5 | Asalariados, indefinido y temporal | ✅ pasa a la 3ª · ⚠️ "gracias por la información" |
| 6 | ¿Incluye gastos? | ✅ responde con la ficha web · ⚠️ repite la 3ª literal |
| 7-8 | 4.500 €/mes · nacionales | ✅ características + precio + enlace al terminar |
| 9 | Me encaja, quiero verlo | ✅ Llavero: no disponible → pide día |
| 10 | Jueves tarde desde las 17h | ✅ **1 aviso** con resumen completo + formulario en el mismo turno |
| 11 | Genial, gracias! | ✅ intento de 2º aviso **bloqueado**; nada raro al cliente |
| 12 | ¿Amueblado? ¿Trastero? | ✅ responde con la ficha web (amueblado, 2 trasteros) |

Resumen recibido por la oficina:
`Ref 1204 alquiler 1.250 €/mes | Personas: mi pareja y yo | Buscando desde: no respondió | Situación laboral:
asalariado (indefinido), asalariado (temporal) | Ingresos x3 renta: sí, unos 4.500 €/mes entre los dos |
Ingresos: nacionales | Disponibilidad: jueves por la tarde, a partir de las 17h | Observaciones: -`

## Intento de cambio a gpt-5.6-luna (30/09, 09:15-09:21 UTC) — revertido

- Con Chat Completions: OpenAI rechaza herramientas + razonamiento en `gpt-5.6-luna`
  ("use /v1/responses or set reasoning_effort to 'none'").
- Con `responsesApiEnabled: true`: el nodo `Agente Bibán` (typeVersion 2) no admite el modelo
  ("upgrade the Agent node to the latest version").
- Vuelto a `gpt-4o` a las 09:21. Solo se vieron afectadas dos ejecuciones de prueba (conv 215).
- Arreglado de paso: `Aviso equipo (sin respuesta IA)` fallaba por tipos (`id_conver` numérico); ahora convierte a texto.
  Probado en real: la oficina recibió una alerta `error_ia` de la prueba (ejecución 3531 de Aviso_insta).
