#!/usr/bin/env python3
"""Construye y despliega los workflows del asistente telefonico de Casagencia.

  python3 build_workflows.py            -> solo genera los JSON en workflows/
  python3 build_workflows.py --deploy   -> ademas los sube a n8n

La API key se lee de la variable de entorno N8N_API_KEY.
"""
import json, os, sys, uuid, pathlib, urllib.request

BASE = pathlib.Path(__file__).parent
N8N = "https://n8n-casagencia.serversvisionarius.com"
CRED_CAL = {"googleCalendarOAuth2Api": {"id": "KKDdmqzzE6jXVm5b", "name": "Google Calendar Paco"}}
CRED_SHEETS = {"googleSheetsOAuth2Api": {"id": "TPExRnq8a9FlEXAh", "name": "Google Sheets account"}}
SHEET_ID = "1cB2UI-ScDI34QS57k-UD2ZE79P5XhpyPJu78A5zPs3Q"
# El API publico de n8n solo admite estas claves en settings.
SETTINGS = {"executionOrder": "v1", "timezone": "Europe/Madrid"}
SETTINGS_OK = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
               "saveDataSuccessExecution", "executionTimeout", "errorWorkflow",
               "timezone", "executionOrder"}

LIB = (BASE / "lib" / "casagencia_comun.js").read_text(encoding="utf-8")
# --sin-email: despliega ConfirmarCita y registrarMensaje sin el aviso (solo para pruebas)
SIN_EMAIL = "--sin-email" in sys.argv

# En n8n todo cuelga del mismo proyecto personal y los proyectos y las carpetas
# estan bloqueados por licencia. Para que las dos lineas de trabajo no se
# mezclen en la lista, los del telefono llevan este prefijo y la etiqueta
# "Asistente telefonico"; los de WhatsApp llevan [WA] y su propia etiqueta.
PREFIJO = "[TEL] "


def code(fname):
    """Nodo Code = libreria comun + el cuerpo concreto."""
    return LIB + "\n\n" + (BASE / "nodes" / fname).read_text(encoding="utf-8")


def node(name, ntype, params, pos, tv, **extra):
    n = {"parameters": params, "type": ntype, "typeVersion": tv,
         "position": pos, "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/" + name)),
         "name": name}
    n.update(extra)
    return n


def code_node(name, fname, pos):
    return node(name, "n8n-nodes-base.code", {"jsCode": code(fname)}, pos, 2)


def respond(name, pos):
    return node(name, "n8n-nodes-base.respondToWebhook", {
        "respondWith": "text",
        "responseBody": "={{ JSON.stringify($json.respuesta) }}",
        "options": {"responseCode": 200, "responseHeaders": {"entries": [
            {"name": "Content-Type", "value": "application/json; charset=utf-8"}]}},
    }, pos, 1.5)


def webhook(name, path, pos, wid=None, nid=None):
    n = node(name, "n8n-nodes-base.webhook",
             {"httpMethod": "POST", "path": path, "responseMode": "responseNode", "options": {}},
             pos, 2.1, webhookId=wid or str(uuid.uuid4()))
    if nid:
        n["id"] = nid
    return n


def cal_getall(name, calendar_expr, tmin, tmax, pos, query=None):
    opts = {"singleEvents": True}          # expande los eventos periodicos
    if query:
        opts["query"] = query
    return node(name, "n8n-nodes-base.googleCalendar", {
        "operation": "getAll",
        "calendar": {"__rl": True, "value": calendar_expr, "mode": "id"},
        "returnAll": True, "timeMin": tmin, "timeMax": tmax, "options": opts,
    }, pos, 1.3, credentials=CRED_CAL, alwaysOutputData=True,
        onError="continueRegularOutput")


AVISO_CAMPOS = ["accion", "destinatario", "referencia", "municipio", "cliente_nombre", "cliente_telefono",
                "cita", "resumen", "detalle", "conversacion_id", "pasar_a_humano", "etiqueta", "origen"]


