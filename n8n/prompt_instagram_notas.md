# Prompt de Instagram v1 — de dónde sale cada dato

El prompt vive en `prompts/instagram_v1.md` e instalado en el nodo
`Agente TENDENZE` del workflow `Du50z3ZBQwr6jGRF`.

## Objetivo

Resolver dudas (es lo que más escriben) y derivar al WhatsApp del centro. **No
agenda**: por Instagram no hay acceso a la agenda, y el prompt se lo prohíbe
explícitamente para que no prometa citas que no puede dar.

## Fuentes analizadas

| Fuente | Workflow | Qué se ha tomado |
|---|---|---|
| Girona | `d9Y3UuYRt0EXcZjZ` (cuenta 3, ClinicID 9) | precios, condiciones, tono, escalado, ICE Láser, dirección |
| Inca | `9eAoMetLyfG0CjuL` (ClinicID 23) | dirección, horario |
| Formación | `RXGHVMd3nC1qgey8` | criterio de "no deducir nada que no esté en el material" |
| Franquicias | `wWpFELMAYSrkzBnZ` | red de 8 centros, 4,9 estrellas, desde 2019 |

## Hallazgos

**Los precios de Girona e Inca son idénticos.** Comparadas las dos secciones de
precios línea a línea ignorando líneas en blanco: 173 líneas con contenido cada
una, **0 diferencias**. Por eso el prompt lleva una sola lista de precios y
avisa de que valen para los dos centros, en vez de duplicarla por centro.

**Los teléfonos de los centros no estaban en los prompts.** Los números que
aparecen ahí (`+34644871165`, `+34639043587`) son datos de prueba fijados en los
webhooks, es decir, teléfonos de clientes, no de los centros. Los reales salen
de la configuración de los inboxes de Chatwoot:

```
cuenta 3 / inbox 3  Girona  →  +34677030457
cuenta 4 / inbox 4  Inca    →  +34610966118
```

## Decisiones tomadas

**Sin formato de texto.** Instagram no interpreta markdown. Los prompts de
WhatsApp usan `**negrita**` por todas partes; aquí eso se vería como asteriscos
sueltos, así que el prompt prohíbe cualquier símbolo de formato. Comprobado: 0
ocurrencias de `**` en el prompt.

**Sin la calculadora de packs al vuelo.** El prompt de Girona lleva un motor de
cálculo (11 categorías, tabla de importes por número de zonas, excepciones a
0 €, dos fórmulas) para combinaciones de zonas no listadas. No se ha copiado:
un error de cálculo aquí es un precio equivocado dicho a un desconocido en un
canal público. Esas consultas se derivan al centro, que además es el objetivo
del asistente. Si se quiere el cálculo automático, se puede portar después.

**Girona no tiene horario.** El prompt de Inca define horario de centro; el de
Girona no lo tiene en ninguna parte. No se ha inventado: si preguntan por
horarios de Girona, el prompt deriva al WhatsApp del centro. **Conviene pasar el
horario de Girona para cerrar este hueco.**

**Fuera de zona.** Con más de 8 centros pero solo dos derivables, el prompt no
confirma ni niega que haya centro en ninguna otra ciudad: pide la ciudad, marca
`fuera_de_zona` y pasa a una persona. Así no se dice "no tenemos centro en X"
cuando sí lo hay.

**Franquicias.** Si preguntan por franquiciarse, no entra en inversión ni
rentabilidad: etiqueta `prioridad` y pasa al equipo de expansión.

## Etiquetas que hay que crear en la cuenta 7

La cuenta 7 no tiene ninguna etiqueta definida. El prompt usa estas:

```
derivado_girona   derivado_inca   fuera_de_zona   solicitud_humana
salud   incidencia   pago   sensible   prioridad   error_del_sistema
```

Las seis últimas son las mismas que ya usan Girona e Inca. Las tres primeras son
nuevas y sirven para medir cuántos DM acaban en cada centro.

## Verificación de precios

Las 30 cifras del prompt se han contrastado una a una contra el prompt de
Girona, y no hay ninguna cifra en euros que no exista en el original.

## Pendiente de decidir

1. Horario de Girona.
2. Si los walinks deben llevar texto previo (`?text=...`) para saber que el
   contacto viene de Instagram. Ahora son enlaces limpios `wa.me/<número>`.
3. Si hay walinks propios (walink.co o similar) en vez de `wa.me`.
4. Si el asistente debe ofrecer los enlaces de compra de Shopify que usan Girona
   e Inca, o mantenerse solo en informar y derivar. Ahora hace lo segundo.
