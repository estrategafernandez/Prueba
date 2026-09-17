# Llamadas a ficha WhatsApp — Franquicias

Vuelca las llamadas del inbox de voz a la conversación de WhatsApp del mismo
contacto: nota privada con resumen y la grabación adjunta.

- **Workflow:** `yJz2L79337Pjijlh` · **activo, en modo prueba**
- **Cuenta Chatwoot:** 5 (Franquicias) · inbox 9 (Voice) → inbox 7 (WhatsApp)
- **Webhook de Chatwoot (instantáneo):** `.../webhook/4e9a1c60-8b73-4d52-a0f6-1d5e73b9c284`
  — suscripción `message_created`, webhook id 3 de la cuenta 5.
- **Webhook de prueba manual:** `.../webhook/b3d81f27-5c64-4a19-91e2-7f0a6d4c8e35`

## Cuándo se dispara

**Instantáneo.** Chatwoot avisa por `message_created` en cuanto empieza la
llamada. En ese momento todavía no hay grabación —el mensaje nace con
`status: ringing` y `recording_url: null`—, así que el workflow **sondea cada
30 s** hasta que cuelgan y aparece el audio. La nota cae segundos después de
colgar, no minutos.

Límites del sondeo: hasta 30 intentos (15 min, cubre la llamada más larga
registrada, de 11 min) y, una vez colgado, 3 min más por si Twilio tarda en
subir la grabación.

**Barrido cada 10 min.** Red de seguridad, no la vía principal. Recoge lo que
el webhook se haya perdido: caída de n8n, entrega fallida, o una grabación que
tardó más de la cuenta. Si todo va bien no hace nada.

El nodo `Configuracion` decide la vía: si el nodo `Webhook Chatwoot` se ejecutó,
es instantánea; si no, es barrido. Y descarta de entrada lo que no sea una
llamada del inbox 9, que es casi todo el tráfico de la cuenta.

## Cómo se enlaza la llamada con el WhatsApp

En Chatwoot el contacto es único por cuenta y tiene una conversación por inbox,
así que el enlace es directo: de la conversación de llamada se saca el
`contact_id` y se pide `GET /contacts/{id}/conversations`, quedándose con la del
inbox 7.

Comprobado sobre los 31 contactos con llamadas: **30 tienen exactamente una
conversación de WhatsApp**, ninguno tiene más de una, y uno no tiene ninguna. En
ese caso la nota se queda en la propia conversación de llamada, con un aviso, en
vez de perderse.

## De dónde sale el audio

Los mensajes del inbox de voz son `content_type: voice_call` y traen un objeto
`call`:

```json
"call": { "id": 51, "status": "no-answer", "duration_seconds": 0,
          "recording_url": null, "transcript": null, "direction": "outgoing",
          "accepted_by_agent_name": "Alba", "started_at": 1789568423 }
```

`recording_url` es el criterio: si viene, hay audio. Se descarga sin
autenticación porque la URL de ActiveStorage ya va firmada.

## Flujo

```
Programador (cada 10 min)  /  Prueba Manual (webhook)
  └─ Configuracion
     └─ BuscarConversacionesLlamada   filtro inbox 9, con paginación
        └─ SepararConversaciones ─ FiltrarConversaciones ─ Por Cada Llamada
           ├─ (fin) Fin
           └─ RecogerMensajesLlamada ─ AnalizarLlamada ─ QueHacemos
              ├─ volcar    BuscarConversacionWhatsApp ─ LocalizarDestino
              │            ─ DescargarGrabacion ─ NombrarAudio ─ TranscribirGrabacion
              │            ─ ResumirLlamada ─ PrepararNota
              │            ─ DescargarAudioParaAdjuntar ─ NombrarAudioAdjunto
              │            ─ PublicarNotaConAudio ─ MarcarLlamadaVolcada
              ├─ sin audio MarcarSinAudio ─ DebeBorrar
              │              ├─ sí  BorrarLlamadaSinAudio   (DESACTIVADO)
              │              └─ no  NoBorrarTodavia
              └─ esperar   vuelve al bucle
```

El audio se descarga dos veces a propósito: la transcripción consume el binario,
así que se vuelve a bajar para adjuntarlo. Son 2,8 MB, sale más barato que
arrastrar el binario por toda la cadena.

## Salvaguardas

**El borrado está doblemente apagado.** `BORRAR_LLAMADAS_SIN_AUDIO = false` y
además el nodo `BorrarLlamadaSinAudio` está desactivado. Hacen falta las dos
cosas para que borre. Cuando se active, borra **solo la conversación** del inbox
de llamadas; el contacto nunca se toca.