def aviso_whatsapp(name, entradas, pos):
    """Los avisos al equipo salen SOLO por WhatsApp (a la comercial y a Paco), por el
    mismo sitio que los de WhatsApp: [WA][SUB] AvisoEquipo (lo monta build_whatsapp.py).
    Antes eran correos de Gmail."""
    ids_wa = BASE / "wa" / "ids.json"
    sub = json.loads(ids_wa.read_text(encoding="utf-8"))["[WA][SUB] AvisoEquipo"]
    tipos = {"conversacion_id": "number", "pasar_a_humano": "boolean"}
    return node(name, "n8n-nodes-base.executeWorkflow", {
        "workflowId": {"__rl": True, "value": sub, "mode": "list", "cachedResultName": "[WA][SUB] AvisoEquipo"},
        "workflowInputs": {"mappingMode": "defineBelow", "value": {k: entradas[k] for k in AVISO_CAMPOS},
                           "matchingColumns": [], "schema": [
                               {"id": k, "displayName": k, "required": False, "defaultMatch": False,
                                "display": True, "canBeUsedToMatch": True, "type": tipos.get(k, "string")}
                               for k in AVISO_CAMPOS],
                           "attemptToConvertTypes": False, "convertFieldsToString": False},
        "options": {"waitForSubWorkflow": True},
    }, pos, 1.2, onError="continueRegularOutput", alwaysOutputData=True)


def conn(*pairs):
    """conn(('A',0,'B',0), ...) -> dict de conexiones n8n"""
    out = {}
    for src, oidx, dst, didx in pairs:
        m = out.setdefault(src, {"main": []})["main"]
        while len(m) <= oidx:
            m.append([])
        m[oidx].append({"node": dst, "type": "main", "index": didx})
    return out


# =========================================================================
# 1) BuscarDisponibilidadCalendario
# =========================================================================
def wf_disponibilidad(orig):
    wh = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.webhook")
    dia = "$json.fecha_consulta"
    return {
        "name": "BuscarDisponibilidadCalendario",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "buscardisponibilidad", [-40, 0], wh.get("webhookId"), wh.get("id")),
            code_node("PrepararDatos", "bd_preparar.js", [200, 0]),
            cal_getall("LeerAgenda", "={{ $json.calendario }}",
                       "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).startOf('day').toISO() }}" % dia,
                       "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).plus({days:8}).endOf('day').toISO() }}" % dia,
                       [440, 0]),
            code_node("CalcularDisponibilidad", "bd_calcular.js", [680, 0]),
            respond("Respond to Webhook", [920, 0]),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## Guardafuegos de horario\nEl horario de oficina y los festivos se validan SIEMPRE, "
                 "tambien cuando el hueco esta libre en el calendario de la comercial.\n"
                 "Editar en n8n/casagencia/lib/casagencia_comun.js y redesplegar.",
                 "height": 180, "width": 420}, [200, -220], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "PrepararDatos", 0),
            ("PrepararDatos", 0, "LeerAgenda", 0),
            ("LeerAgenda", 0, "CalcularDisponibilidad", 0),
            ("CalcularDisponibilidad", 0, "Respond to Webhook", 0)),
    }


