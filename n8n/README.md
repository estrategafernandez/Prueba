# reimpactos_nuevafranja

Secuencia automática de reimpactos por WhatsApp gobernada por las etiquetas de Chatwoot.

- **Instancia n8n:** `https://n8n-tendenze.serversvisionarius.com`
- **ID del workflow:** `UdVU24fWdP42ZtGa`
- **Estado:** creado **desactivado**, pendiente de revisión y de moverlo a la carpeta `FRANQUICIAS`.
- **Base:** workflow `Reimpacto` (`LVbxk6iwskxwkv3C`), que **no se ha modificado**.

## Calendario

Los días se cuentan desde el **Día 1**, que es el envío de la plantilla inicial
(la hace otro workflow y deja la etiqueta `z_plantilla_enviada_meta`).

| Fase actual (etiqueta) | Día | Espera | Envía | Etiqueta resultante |
|---|---|---|---|---|
| `z_plantilla_enviada_meta` | 1 | 1 día | R1 | `z_reimpacto1_meta` |
| `z_reimpacto1_meta` | 2 | 2 días | R2 | `z_reimpacto2_meta` |
| `z_reimpacto2_meta` | 4 | 3 días | R3 | `z_reimpacto3_meta` |
| `z_reimpacto3_meta` | 7 | 3 días | R4 | `z_reimpacto4_meta` |
| `z_reimpacto4_meta` | 10 | 4 días | R5 | `z_reimpacto5_meta` |
| `z_reimpacto5_meta` | 14 | 6 días | R6 · cierre | `z_reimpacto6_meta` |
| `z_reimpacto6_meta` | 20 | — | nada (fin) | — |

La etiqueta anterior se retira y se pone la nueva; las etiquetas ajenas a la
secuencia (`si_dinero`, `seguimiento`, …) se conservan intactas.

Todo el calendario está en el mapa `DIA_DE_LA_FASE` del nodo
**CalcularFaseYDiasEspera**. Cambiando esos números cambia la cadencia entera:
la espera de cada paso se deduce restando los días de dos fases consecutivas.

## Flujo

```
Programador Horario (cada hora)
  └─ BuscarConversacionesReimpacto   POST /conversations/filter  (con paginación)
     └─ SepararConversaciones
        └─ ExcluirNoReimpactables    descarta z_respuesta_cliente_plantilla / cuestionario_completado / descartado
           └─ SoloPruebas_UnNumero   (DESACTIVADO — actívalo para probar con un solo teléfono)
              └─ Por Cada Conversación
                 ├─ (fin) ─ Fin
                 └─ (bucle)
                    ├─ RecogerEtiquetasExistentes     GET  /labels
                    ├─ RecogerMensajesConversacion    GET  /messages
                    ├─ CalcularFaseYDiasEspera        decide si toca reimpacto y cuál
                    └─ TocaReimpacto
                       ├─ no ─ vuelve al bucle
                       └─ sí
                          ├─ PrepararEnvioReimpacto   plantilla, idioma y vídeo de la fase
                          ├─ TienePlantillaConVideo
                          │  ├─ sí ─ DescargarVideoDrive ─ SubirVideoaMeta ─ EnviarPlantillaConVideo
                          │  └─ no ─ EnviarPlantillaSinVideo
                          ├─ RecogerContenidoPlantilla  texto real de la plantilla en Meta
                          ├─ ExtraerTextoPlantilla
                          ├─ PrepararNotaInterna
                          ├─ NotaInternaChatwoot        deja el texto como nota privada
                          ├─ GuardarHistorialPostgres   n8n_chat_histories_franquicias
                          └─ ActualizarEtiquetas        avanza la etiqueta y vuelve al bucle
```

## Reglas de seguridad

- **No se reimpacta** a quien tenga `z_respuesta_cliente_plantilla`,
  `cuestionario_completado` o `descartado`.
- **No se reimpacta** si el lead ha escrito algo después de nuestro último
  impacto (respuesta detectada en el historial de mensajes).
- **El reloj se ancla en el mensaje de actividad de Chatwoot** que añadió la
  etiqueta de la fase actual, no en el último mensaje de la conversación. Así
  una nota interna de un comercial no retrasa la secuencia. Si esa actividad ya
  no está en el historial reciente, se usa como reserva el último mensaje real.
- **Franja horaria de envío:** 09:00–21:00 (Europe/Madrid). Fuera de la franja
  la conversación simplemente espera al siguiente ciclo del mismo día; no se
  salta ningún reimpacto. Se desactiva poniendo `FRANJA_ACTIVA = false`.
- **Paginación:** la búsqueda recorre todas las páginas de resultados. El
  endpoint de Chatwoot devuelve 25 conversaciones por página.

## Nota interna en Chatwoot

Tras cada envío se deja en la conversación una nota privada con el texto real
que ha recibido el lead, encabezada por el número de seguimiento:

```
**SEGUIMIENTO 3**

<texto de la plantilla reimpacto3>
```

El título lo compone el nodo `PrepararNotaInterna` a partir de
`numero_reimpacto`, así que se mantiene solo si algún día cambian los nombres
de las plantillas. Va en negrita porque Chatwoot interpreta markdown.

El historial de `n8n_chat_histories_franquicias` guarda **solo el texto de la
plantilla**, sin el título: ese registro es la memoria del asistente y debe
reflejar lo que el lead vio, no la anotación interna.

## Diferencias frente al workflow `Reimpacto` original

| | `Reimpacto` | `reimpactos_nuevafranja` |
|---|---|---|
| Espera entre impactos | fija, 144 h para todas las fases | por fase, según el calendario |
| Origen del reloj | `last_non_activity_message` (lo alteran las notas internas) | actividad de la etiqueta de la fase |
| Cobertura | solo las 25 primeras conversaciones | todas, con paginación |
| Lead que ha respondido | no se comprueba | se detecta y se detiene la secuencia |
| Franja horaria | no hay | 09:00–21:00 Europe/Madrid, configurable |
| Filtro de pruebas | activo (un solo teléfono) | presente pero desactivado |

## Sobre este JSON

`reimpactos_nuevafranja.json` es una copia del workflow **con los secretos
sustituidos** por marcadores, para no publicarlos en el repositorio:

- `__CHATWOOT_API_ACCESS_TOKEN__` → cabecera `api_access_token` de Chatwoot
- `__META_GRAPH_ACCESS_TOKEN__` → `Authorization: Bearer …` de la Graph API de Meta

Si se importa este fichero en n8n hay que reponer ambos valores. El workflow
que está en n8n ya los tiene puestos.