**Margen de 15 minutos.** Twilio tarda en subir la grabación después de colgar.
Una llamada no se da por "sin audio" hasta 15 min después de terminar, para no
borrar algo que sí tenía audio.

**Llamadas atendidas sin grabación.** Hay 4 conversaciones con llamadas que
Twilio marca `completed` y duran 12–21 s pero no dejan grabación: esas se
cogieron. No se borran — se apartan como "revisar a mano". Umbral en
`SEGUNDOS_PARA_CONSIDERAR_ATENDIDA = 5`.

**Nunca se borra una conversación que tenga alguna grabación**, aunque tenga
además llamadas perdidas.

**La nota va en privado.** `private = true`. Si eso fallara, la grabación se
enviaría al cliente por WhatsApp; por eso la primera prueba fue contra un
contacto ficticio.

**Sin duplicados.** Cada llamada volcada se anota en el atributo
`llamadas_volcadas` de la conversación de llamada. Una conversación con varias
llamadas vuelca una por ciclo.

## Pruebas realizadas

### 1. Volcado completo (conversación 44 · Coral · +34000000000 · 183 s)
Transcripción y resumen correctos. Nota en la conversación de WhatsApp 4 con
`private: true` y adjunto `audio/wav` de 2,83 MB. Atributo
`llamadas_volcadas: "1"` escrito. Relanzado: decide `esperar`, no duplica.

### 2. Volcado completo por la vía instantánea (conversación 143 · Mila · 6 s)
Entró por el webhook, sondeó, vio la grabación y volcó. Nota en la conversación
133 con `private: true` y wav de 57 KB. La grabación de 6 s no tenía contenido
útil y el resumen respondió lo previsto para ese caso: *"Grabacion sin contenido
aprovechable."* en vez de inventarse algo.

### 3. Rama sin audio (conversación 145 · llamada `no-answer`)
Decidió `sin_audio`, escribió la marca, pasó por `DebeBorrar` y salió por
`NoBorrarTodavia`. **El nodo de borrado no llegó a ejecutarse.** Comprobado
después: la conversación 145 sigue existiendo y el contacto 1777 intacto. La
marca de prueba se revirtió.

### 4. El webhook con tráfico real
Tres entregas reales de Chatwoot (mensajes de WhatsApp del inbox 7) llegaron al
workflow y salieron por `ignorar` en cuatro nodos, sin tocar nada.

### 5. Pruebas locales de lo que no se puede probar contra producción
Trece comprobaciones, todas correctas: destino de la nota (con WhatsApp, sin
WhatsApp, varias conversaciones, contacto sin ninguna), formato de la nota
(duración en minutos, llamada entrante, aviso de que no hay WhatsApp, marca de
la llamada) e idempotencia con dos llamadas en la misma conversación (vuelca la
más antigua primero, luego la siguiente, luego nada) y el caso mixto de una
perdida junto a una grabada ya volcada, que **no** se marca para borrar.

## El workflow se oye a sí mismo

La nota que publica es un mensaje, así que Chatwoot dispara `message_created` y
vuelve a entrar. Se descarta correctamente, porque el filtro exige inbox 9 y
`content_type: voice_call`, y las notas van al inbox 7 como texto. No hay bucle
posible mientras ese filtro no se toque.

## Reparto actual de las 42 conversaciones del inbox de voz

| Acción | Nº |
|---|---|
| volcar (tienen grabación) | 28 |
| sin audio (borrables al activar) | 10 |
| revisar a mano (atendidas sin grabación) | 4 |

## Coste de tener el webhook

La suscripción es `message_created` sobre toda la cuenta 5, porque Chatwoot no
deja filtrar por inbox. Eso significa que **cada mensaje de WhatsApp de la
cuenta crea una ejecución** que muere en el primer nodo al ver que no es una
llamada. No consume nada relevante, pero ensucia el historial de ejecuciones.
Si molesta, se puede poner el workflow en *Save successful executions: none*.

## Para pasar a producción

1. `SOLO_ESTA_CONVERSACION = null` en el nodo `Configuracion`. **Ojo:** en la
   primera pasada volcará las 28 pendientes de golpe.
2. Para el borrado: `BORRAR_LLAMADAS_SIN_AUDIO = true` **y** habilitar el nodo
   `BorrarLlamadaSinAudio`.
3. Revisar antes las 4 conversaciones apartadas.

## Pendiente de decidir

- **Aviso legal de grabación.** En la propia llamada de prueba se oye al equipo
  preguntándose si hay que avisar de que se graba. Conviene cerrarlo antes de
  ampliar el volcado.
- Si el disparador debe ser un webhook de Chatwoot en vez del programador. El
  webhook de `message_created` llega cuando la llamada **empieza**, y entonces
  todavía no hay grabación, así que haría falta esperar igualmente.
