# Biban Gestió — Cambios preparados (29/09/2026)

**Estado:** preparados y validados, **pendientes de subir a n8n**. La escritura en producción
necesita permiso explícito.

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