# =========================================================================
# 2) ConfirmarCitaCalendario
# =========================================================================
def wf_confirmar(orig):
    wh = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.webhook")
    dia = "$json.fecha_consulta"
    ini = "DateTime.fromFormat($json.fecha + ' ' + $json.hora,'yyyy-MM-dd HH:mm',{zone:'Europe/Madrid'})"
    v = "$('ValidarAntesDeInsertar').first().json"
    return {
        "name": "ConfirmarCitaCalendario",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "confirmarcitacalendario", [-40, 0], wh.get("webhookId"), wh.get("id")),
            code_node("PrepararDatos", "cc_preparar.js", [180, 0]),
            cal_getall("LeerAgendaDelDia", "={{ $json.calendario }}",
                       "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).startOf('day').toISO() }}" % dia,
                       "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).endOf('day').toISO() }}" % dia,
                       [400, 0]),
            code_node("ValidarAntesDeInsertar", "cc_validar.js", [620, 0]),
            node("PuedeCrear", "n8n-nodes-base.if", {"conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
                "conditions": [{"id": "puede-crear", "leftValue": "={{ $json.puede_crear }}",
                                "rightValue": True,
                                "operator": {"type": "boolean", "operation": "equals"}}],
                "combinator": "and"}, "options": {}}, [840, 0], 2.2),
            node("InsertarEnAgenda", "n8n-nodes-base.googleCalendar", {
                "calendar": {"__rl": True, "value": "={{ $json.calendario }}", "mode": "id"},
                "start": "={{ %s.toISO() }}" % ini,
                "end": "={{ %s.plus({hours:1}).toISO() }}" % ini,
                # Verde (Albahaca), como lo que agenda la IA por WhatsApp
                "additionalFields": {"summary": "={{ $json.titulo }}",
                                     "description": "={{ $json.descripcion }}", "color": "10"},
            }, [1080, -120], 1.3, credentials=CRED_CAL, onError="continueErrorOutput"),
            aviso_whatsapp("AvisarAsesora", {
                "accion": "PRE-RESERVA", "destinatario": "={{ %s.asesora }}" % v,
                "referencia": "={{ %s.referencia }}" % v, "municipio": "",
                "cliente_nombre": "={{ %s.nombre }}" % v, "cliente_telefono": "={{ %s.telefono_e164 }}" % v,
                "cita": "={{ %s.dia_texto + ' a las ' + %s.hora }}" % (v, v),
                "resumen": "={{ 'Pre-reservada por telefono (' + (%s.tipo_transaccion || 'compra') + '). Falta "
                           "confirmarla con el cliente.' }}" % v,
                "detalle": "={{ 'Pre-reservada por telefono por Sara (IA). Falta confirmarla con el cliente.' }}",
                "conversacion_id": 0, "pasar_a_humano": False, "etiqueta": "", "origen": "telefono"},
                [1320, -200]),
            node("RespuestaOK", "n8n-nodes-base.set", {"assignments": {"assignments": [
                {"id": "ok", "name": "respuesta", "type": "object",
                 "value": "={{ { cita_confirmada: true, motivo: 'ok', asesora: %s.asesora, "
                          "fecha: %s.fecha, hora: %s.hora, referencia: %s.referencia, "
                          "telefono: %s.telefono_e164, "
                          "evento_id: $('InsertarEnAgenda').first().json.id, "
                          "mensaje_para_sara: 'La cita ha quedado guardada como PRE-RESERVA. Diselo al cliente: "
                          "queda pendiente de que ' + %s.asesora + ' se lo confirme.' } }}"
                          % (v, v, v, v, v, v)}]}, "options": {}}, [1560, -200], 3.4),
            respond("RespondOK", [1780, -200]),
            node("RespuestaErrorCalendario", "n8n-nodes-base.set", {"assignments": {"assignments": [
                {"id": "err", "name": "respuesta", "type": "object",
                 "value": "={{ { cita_confirmada: false, motivo: 'error_calendario', "
                          "mensaje_para_sara: 'No he podido guardar la cita por un problema tecnico. NO le digas al "
                          "cliente que esta reservada: explicale que ha habido una incidencia y registra un mensaje "
                          "para que la asesora le llame y cierre la visita.' } }}"}]}, "options": {}},
                 [1320, 40], 3.4),
            respond("RespondError", [1560, 40]),
            respond("RespondRechazo", [1080, 180]),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## Segundo cortafuegos\nAunque BuscarDisponibilidad haya dicho que si, aqui se vuelve a validar "
                 "horario, festivo, telefono y ocupacion antes de escribir en la agenda.\n"
                 "El aviso (WhatsApp a la asesora y a Paco) SOLO sale si la cita se ha creado de verdad.",
                 "height": 190, "width": 430}, [620, -260], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "PrepararDatos", 0),
            ("PrepararDatos", 0, "LeerAgendaDelDia", 0),
            ("LeerAgendaDelDia", 0, "ValidarAntesDeInsertar", 0),
            ("ValidarAntesDeInsertar", 0, "PuedeCrear", 0),
            ("PuedeCrear", 0, "InsertarEnAgenda", 0),
            ("PuedeCrear", 1, "RespondRechazo", 0),
            ("InsertarEnAgenda", 0, "RespuestaOK" if SIN_EMAIL else "AvisarAsesora", 0),
            ("InsertarEnAgenda", 1, "RespuestaErrorCalendario", 0),
            *([] if SIN_EMAIL else [("AvisarAsesora", 0, "RespuestaOK", 0)]),
            ("RespuestaOK", 0, "RespondOK", 0),
            ("RespuestaErrorCalendario", 0, "RespondError", 0)),
    }


