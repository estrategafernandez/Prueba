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
CRED_GMAIL = {"gmailOAuth2": {"id": "mKh6b4I1hwDsBwOd", "name": "Gmail account"}}
SHEET_ID = "1cB2UI-ScDI34QS57k-UD2ZE79P5XhpyPJu78A5zPs3Q"
# El API publico de n8n solo admite estas claves en settings.
SETTINGS = {"executionOrder": "v1", "timezone": "Europe/Madrid"}
SETTINGS_OK = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
               "saveDataSuccessExecution", "executionTimeout", "errorWorkflow",
               "timezone", "executionOrder"}

LIB = (BASE / "lib" / "casagencia_comun.js").read_text(encoding="utf-8")
# --sin-email: despliega ConfirmarCita saltandose el aviso (solo para pruebas)
SIN_EMAIL = "--sin-email" in sys.argv


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
    v = "$('ValidarAntesDeInsertar').item.json"
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
                "additionalFields": {"summary": "={{ $json.titulo }}",
                                     "description": "={{ $json.descripcion }}"},
            }, [1080, -120], 1.3, credentials=CRED_CAL, onError="continueErrorOutput"),
            node("AvisarAsesora", "n8n-nodes-base.gmail", {
                "sendTo": "={{ %s.asesora === 'Carmen' ? 'carmen@casagencia.com, paco@casagencia.com' "
                          ": 'gisela@casagencia.com, paco@casagencia.com' }}" % v,
                "subject": "={{ 'CITA PRE-RESERVADA: FALTA CONFIRMAR: Referencia: ' + %s.referencia "
                           "+ ' - Telefono: ' + %s.telefono_e164 + ' - Nombre: ' + %s.nombre }}" % (v, v, v),
                "message": "={{ 'Visita pre-reservada el ' + %s.dia_texto + ' a las ' + %s.hora "
                           "+ '.\\n\\nInmueble: ' + %s.referencia + '\\nOperacion: ' + %s.tipo_transaccion "
                           "+ '\\nCliente: ' + %s.nombre + '\\nTelefono: ' + %s.telefono_e164 "
                           "+ '\\n\\nCreada por Sara (IA). Falta confirmarla con el cliente.' }}"
                           % (v, v, v, v, v, v),
                "options": {"appendAttribution": False},
            }, [1320, -200], 2.2, credentials=CRED_GMAIL, onError="continueRegularOutput"),
            node("RespuestaOK", "n8n-nodes-base.set", {"assignments": {"assignments": [
                {"id": "ok", "name": "respuesta", "type": "object",
                 "value": "={{ { cita_confirmada: true, motivo: 'ok', asesora: %s.asesora, "
                          "fecha: %s.fecha, hora: %s.hora, referencia: %s.referencia, "
                          "telefono: %s.telefono_e164, "
                          "evento_id: $('InsertarEnAgenda').item.json.id, "
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
                 "El aviso por email SOLO sale si la cita se ha creado de verdad.",
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


def wf_finalizar(orig):
    nodes = [n for n in orig["nodes"] if n["name"] not in BORRAR_CLUBPILATES]
    for n in nodes:
        if n["name"] == "Upload file":
            n["parameters"]["name"] = ("=Llamada - {{ $now.setZone('Europe/Madrid').format('dd-MM-yyyy HH-mm') }}"
                                       " - {{ $('Webhook').item.json.body.call.from_number }}")
        if n["name"] == "Switch1":
            for rule in n["parameters"]["rules"]["values"]:
                for c in rule["conditions"]["conditions"]:
                    c["leftValue"] = ("={{ $('Webhook').item.json.body.call.call_analysis"
                                      "?.custom_analysis_data?.asesora || '' }}")
    conns = {s: v for s, v in orig["connections"].items() if s not in BORRAR_CLUBPILATES}
    for v in conns.values():
        v["main"] = [[c for c in (out or []) if c["node"] not in BORRAR_CLUBPILATES] for out in v.get("main", [])]
    s = {k: v for k, v in (orig.get("settings") or {}).items() if k in SETTINGS_OK}
    s["timezone"] = "Europe/Madrid"
    return {"name": orig["name"], "settings": s, "nodes": nodes, "connections": conns}


# =========================================================================
# 6) buscarInmuebles -> arreglar la respuesta vacia cuando no hay resultados
# =========================================================================
def wf_buscar_inmuebles(orig):
    """El nodo Filter no sacaba items cuando no habia resultados, asi que n8n no
    ejecutaba ni el Code ni el Respond y Retell recibia una respuesta VACIA."""
    nodes = json.loads(json.dumps(orig["nodes"]))
    for n in nodes:
        if n["name"] == "FiltrarHabitacionesMunicipio":
            n["alwaysOutputData"] = True
        if n["name"] == "FormatearSalidaParaAgenteTelefónico":
            js = n["parameters"]["jsCode"]
            viejo = "const items = $input.all();"
            assert viejo in js, "no encuentro la linea de entrada en buscarInmuebles"
            js = js.replace(viejo,
                "// alwaysOutputData en el Filter hace que n8n mande un item vacio cuando no\n"
                "// hay resultados. Sin ese item, este nodo y el Respond no llegaban a\n"
                "// ejecutarse y Retell recibia una respuesta vacia.\n"
                "const items = $input.all().filter(i => i.json && i.json.ref);", 1)
            n["parameters"]["jsCode"] = js
    s = {k: v for k, v in (orig.get("settings") or {}).items() if k in SETTINGS_OK}
    s["timezone"] = "Europe/Madrid"
    return {"name": orig["name"], "settings": s, "nodes": nodes,
            "connections": orig["connections"]}


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
    return {"name": orig["name"], "settings": s, "nodes": nodes, "connections": conns}


# =========================================================================
# 8) registrarMensaje -> un solo correo, con la cualificacion de alquiler
# =========================================================================
def wf_registrar_mensaje(orig):
    """Antes: Switch de 3 salidas + 3 nodos de Gmail. Si el destinatario no
    casaba con ninguna rama, nadie respondia y Sara se quedaba esperando.
    Ahora el destinatario se normaliza en el Code y sale un unico correo."""
    wh = next(n for n in orig["nodes"] if n["type"] == "n8n-nodes-base.webhook")
    return {
        "name": "registrarMensaje",
        "settings": SETTINGS,
        "nodes": [
            webhook("Webhook", "registrarmensaje", [-40, 0], wh.get("webhookId"), wh.get("id")),
            code_node("ComponerAviso", "rm_componer.js", [200, 0]),
            node("EnviarAviso", "n8n-nodes-base.gmail", {
                "sendTo": "={{ $json.para }}",
                "subject": "={{ $json.asunto }}",
                "message": "={{ $json.cuerpo }}",
                "options": {"appendAttribution": False},
            }, [440, 0], 2.2, credentials=CRED_GMAIL, onError="continueErrorOutput"),
            node("RespuestaOK", "n8n-nodes-base.set", {"assignments": {"assignments": [
                {"id": "ok", "name": "respuesta", "type": "object",
                 "value": "={{ $('ComponerAviso').item.json.respuesta }}"}]}, "options": {}},
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
                 "## Avisos a las asesoras\nUn solo correo, con el destinatario normalizado "
                 "(si no cuadra, va a Laurence).\n\nLos leads de ALQUILER llegan marcados en el "
                 "asunto y con la cualificacion del cliente: personas, ingresos, mascotas, fecha "
                 "de entrada y duracion.",
                 "height": 210, "width": 430}, [200, -240], 1),
        ],
        "connections": conn(
            ("Webhook", 0, "ComponerAviso", 0),
            ("ComponerAviso", 0, "RespuestaOK" if SIN_EMAIL else "EnviarAviso", 0),
            *([] if SIN_EMAIL else [("EnviarAviso", 0, "RespuestaOK", 0),
                                    ("EnviarAviso", 1, "RespuestaError", 0)]),
            ("RespuestaOK", 0, "RespondOK", 0),
            ("RespuestaError", 0, "RespondError", 0)),
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
    }

    (BASE / "workflows").mkdir(exist_ok=True)
    for name, (wid, wf) in built.items():
        (BASE / "workflows" / f"{name}.json").write_text(
            json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  generado  {name:32} nodos={len(wf['nodes']):2}  id={wid or 'NUEVO'}")

    if not deploy:
        print("\n(sin --deploy: no se ha subido nada)")
        return

    print()
    for name, (wid, wf) in built.items():
        if wid:
            api("PUT", f"/api/v1/workflows/{wid}", wf)
            print(f"  ACTUALIZADO  {name}  ({wid})")
        else:
            r = api("POST", "/api/v1/workflows", wf)
            api("POST", f"/api/v1/workflows/{r['id']}/activate")
            print(f"  CREADO+ACTIVO  {name}  ({r['id']})")


if __name__ == "__main__":
    main()
