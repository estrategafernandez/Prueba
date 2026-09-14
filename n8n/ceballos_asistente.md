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