# =========================================================================
# 3) BuscarPorDireccion  (nuevo)
# =========================================================================
def wf_direccion():
    return {
        "name": "BuscarPorDireccion",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "buscarpordireccion", [-40, 0]),
            node("LeerInmuebles", "n8n-nodes-base.googleSheets", {
                "documentId": {"__rl": True, "value": SHEET_ID, "mode": "id"},
                "sheetName": {"__rl": True, "value": "gid=0", "mode": "id"},
                "options": {}}, [200, 0], 4.7, credentials=CRED_SHEETS, alwaysOutputData=True),
            node("LeerDirecciones", "n8n-nodes-base.googleSheets", {
                "documentId": {"__rl": True, "value": SHEET_ID, "mode": "id"},
                "sheetName": {"__rl": True, "value": "Direcciones", "mode": "name"},
                "options": {}}, [420, 0], 4.7, credentials=CRED_SHEETS,
                alwaysOutputData=True, executeOnce=True, onError="continueRegularOutput"),
            code_node("EmparejarDireccion", "dir_emparejar.js", [640, 0]),
            respond("Respond to Webhook", [860, 0]),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## Busqueda por calle\nNi el feed XML ni la web de Casagencia publican la calle.\n\n"
                 "Fuentes, de mas a menos peso:\n1. Pestana *Direcciones* de la hoja (a mano, la rellena "
                 "la agencia; XMLCacheo no la toca).\n2. Zona del CRM.\n3. Vias mencionadas en la "
                 "descripcion.\n\nSi no hay coincidencia clara devuelve 'no encontrado' a proposito, "
                 "para que Sara no suelte un listado generico.",
                 "height": 280, "width": 430}, [200, -320], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "LeerInmuebles", 0),
            ("LeerInmuebles", 0, "LeerDirecciones", 0),
            ("LeerDirecciones", 0, "EmparejarDireccion", 0),
            ("EmparejarDireccion", 0, "Respond to Webhook", 0)),
    }


# =========================================================================
# 4) BuscarCitaPorTelefono  (nuevo)
# =========================================================================
def wf_cita_telefono():
    tmin = "={{ $json.desde_iso }}"
    tmax = "={{ $json.hasta_iso }}"
    return {
        "name": "BuscarCitaPorTelefono",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "buscarcitaportelefono", [-40, 0]),
            code_node("NormalizarTelefono", "tel_normalizar.js", [200, 0]),
            cal_getall("LeerAgendaCarmen", "carmen@casagencia.com", tmin, tmax, [440, -120]),
            cal_getall("LeerAgendaGisela", "gisela@casagencia.com", tmin, tmax, [440, 120]),
            node("Merge", "n8n-nodes-base.merge", {"numberInputs": 2}, [680, 0], 3.2),
            code_node("FormatearCitas", "tel_formatear.js", [900, 0]),
            respond("Respond to Webhook", [1140, 0]),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## Consultar cita por telefono\nBusca en las agendas de Carmen y Gisela los eventos que "
                 "contengan el telefono del cliente (desde hace 7 dias hasta 120 dias vista).\n\n"
                 "Las citas creadas por Sara guardan el telefono normalizado en la descripcion, asi que "
                 "se encuentran siempre. Las anteriores a este cambio pueden no aparecer si el numero "
                 "se guardo con espacios.",
                 "height": 240, "width": 430}, [200, -300], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "NormalizarTelefono", 0),
            ("NormalizarTelefono", 0, "LeerAgendaCarmen", 0),
            ("NormalizarTelefono", 0, "LeerAgendaGisela", 0),
            ("LeerAgendaCarmen", 0, "Merge", 0),
            ("LeerAgendaGisela", 0, "Merge", 1),
            ("Merge", 0, "FormatearCitas", 0),
            ("FormatearCitas", 0, "Respond to Webhook", 0)),
    }


# =========================================================================
# 5) FinalizarLlamadaRetell -> limpiar restos de Club Pilates + arreglos
# =========================================================================
BORRAR_CLUBPILATES = {"Filter", "Message a model1", "Send a message2", "Search files and folders"}
# Los correos de cada llamada (a Paco y, por el Switch1, a la asesora) se quitan:
# el aviso sale por WhatsApp a la asesora y a Paco desde "[TEL] Llamada al panel".
# La grabacion se sigue subiendo a Drive igual.
BORRAR_CORREOS_LLAMADA = {"Send a message", "Switch1", "Send a message1", "Send a message3", "Send a message4"}


