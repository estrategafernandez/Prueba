# Biban Gestió — Análisis del embudo Instagram (alquiler)

- **Instancia n8n:** `https://n8n-biban.serversvisionarius.com`
- **Chatwoot:** `https://panel-biban.serversvisionarius.com` (cuenta 1, inbox 2 WhatsApp)
- **Fecha del análisis:** 29/09/2026 — **no se ha modificado nada**.

## Workflows

| ID | Nombre | Estado | Papel |
|---|---|---|---|
| `9l8UOsqXN3Bn53ao` | Agente AT | activo | Webhook `Chatwoot-n8n`, agrupa mensajes (Redis 30 s), enruta embudo y ejecuta el agente "Agente Bibán" |
| `2ikfPf8W9FKVZbLB` | Consulta Llavero | activo | Mobilia `GET /inmuebles/{ref}/llavero` |
| `8zxiYZJE3BIHePAN` | Aviso_insta | activo | Plantilla `plantilla_aviso_interno` a la oficina (+34 977 87 34 04) |
| `jjJkk3l6Z6fzW64u` | Aviso | activo | Aviso del embudo de solicitudes |
| `WBVHhO8HjfYg9Koz` | Disponibilidad | activo | Huecos de agenda |
| `x1CVKFpndIAJgPlS` | Agendar | activo | Crea la visita en Mobilia |
| `paw6CPUPGzgoKblt` | Búsqueda descripción mobilia | activo | Si la ref no está en la tabla `inmuebles`, la saca de Mobilia, la resume con GPT y la guarda |
| `bbX5mwUMYPdcp2kh` | Captación Leads Mobilia | activo | Embudo de solicitudes (bienvenida) |
| `W2PDOLIMUUb5aiVp` | Seguimientos | activo | Reimpactos |
| `EMnzzdTCAoJ0yGyW` | elimina memoria | inactivo | Borra `n8n_chat_histories` |

## Enrutado en "Agente AT"

```
Mensaje ─ ¿contiene ref[.-]XXXX?
  ├─ sí → crea etiqueta inst_XXXX si no existe → la añade a la conversación
  │       → Buscar ref en tabla inmuebles (o Búsqueda descripción mobilia) → prompt Instagram
  └─ no → ¿la conversación tiene etiqueta inst_*?
          ├─ sí → coge la PRIMERA inst_* → Buscar ref → prompt Instagram
          └─ no → tabla interes_inmueble por teléfono → prompt solicitudes
```

El sistema de etiquetas `inst_<ref>` **ya existe** y funciona (crea la etiqueta si no existe y la añade sin borrar las demás).

## Fallos detectados (confirmados con ejecuciones)

### Críticos
1. **Llavero siempre falla en Instagram.** La tool `Llavero` (y también `Agendar`) toma la referencia de
   `$('Edit Fields3')`, nodo que solo se ejecuta en el embudo de solicitudes.
   Error real (ejec. 3440): `Node 'Edit Fields3' hasn't been executed`. El sub-workflow no se ejecutó ni una vez el 29/09.
2. **No se envía el enlace/fotos.** La tabla `inmuebles` solo tiene `referencia` y una `descripcion` escrita
   para voz (números en letra), sin URL. El prompt pide "enlace del inmueble" pero no se lo da → el bot escribe
   `[enlace al inmueble]`. URL válida para cualquier ref: `https://propietats.bibangestio.com/es/ref-<ref>`.
3. **Piso equivocado con varias etiquetas inst_.** `Edit Fields9` usa `payload.find(tag => tag.startsWith('inst_'))`
   → la primera en orden alfabético. Fernando tenía `inst_1199` + `inst_1204`: preguntó por el alquiler 1204
   (1.250 €/mes) y el bot le presentó la venta 1199 (490.000 €, ejec. 3454).

### Importantes
4. `Aviso` y `Aviso_insta` están conectadas al mismo agente con la misma descripción. `Aviso` en Instagram
   falla (`Select rows from a table` no se ejecuta) y `Aviso_insta` en solicitudes falla (`If1` no se ejecuta).
5. `Disponibilidad.referencía = $json.referencia` → vacío siempre (el `$json` del agente solo tiene `prompt`).
6. Consulta Llavero solo mira si existe `idLlavero`, no su `estado`: una llave "En uso" se trata como disponible.
7. Si el agente devuelve texto vacío, `Divide Mensajes` inventa texto de esquema JSON, `Filter6` lo corta
   y **el cliente no recibe nada** ni se avisa a nadie (ejec. 3417).
8. Un mensaje de Instagram sin ref (plantilla antigua del wall-link) cae en el embudo de solicitudes.

### Menores / a validar
9. Marca: el prompt de Instagram dice "Bibán Assessors"; el resto del sistema, "Biban Gestió".
10. Formato de precio "1,250 euros" (formato inglés). Pedir en el prompt "1.250 €/mes".
11. `Etiquetar` aplica `vendedores` (el prompt habla de "Intervenir propiedad"); el body construye un único
    string `"<etiquetas>, vendedores"` que funciona solo porque Chatwoot lo separa por comas.
12. `Aviso_insta` corta el motivo a 200 caracteres; el aviso de Isac perdió "fijo discontinuo", "30.000 €" y "nacionales".
13. La descripción de 1204 dice que el alquiler incluye comunidad/IBI/basuras, pero el prompt prohíbe afirmar esos datos.
14. La regex solo acepta 4 dígitos exactos (`ref 12345` → `1234`).
15. La caché `inmuebles` no se refresca nunca (cambios de precio) y `Búsqueda descripción` se queda con
    `elementos[0]` de una búsqueda de texto libre.
16. La memoria del agente se indexa por teléfono y se comparte entre embudos (solicitudes + Instagram).
17. `Filter` (lista blanca de pruebas, desactivado): +34637825004 tiene caracteres Unicode invisibles.
18. Nodos apuntando al Chatwoot de Vivalta en `Agendar` y `Captación Leads Mobilia`: todos son **código muerto**
    (inalcanzables), sin riesgo; solo limpieza.

## Resuelto ya por el equipo
- Ejec. 3419 (10:49): la regex exigía `ref.` con punto y no reconocía `ref-1204`. Corregida a `ref[.\-]?`.
- Ejec. 3424 (13:21): en alquiler preguntaba "¿necesitáis vender alguna propiedad?". El prompt actual ya lo hace bien.
