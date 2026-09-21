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

## Estructura

```
lib/casagencia_comun.js   horarios, festivos, teléfonos, routing y ocupación
nodes/*.js                el cuerpo de cada nodo Code
build_workflows.py        ensambla los JSON y los despliega
workflows/*.json          lo que hay desplegado ahora mismo
retell/general_prompt.md  el prompt de Sara
retell/update_retell.py   despliega prompt, herramientas y ajustes del agente
tests_logica.js           30 tests de horarios, festivos, teléfonos y routing
tests_busquedas.js        tests de búsqueda por dirección y de cita por teléfono
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
```

El número de teléfono de Retell usa `latest_published`, así que un cambio en el
agente **no entra en producción hasta que se publica**. `update_retell.py` lo
publica al final.

## Pendiente

- **Festivos locales.** `FESTIVOS.TODOS` trae los de fecha fija (nacionales y
  9 d'Octubre). Las fiestas locales de Benicàssim, Oropesa, Castellón y
  Vila-real están vacías: hay que rellenarlas en `lib/casagencia_comun.js`.
- **Columna `direccion`.** El feed XML de Janela no trae la calle, solo
  municipio, zona, CP y coordenadas. `BuscarPorDireccion` puntúa contra la
  descripción y la zona, que cubre parte de la cartera. Si se añade una columna
  `direccion` a la hoja *Inmuebles*, el código la usa automáticamente y con el
  peso más alto, sin tocar nada.
- **Permisos de las grabaciones.** `Share file` sigue publicando cada audio con
  `role: writer, type: anyone`: cualquiera con el enlace puede editarlas.