def wf_finalizar(orig):
    borrar = BORRAR_CLUBPILATES | BORRAR_CORREOS_LLAMADA
    nodes = [n for n in orig["nodes"] if n["name"] not in borrar]
    for n in nodes:
        if n["name"] == "Upload file":
            n["parameters"]["name"] = ("=Llamada - {{ $now.setZone('Europe/Madrid').format('dd-MM-yyyy HH-mm') }}"
                                       " - {{ $('Webhook').item.json.body.call.from_number }}")
    conns = {s: v for s, v in orig["connections"].items() if s not in borrar}
    for v in conns.values():
        v["main"] = [[c for c in (out or []) if c["node"] not in borrar] for out in v.get("main", [])]
    conns = {s: v for s, v in conns.items() if any(v["main"])}
    s = {k: v for k, v in (orig.get("settings") or {}).items() if k in SETTINGS_OK}
    s["timezone"] = "Europe/Madrid"
    w = {"name": orig["name"], "settings": s, "nodes": nodes, "connections": conns}
    # Cada llamada tambien al panel de conversaciones (Chatwoot): un nodo que le
    # pasa la llamada a "[TEL] Llamada al panel" sin esperar. Se monta en
    # build_whatsapp.py; aqui solo se conserva para no perderlo al redesplegar.
    ids_wa = BASE / "wa" / "ids.json"
    sub = json.loads(ids_wa.read_text(encoding="utf-8")).get("[TEL] Llamada al panel") if ids_wa.exists() else None
    if sub:
        from build_whatsapp import enganchar
        enganchar(w, sub)
    return w


# =========================================================================
# 6) buscarInmuebles -> modalidad del alquiler y presupuesto no excluyente
# =========================================================================
CRED_PG = {"postgres": {"id": "yvym0TdlOebNMzsm", "name": "Postgres account"}}


def wf_buscar_inmuebles(orig):
    """Antes: Filter (habitaciones, municipio, precio minimo, operacion) + Code.
    Ahora un solo Code (nodes/bi_filtrar.js) que ademas:
      - distingue alquiler de larga duracion y temporal (eGO, por wa_cartera);
      - trata el presupuesto (precio_max) como orientativo, no excluyente;
      - responde aunque no haya resultados (antes Retell recibia una respuesta vacia)."""
    viejos = {"Webhook", "Respond to Webhook", "BuscarInmuebles"}
    nodes = [json.loads(json.dumps(n)) for n in orig["nodes"] if n["name"] in viejos]
    for n in nodes:
        if n["name"] == "BuscarInmuebles":
            n["alwaysOutputData"] = True
            n["position"] = [224, 64]
        if n["name"] == "Respond to Webhook":
            n["position"] = [976, 64]
    nodes.append(node("ModalidadCartera", "n8n-nodes-base.postgres", {
        "operation": "executeQuery",
        "query": "select ref, modalidad from wa_cartera where modalidad <> ''",
        "options": {}}, [448, 64], 2.6, credentials=CRED_PG,
        alwaysOutputData=True, executeOnce=True, onError="continueRegularOutput"))
    nodes.append(code_node("FiltrarYFormatear", "bi_filtrar.js", [704, 64]))
    nodes.append(node("NotaModalidad", "n8n-nodes-base.stickyNote", {"content":
        "## Alquiler y presupuesto\n*Larga duracion* (todo el ano) o *temporal* (por meses de "
        "invierno): lo dice eGO; [WA] 4 lo guarda cada hora en wa_cartera.modalidad. Si la "
        "base de datos falla, se deduce de la descripcion.\n\n*precio_max* es el presupuesto "
        "del cliente: se ensena tambien lo que se pasa hasta un 30 % (y, si hay menos de 3, "
        "hasta el doble), marcado POR ENCIMA DE SU PRESUPUESTO.",
        "height": 260, "width": 460}, [448, -260], 1))
    s = {k: v for k, v in (orig.get("settings") or {}).items() if k in SETTINGS_OK}
    s["timezone"] = "Europe/Madrid"
    s["executionOrder"] = "v1"
    return {"name": orig["name"], "settings": s, "nodes": nodes,
            "connections": conn(
                ("Webhook", 0, "BuscarInmuebles", 0),
                ("BuscarInmuebles", 0, "ModalidadCartera", 0),
                ("ModalidadCartera", 0, "FiltrarYFormatear", 0),
                ("FiltrarYFormatear", 0, "Respond to Webhook", 0))}


# =========================================================================
# 7) XMLCacheo -> no vaciar la hoja antes de tener el feed en la mano
# =========================================================================
def wf_xmlcacheo(orig):
    """Vaciaba la hoja ANTES de descargar el feed, asi que durante los ~8s que
    dura el refresco las tres busquedas devolvian 'no encontrado'; y si el feed
    fallaba, la cartera se quedaba vacia hasta la hora siguiente.

    Ahora: descargar -> comprobar -> vaciar -> escribir."""
    nodes = json.loads(json.dumps(orig["nodes"]))
    for n in nodes:
        # el Code ya no cuelga del XML directamente: lee el nodo por su nombre
        if n["name"] == "FiltraMapeoVariables":
            js = n["parameters"]["jsCode"]
            viejo = "const properties = $input.first().json.root.property;"
            assert viejo in js, "no encuentro la entrada de FiltraMapeoVariables"
            n["parameters"]["jsCode"] = js.replace(
                viejo, "const properties = $('XML5').first().json.root.property;", 1)

    nodes.append(node("ComprobarFeed", "n8n-nodes-base.code", {"jsCode": (
        "// Guardafuegos: si el feed viene vacio o a medias, se aborta ANTES de\n"
        "// vaciar la hoja, para no dejar a Sara sin cartera que ofrecer.\n"
        "const props = $('XML5').first().json?.root?.property;\n"
        "const lista = Array.isArray(props) ? props : (props ? [props] : []);\n"
        "if (lista.length < 5) {\n"
        "  throw new Error(`El feed ha devuelto ${lista.length} inmuebles. No se vacia la hoja.`);\n"
        "}\n"
        "return [{ json: { total: lista.length } }];"
    )}, [400, 200], 2))

    nodes.append(node("NotaCacheo", "n8n-nodes-base.stickyNote", {"content":
        "## Orden importante\nDescargar -> comprobar -> vaciar -> escribir.\n\n"
        "Si se vacia la hoja antes de tener el feed, durante el refresco (y una hora "
        "entera si el feed falla) las busquedas de inmuebles no devuelven nada.",
        "height": 190, "width": 420}, [400, 380], 1))

    conns = conn(
        ("Schedule Trigger", 0, "RecogerInmuebles", 0),
        ("RecogerInmuebles", 0, "XML5", 0),
        ("XML5", 0, "ComprobarFeed", 0),
        ("ComprobarFeed", 0, "Clear sheet", 0),
        ("Clear sheet", 0, "FiltraMapeoVariables", 0),
        ("FiltraMapeoVariables", 0, "EscribirInmuebles", 0))

    s = {k: v for k, v in (orig.get("settings") or {}).items() if k in SETTINGS_OK}
    s["timezone"] = "Europe/Madrid"
    w = {"name": orig["name"], "settings": s, "nodes": nodes, "connections": conns}
    return w


# =========================================================================
# 8) registrarMensaje -> un solo correo, con la cualificacion de alquiler
# =========================================================================
AVISO_RM = "$('ComponerAviso').first().json.aviso"


def wf_registrar_mensaje(orig):
    """Antes: Switch de 3 salidas + 3 nodos de Gmail. Si el destinatario no
    casaba con ninguna rama, nadie respondia y Sara se quedaba esperando.
    Ahora el destinatario se normaliza en el Code y sale un unico aviso, por
    WhatsApp ([WA][SUB] AvisoEquipo). Solo se le dice a Sara que se ha enviado si
    Meta lo ha aceptado."""
    wh = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.webhook")
    return {
        "name": "registrarMensaje",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "registrarmensaje", [-40, 0], wh.get("webhookId"), wh.get("id")),
            code_node("ComponerAviso", "rm_componer.js", [200, 0]),
            aviso_whatsapp("EnviarAviso", {k: "={{ %s.%s }}" % (AVISO_RM, k) for k in AVISO_CAMPOS}, [440, 0]),
            node("¿Aviso enviado?", "n8n-nodes-base.if", {"conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                "conditions": [{"id": "aviso-ok", "leftValue": "={{ $json.mensaje_registrado }}", "rightValue": "",
                                "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                "combinator": "and"}, "looseTypeValidation": True, "options": {}}, [560, 0], 2.2),
            node("RespuestaOK", "n8n-nodes-base.set", {"assignments": {"assignments": [
                {"id": "ok", "name": "respuesta", "type": "object",
                 "value": "={{ $('ComponerAviso').first().json.respuesta }}"}]}, "options": {}},
                 [680, -80], 3.4),
            respond("RespondOK", [900, -80]),
            node("RespuestaError", "n8n-nodes-base.set", {"assignments": {"assignments": [
                {"id": "err", "name": "respuesta", "type": "object",
                 "value": "={{ { mensaje_registrado: false, motivo: 'error_envio', "
                          "mensaje_para_sara: 'No he podido enviar el aviso por un problema tecnico. "
                          "NO le digas al cliente que se ha enviado: explicale que ha habido una "
                          "incidencia y recomiendale llamar a la oficina.' } }}"}]}, "options": {}},
                 [680, 120], 3.4),
            respond("RespondError", [900, 120]),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## Avisos a las asesoras\nPor WhatsApp (a la asesora y a Paco), con el destinatario "
                 "normalizado (si no cuadra, va a Laurence).\n\nLos leads de ALQUILER llegan marcados en el "
                 "asunto y con la cualificacion del cliente: personas, ingresos, mascotas, fecha "
                 "de entrada y duracion.",
                 "height": 210, "width": 430}, [200, -240], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "ComponerAviso", 0),
            ("ComponerAviso", 0, "RespuestaOK" if SIN_EMAIL else "EnviarAviso", 0),
            *([] if SIN_EMAIL else [("EnviarAviso", 0, "¿Aviso enviado?", 0),
                                    ("¿Aviso enviado?", 0, "RespuestaOK", 0),
                                    ("¿Aviso enviado?", 1, "RespuestaError", 0)]),
            ("RespuestaOK", 0, "RespondOK", 0),
            ("RespuestaError", 0, "RespondError", 0)),
    }


# =========================================================================
# 9) buscarPorReferencia -> que devuelva tambien la direccion
# =========================================================================
def wf_buscar_referencia(orig):
    wh = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.webhook")
    sheets = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.googleSheets")
    sheets = json.loads(json.dumps(sheets))
    sheets["alwaysOutputData"] = True
    sheets["onError"] = "continueRegularOutput"
    return {
        "name": "buscarPorReferencia",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "buscardisponibilidadporreferencia", [-40, 0],
                    wh.get("webhookId"), wh.get("id")),
            sheets,
            node("LeerDirecciones", "n8n-nodes-base.googleSheets", {
                "documentId": {"__rl": True, "value": SHEET_ID, "mode": "id"},
                "sheetName": {"__rl": True, "value": "Direcciones", "mode": "name"},
                "options": {}}, [420, 0], 4.7, credentials=CRED_SHEETS,
                alwaysOutputData=True, executeOnce=True, onError="continueRegularOutput"),
            code_node("FormatearSalidaParaAgenteTelefónico", "ref_formatear.js", [640, 0]),
            node("Respond to Webhook", "n8n-nodes-base.respondToWebhook", {
                "respondWith": "text", "responseBody": "={{ $json.result }}",
                "options": {"responseCode": 200, "responseHeaders": {"entries": [
                    {"name": "Content-Type", "value": "text/plain; charset=utf-8"}]}},
            }, [860, 0], 1.5),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## Busqueda por referencia\nTolera guiones, mayusculas y que se pierdan letras por "
                 "telefono: casa por prefijo + numero.\n\nDevuelve tambien la direccion de la pestana "
                 "*Direcciones*, para que Sara pueda confirmarla cuando se la pidan.",
                 "height": 200, "width": 420}, [200, -240], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "BuscarInmueblesTodos", 0),
            ("BuscarInmueblesTodos", 0, "LeerDirecciones", 0),
            ("LeerDirecciones", 0, "FormatearSalidaParaAgenteTelefónico", 0),
            ("FormatearSalidaParaAgenteTelefónico", 0, "Respond to Webhook", 0)),
    }


# =========================================================================
# 10) SaludoInicial -> saludo corto, desvio bien leido y telefono del cliente
# =========================================================================
def wf_saludo(orig):
    """El Switch de 8 salidas se sustituye por un Code: tenia la rama de Carmen
    cableada al texto de Gisela y ninguna salida por defecto, asi que una llamada
    sin cabecera de desvio se quedaba sin respuesta."""
    wh = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.webhook")
    return {
        "name": "SaludoInicial",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "llamadasentrantes", [-40, 0], wh.get("webhookId"), wh.get("id")),
            code_node("ComponerSaludo", "sal_datos.js", [200, 0]),
            node("Respond to Webhook", "n8n-nodes-base.respondToWebhook", {
                "respondWith": "json",
                "responseBody": '={\n  "dynamic_variables": {\n'
                                '    "saludovariable": "{{ $json.saludo }}",\n'
                                '    "telefono_cliente": "{{ $json.telefono_cliente }}",\n'
                                '    "telefono_cliente_hablado": "{{ $json.telefono_cliente_hablado }}"\n'
                                '  }\n}',
                "options": {"responseCode": 200},
            }, [440, 0], 1.5),
            node("Nota", "n8n-nodes-base.stickyNote", {"content":
                 "## El saludo de cada numero\nLos textos estan en el nodo ComponerSaludo.\n\n"
                 "El Diversion trae la cadena de desvios: el numero de Twilio primero y el ORIGINAL "
                 "despues. Hay que quedarse con el ultimo; si no, todas las llamadas suenan a "
                 "'general' y el saludo de cada comercial no se usa nunca.\n\n"
                 "Aqui tambien se recoge el telefono del cliente, para que Sara lo confirme en vez "
                 "de pedirlo cifra a cifra.",
                 "height": 260, "width": 430}, [200, -300], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "ComponerSaludo", 0),
            ("ComponerSaludo", 0, "Respond to Webhook", 0)),
    }


# =========================================================================
def api(method, path, payload=None):
    key = os.environ["N8N_API_KEY"]
    req = urllib.request.Request(
        N8N + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"X-N8N-API-KEY": key, "Content-Type": "application/json", "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode() or "{}")


def main():
    deploy = "--deploy" in sys.argv
    src = BASE / "backup_20260921"
    load = lambda f: json.loads((src / f).read_text(encoding="utf-8"))

    built = {
        "BuscarDisponibilidadCalendario": ("fqBzHa2QUBIBTA7c", wf_disponibilidad(load("wf_fqBzHa2QUBIBTA7c.json"))),
        "ConfirmarCitaCalendario":        ("jVRsS8BRCGDdSg8N", wf_confirmar(load("wf_jVRsS8BRCGDdSg8N.json"))),
        "FinalizarLlamadaRetell":         ("lZB8brQbbybkDllL", wf_finalizar(load("wf_lZB8brQbbybkDllL.json"))),
        "BuscarPorDireccion":             ("ucw4dMYsUYEeEFVZ", wf_direccion()),
        "BuscarCitaPorTelefono":          ("G5tNbLJgATbL7Bsc", wf_cita_telefono()),
        "buscarInmuebles":                ("3hevfnxUkmxhl8qH", wf_buscar_inmuebles(load("wf_3hevfnxUkmxhl8qH.json"))),
        "XMLCacheo":                      ("MNuaSmtxlFmA3eTe", wf_xmlcacheo(load("wf_MNuaSmtxlFmA3eTe.json"))),
        "registrarMensaje":               ("uUzJlWHmCKm1xZGX", wf_registrar_mensaje(load("wf_uUzJlWHmCKm1xZGX.json"))),
        "buscarPorReferencia":            ("JeYBaWXMzYvLi1e3", wf_buscar_referencia(load("wf_JeYBaWXMzYvLi1e3.json"))),
        "SaludoInicial":                  ("cDQHP3chcEGPkTgX", wf_saludo(load("wf_cDQHP3chcEGPkTgX.json"))),
    }

    for name, (wid, wf) in built.items():
        if not wf["name"].startswith(PREFIJO):
            wf["name"] = PREFIJO + wf["name"]

    (BASE / "workflows").mkdir(exist_ok=True)
    for name, (wid, wf) in built.items():
        (BASE / "workflows" / f"{name}.json").write_text(
            json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  generado  {name:32} nodos={len(wf['nodes']):2}  id={wid or 'NUEVO'}")

    if not deploy:
        print("\n(sin --deploy: no se ha subido nada)")
        return

    print()
    solo = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--solo=")), None)
    for name, (wid, wf) in built.items():
        if solo and name not in solo:
            continue
        if wid:
            api("PUT", f"/api/v1/workflows/{wid}", wf)
            print(f"  ACTUALIZADO  {name}  ({wid})")
        else:
            r = api("POST", "/api/v1/workflows", wf)
            api("POST", f"/api/v1/workflows/{r['id']}/activate")
            print(f"  CREADO+ACTIVO  {name}  ({r['id']})")


if __name__ == "__main__":
    main()
