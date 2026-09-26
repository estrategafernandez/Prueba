#!/usr/bin/env python3
"""Construye y despliega el asistente de WhatsApp de Casagencia.

  python3 build_whatsapp.py            -> genera los JSON en workflows_wa/
  python3 build_whatsapp.py --deploy   -> ademas los crea/actualiza en n8n

Se basa en el escenario principal de Blue Inmobiliaria (Chatwoot + Meta +
Postgres para la memoria + Redis para juntar mensajes), pero reutiliza las
herramientas que ya tiene el asistente telefonico de Casagencia: cartera,
calendario, horarios, festivos y la regla de "en alquiler no se agenda".

TODO se crea DESACTIVADO. No se dispara nada hasta que alguien lo active a
mano, despues de rellenar Chatwoot, Meta y el buzon de correo en wa/config.js.

La API key de Casagencia se lee de la variable de entorno N8N_API_KEY.
"""
import json, os, re, sys, uuid, pathlib, urllib.request, urllib.error

BASE = pathlib.Path(__file__).parent
WA = BASE / "wa"
SALIDA = BASE / "workflows_wa"
IDS_FILE = WA / "ids.json"
N8N = "https://n8n-casagencia.serversvisionarius.com"

SETTINGS = {"executionOrder": "v1", "timezone": "Europe/Madrid"}

# --- Credenciales de Casagencia --------------------------------------------
CRED_PG      = {"postgres": {"id": "yvym0TdlOebNMzsm", "name": "Postgres Casagencia"}}
CRED_REDIS   = {"redis": {"id": "hddla0B9Wo7BsMpy", "name": "Redis Casagencia"}}
CRED_GMAIL   = {"gmailOAuth2": {"id": "mKh6b4I1hwDsBwOd", "name": "Gmail account"}}
CRED_CHATWOOT = {"httpHeaderAuth": {"id": "Wm0tmDE3FjfTx1Tu", "name": "Chatwoot Casagencia"}}
CRED_META     = {"httpHeaderAuth": {"id": "P4xswu9i9E4RILJN", "name": "Meta WhatsApp Casagencia"}}
# La credencial de OpenAI se elige a mano en n8n: ver la nota del workflow.
CRED_OPENAI = None

MODELO = "gpt-5.1"

CONFIG = (WA / "config.js").read_text(encoding="utf-8")
PROMPT = (WA / "prompt_asistente.md").read_text(encoding="utf-8")


def const(nombre, por_defecto=""):
    """Lee una constante de wa/config.js para no repetirla aqui."""
    m = re.search(r"^const\s+%s\s*=\s*(.+?);\s*(?://.*)?$" % nombre, CONFIG, re.M)
    if not m:
        return por_defecto
    v = m.group(1).strip().rstrip(";").strip()
    if v.startswith(("'", '"')):
        return v[1:-1]
    return v


CW_URL     = const("CHATWOOT_URL")
CW_CUENTA  = const("CHATWOOT_CUENTA", "1")
CW_INBOX   = const("CHATWOOT_INBOX", "0")
WABA_ID    = const("META_WABA_ID")
PLANTILLA  = const("PLANTILLA_LEAD")
IDIOMA     = const("PLANTILLA_IDIOMA", "es")
BUZON      = const("BUZON_LEADS")
ESPERA     = int(const("BUFFER_SEGUNDOS", "60"))
CW_API     = "%s/api/v1/accounts/%s" % (CW_URL, CW_CUENTA)


def code(fname, extra=""):
    """Nodo Code = config comun + el cuerpo concreto."""
    return CONFIG + "\n\n" + (WA / fname).read_text(encoding="utf-8") + extra


# ---------------------------------------------------------------------------
# Ayudas para montar nodos
# ---------------------------------------------------------------------------
def node(name, ntype, params, pos, tv, **extra):
    n = {"parameters": params, "type": ntype, "typeVersion": tv, "position": pos,
         "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/" + name)), "name": name}
    n.update(extra)
    return n


def code_node(name, fname, pos, **extra):
    return node(name, "n8n-nodes-base.code", {"jsCode": code(fname)}, pos, 2, **extra)


def js_node(name, cuerpo, pos, **extra):
    return node(name, "n8n-nodes-base.code", {"jsCode": CONFIG + "\n\n" + cuerpo}, pos, 2, **extra)


def set_node(name, campos, pos):
    asigna = []
    for k, (tipo, valor) in campos.items():
        asigna.append({"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name + k)),
                       "name": k, "type": tipo, "value": valor})
    return node(name, "n8n-nodes-base.set",
                {"assignments": {"assignments": asigna}, "options": {}}, pos, 3.4)


def if_node(name, izq, op, pos, der=None, tipo="boolean"):
    cond = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "if" + name)),
            "leftValue": izq, "rightValue": der if der is not None else "",
            "operator": {"type": tipo, "operation": op}}
    if der is None:
        cond["operator"]["singleValue"] = True
    return node(name, "n8n-nodes-base.if", {"conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
        "conditions": [cond], "combinator": "and"}, "options": {}}, pos, 2.2)


def nota(name, texto, pos, w=430, h=200):
    return node(name, "n8n-nodes-base.stickyNote",
                {"content": texto, "height": h, "width": w}, pos, 1)


def http(name, metodo, url, pos, cred=None, body=None, query=None, **extra):
    p = {"method": metodo, "url": url, "options": {}}
    if metodo == "GET":
        p.pop("method")
    if cred:
        p["authentication"] = "predefinedCredentialType"
        p["nodeCredentialType"] = "httpHeaderAuth"
    p["sendHeaders"] = True
    p["headerParameters"] = {"parameters": [{"name": "Content-Type", "value": "application/json"}]}
    if body is not None:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = body
    if query:
        p["sendQuery"] = True
        p["queryParameters"] = {"parameters": [{"name": k, "value": v} for k, v in query.items()]}
    if "options" in extra:
        p["options"] = extra.pop("options")
    kw = {"credentials": cred} if cred else {}
    kw.update(extra)
    return node(name, "n8n-nodes-base.httpRequest", p, pos, 4.2, **kw)


def pg_query(name, sql, valores, pos, **extra):
    p = {"operation": "executeQuery", "query": sql, "options": {}}
    if valores:
        p["options"]["queryReplacement"] = valores
    return node(name, "n8n-nodes-base.postgres", p, pos, 2.6,
                credentials=CRED_PG, **extra)


def trigger_sub(name, entradas, pos=(-40, 0)):
    return node(name, "n8n-nodes-base.executeWorkflowTrigger",
                {"workflowInputs": {"values": [{"name": k, "type": t} if t != "string"
                                               else {"name": k} for k, t in entradas]}},
                list(pos), 1.1)


def conn(*pares):
    out = {}
    for src, oidx, dst, didx in pares:
        m = out.setdefault(src, {"main": []})["main"]
        while len(m) <= oidx:
            m.append([])
        m[oidx].append({"node": dst, "type": "main", "index": didx})
    return out


def ai_conn(destino, pares):
    """pares = [(nombre_nodo, tipo_ai)] -> conexiones hacia el agente."""
    out = {}
    for nombre, tipo in pares:
        out[nombre] = {tipo: [[{"node": destino, "type": tipo, "index": 0}]]}
    return out


def fusionar(*dicts):
    out = {}
    for d in dicts:
        for k, v in d.items():
            if k not in out:
                out[k] = v
            else:
                for tipo, listas in v.items():
                    destino = out[k].setdefault(tipo, [])
                    while len(destino) < len(listas):
                        destino.append([])
                    for i, l in enumerate(listas):
                        destino[i].extend(l)
    return out


# ===========================================================================
# SQL
# ===========================================================================
DDL = """-- Memoria del agente (la usa el nodo Postgres Chat Memory)
create table if not exists n8n_chat_histories (
  id         serial primary key,
  session_id varchar(255) not null,
  message    jsonb        not null,
  created_at timestamptz  not null default now()
);
create index if not exists n8n_chat_histories_sesion on n8n_chat_histories (session_id, id);

-- Ficha de cada lead que entra por correo desde un portal
create table if not exists wa_leads (
  id              serial primary key,
  telefono_wa     text not null,
  telefono_e164   text not null default '',
  referencia      text not null default '',
  nombre          text not null default '',
  email_cliente   text not null default '',
  portal          text not null default '',
  operacion       text not null default '',
  es_alquiler     boolean not null default false,
  asesora         text not null default '',
  estado          text not null default 'nuevo',
  conversacion_id bigint,
  asunto          text not null default '',
  q_personas      text not null default '',
  q_ingresos      text not null default '',
  q_mascotas      text not null default '',
  q_entrada       text not null default '',
  q_duracion      text not null default '',
  q_cuando        text not null default '',
  q_zona          text not null default '',
  q_presupuesto   text not null default '',
  q_financiacion  text not null default '',
  notas           text not null default '',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
-- Un lead por telefono e inmueble: asi el mismo cliente puede preguntar por
-- dos inmuebles distintos, pero no se le escribe dos veces por el mismo.
create unique index if not exists wa_leads_unico on wa_leads (telefono_wa, referencia);
"""

# Devuelve fila SOLO si el lead es nuevo o si el ultimo contacto es de hace mas
# de 30 dias. Si no devuelve nada, ya se le escribio: no se le vuelve a escribir.
SQL_ALTA_LEAD = """insert into wa_leads
  (telefono_wa, telefono_e164, referencia, nombre, email_cliente, portal,
   operacion, es_alquiler, asesora, asunto, estado)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'nuevo')
on conflict (telefono_wa, referencia) do update
   set nombre        = case when wa_leads.nombre = '' then excluded.nombre else wa_leads.nombre end,
       portal        = excluded.portal,
       asunto        = excluded.asunto,
       estado        = 'nuevo',
       actualizado_en = now()
 where wa_leads.actualizado_en < now() - interval '30 days'
returning id, telefono_wa, referencia;"""

SQL_PLANTILLA_ENVIADA = """update wa_leads
   set estado = 'plantilla_enviada', conversacion_id = $2, actualizado_en = now()
 where telefono_wa = $1 and referencia = $3;"""

SQL_FICHA = """select * from wa_leads
 where telefono_wa = $1
 order by actualizado_en desc
 limit 1;"""

_Q = ["q_personas", "q_ingresos", "q_mascotas", "q_entrada", "q_duracion",
      "q_cuando", "q_zona", "q_presupuesto", "q_financiacion"]
SQL_CUALIFICAR = """insert into wa_leads
  (telefono_wa, telefono_e164, referencia, nombre, operacion, es_alquiler,
   asesora, estado, %s)
values ($1,$2,$3,$4,$5,$6,$7,$8,%s)
on conflict (telefono_wa, referencia) do update set
  nombre      = case when excluded.nombre  <> '' then excluded.nombre  else wa_leads.nombre  end,
  asesora     = case when excluded.asesora <> '' then excluded.asesora else wa_leads.asesora end,
  operacion   = excluded.operacion,
  es_alquiler = excluded.es_alquiler,
  estado      = excluded.estado,
  %s,
  actualizado_en = now()
returning id;""" % (
    ", ".join(_Q),
    ",".join("$%d" % (9 + i) for i in range(len(_Q))),
    ",\n  ".join("%s = case when excluded.%s <> '' then excluded.%s else wa_leads.%s end"
                 % (q, q, q, q) for q in _Q))

SQL_CITA = """update wa_leads
   set estado = 'cita_agendada', actualizado_en = now()
 where telefono_wa = $1;"""


# ===========================================================================
# SUB-WORKFLOWS: las herramientas del agente
# ---------------------------------------------------------------------------
# Todas siguen el mismo patron: entran los datos que da el modelo, se llama al
# webhook que YA existe del asistente telefonico y se le devuelve al modelo el
# 'mensaje_para_sara' en texto plano.
# ===========================================================================
TOOLS_URL = {
    "buscarInmuebles":     "%s/webhook/buscarinmuebles" % N8N,
    "buscarPorReferencia": "%s/webhook/buscardisponibilidadporreferencia" % N8N,
    "buscarPorDireccion":  "%s/webhook/buscarpordireccion" % N8N,
    "disponibilidad":      "%s/webhook/buscardisponibilidad" % N8N,
    "confirmarCita":       "%s/webhook/confirmarcitacalendario" % N8N,
    "citaPorTelefono":     "%s/webhook/buscarcitaportelefono" % N8N,
    "registrarMensaje":    "%s/webhook/registrarmensaje" % N8N,
}


def wf_puente(nombre, entradas, url, cuerpo, aviso, guardia=False, tras_ok=None):
    """Sub-workflow puente: Start -> [guardia] -> HTTP -> respuesta para el modelo."""
    nodos = [trigger_sub("Start", entradas),
             nota("Nota", aviso, [-40, -230], 460, 190)]
    conexiones = []
    origen = "Start"

    if guardia:
        nodos.append(code_node("GuardiaDeAlquiler", "guardia_alquiler.js", [180, 0]))
        nodos.append(if_node("¿Se puede agendar?", "={{ $json.seguir }}", "true", [400, 0]))
        nodos.append(set_node("Bloqueado", {"respuesta": ("string", "={{ $json.respuesta }}")},
                              [620, 160]))
        conexiones += [("Start", 0, "GuardiaDeAlquiler", 0),
                       ("GuardiaDeAlquiler", 0, "¿Se puede agendar?", 0),
                       ("¿Se puede agendar?", 1, "Bloqueado", 0)]
        origen, salida = "¿Se puede agendar?", 0
    else:
        salida = 0

    nodos.append(http("Llamar", "POST", url, [620, -40], body=cuerpo,
                      onError="continueRegularOutput", retryOnFail=True, waitBetweenTries=2000))
    nodos.append(code_node("RespuestaParaElAgente", "herramienta_respuesta.js", [840, -40]))
    conexiones += [(origen, salida, "Llamar", 0), ("Llamar", 0, "RespuestaParaElAgente", 0)]

    if tras_ok:
        nodos.append(tras_ok)
        conexiones.append(("RespuestaParaElAgente", 0, tras_ok["name"], 0))

    return {"name": nombre, "settings": SETTINGS,
            "nodes": nodos, "connections": conn(*conexiones)}


def cuerpo_json(campos):
    """'={{ JSON.stringify({ a: $json.a }) }}' a partir de un dict nombre->expresion."""
    partes = ", ".join("%s: %s" % (k, v) for k, v in campos.items())
    return "={{ JSON.stringify({ %s }) }}" % partes


AVISO_PUENTE = (
    "## Puente a la herramienta del telefono\n"
    "Este sub-workflow NO tiene logica propia: llama al mismo webhook que usa Sara por telefono, "
    "asi que los horarios, los festivos, la cartera y la regla de 'en alquiler no se agenda' son "
    "exactamente los mismos en los dos canales. Si hay que cambiar una regla, se cambia en "
    "n8n/casagencia/lib/casagencia_comun.js, no aqui.")


def subs_puente():
    """Los sub-workflows que son solo un puente al webhook que ya existe."""
    out = {}

    out["[WA][SUB] BuscarPorReferencia"] = wf_puente(
        "[WA][SUB] BuscarPorReferencia",
        [("referencia", "string")],
        TOOLS_URL["buscarPorReferencia"],
        cuerpo_json({"referencia": "$json.referencia"}),
        AVISO_PUENTE)

    out["[WA][SUB] BuscarPorDireccion"] = wf_puente(
        "[WA][SUB] BuscarPorDireccion",
        [("direccion", "string"), ("municipio", "string"), ("operacion", "string")],
        TOOLS_URL["buscarPorDireccion"],
        cuerpo_json({"direccion": "$json.direccion",
                     "municipio": "$json.municipio || ''",
                     "operacion": "$json.operacion || ''"}),
        AVISO_PUENTE)

    out["[WA][SUB] BuscarInmuebles"] = wf_puente(
        "[WA][SUB] BuscarInmuebles",
        [("municipio", "string"), ("operacion", "string"),
         ("habitaciones", "number"), ("precio_min", "number")],
        TOOLS_URL["buscarInmuebles"],
        cuerpo_json({"municipio": "$json.municipio",
                     "operacion": "$json.operacion",
                     "habitaciones": "Number($json.habitaciones || 0)",
                     "precio_min": "Number($json.precio_min || 0)"}),
        AVISO_PUENTE)

    agenda = [("nombre", "string"), ("telefono", "string"), ("referencia", "string"),
              ("tipo_transaccion", "string"), ("fecha", "string"), ("hora", "string")]
    cuerpo_agenda = cuerpo_json({
        "nombre": "$json.nombre || ''",
        "telefono": "$json.telefono",
        "referencia": "$json.referencia",
        "tipo_transaccion": "$json.tipo_transaccion || 'compra'",
        "fecha": "$json.fecha",
        "hora": "$json.hora || '11:00'"})

    out["[WA][SUB] ConsultarHuecos"] = wf_puente(
        "[WA][SUB] ConsultarHuecos", agenda, TOOLS_URL["disponibilidad"], cuerpo_agenda,
        AVISO_PUENTE + "\n\nSOLO CONSULTA: no reserva nada.", guardia=True)

    out["[WA][SUB] ConfirmarVisita"] = wf_puente(
        "[WA][SUB] ConfirmarVisita", agenda, TOOLS_URL["confirmarCita"], cuerpo_agenda,
        AVISO_PUENTE + "\n\nAqui SI se escribe en la agenda de la asesora.", guardia=True,
        tras_ok=pg_query("MarcarCitaEnLaFicha", SQL_CITA,
                         "={{ [ $('GuardiaDeAlquiler').first().json.telefono"
                         ".replace(/\\D/g,'') ] }}", [1060, -40],
                         onError="continueRegularOutput", alwaysOutputData=True))

    out["[WA][SUB] ConsultarCita"] = wf_puente(
        "[WA][SUB] ConsultarCita",
        [("telefono", "string")],
        TOOLS_URL["citaPorTelefono"],
        cuerpo_json({"telefono": "$json.telefono"}),
        AVISO_PUENTE)

    out["[WA][SUB] AvisarAsesora"] = wf_puente(
        "[WA][SUB] AvisarAsesora",
        [("telefono", "string"), ("nombre", "string"), ("destinatario", "string"),
         ("motivo", "string"), ("tipo_llamada", "string"),
         ("resumen_conversacion", "string"), ("urgencia", "string")],
        TOOLS_URL["registrarMensaje"],
        cuerpo_json({"telefono": "$json.telefono",
                     "nombre": "$json.nombre || ''",
                     "destinatario": "$json.destinatario || 'Laurence'",
                     "motivo": "$json.motivo",
                     "tipo_llamada": "$json.tipo_llamada || 'otro'",
                     "resumen_conversacion": "$json.resumen_conversacion",
                     "urgencia": "$json.urgencia || 'normal'",
                     "canal": "'whatsapp'"}),
        AVISO_PUENTE)

    return out


# ---------------------------------------------------------------------------
# [WA][SUB] Cualificar lead
# ---------------------------------------------------------------------------
def wf_cualificar():
    entradas = [("telefono", "string"), ("nombre", "string"), ("referencia", "string"),
                ("operacion", "string"), ("personas", "string"), ("ingresos", "string"),
                ("mascotas", "string"), ("entrada", "string"), ("duracion", "string"),
                ("cuando", "string"), ("zona", "string"), ("presupuesto", "string"),
                ("financiacion", "string"), ("resumen", "string")]
    valores = ("={{ [ $json.telefono_wa, $json.telefono_e164, $json.referencia, $json.nombre, "
               "$json.operacion, $json.es_alquiler, $json.asesora, $json.estado, "
               + ", ".join("$json.%s" % q for q in _Q) + " ] }}")
    return {
        "name": "[WA][SUB] CualificarLead",
        "settings": SETTINGS,
        "nodes": [
            trigger_sub("Start", entradas),
            code_node("Preparar", "cualificar_preparar.js", [180, 0]),
            pg_query("GuardarFicha", SQL_CUALIFICAR, valores, [400, 0],
                     onError="continueRegularOutput", alwaysOutputData=True),
            node("AvisarAsesora", "n8n-nodes-base.gmail", {
                "sendTo": "={{ $('Preparar').first().json.destinatarios }}",
                "subject": "={{ $('Preparar').first().json.email_asunto }}",
                "message": "={{ $('Preparar').first().json.email_cuerpo }}",
                "options": {"appendAttribution": False},
            }, [620, 0], 2.2, credentials=CRED_GMAIL, onError="continueRegularOutput"),
            set_node("Respuesta", {"respuesta": ("string",
                     "={{ $('Preparar').first().json.respuesta }}")}, [840, 0]),
            nota("Nota",
                 "## La regla de Paco\n"
                 "En ALQUILER no se agenda visita: se cualifica con las cuatro preguntas "
                 "(personas, ingresos demostrables, mascotas y cuando quiere entrar) y llama la "
                 "asesora. Esta herramienta guarda las respuestas en la ficha del lead y le manda "
                 "el aviso por correo a la asesora que le toca por la referencia.\n\n"
                 "Solo se sobreescriben los campos que traen dato: llamarla dos veces no borra "
                 "lo que ya se habia apuntado.", [180, -260], 470, 230),
        ],
        "connections": conn(
            ("Start", 0, "Preparar", 0),
            ("Preparar", 0, "GuardarFicha", 0),
            ("GuardarFicha", 0, "AvisarAsesora", 0),
            ("AvisarAsesora", 0, "Respuesta", 0)),
    }


# ---------------------------------------------------------------------------
# [WA][SUB] Etiquetar
# ---------------------------------------------------------------------------
def wf_etiquetar():
    url = CW_API + "/conversations/{{ $('Start').first().json.conversacion_id }}/labels"
    return {
        "name": "[WA][SUB] Etiquetar",
        "settings": SETTINGS,
        "nodes": [
            trigger_sub("Start", [("conversacion_id", "number"), ("etiqueta", "string")]),
            http("LeerEtiquetas", "GET", "=" + url, [180, 0], cred=CRED_CHATWOOT,
                 onError="continueRegularOutput", alwaysOutputData=True),
            code_node("UnirEtiquetas", "etiquetas_unir.js", [400, 0]),
            http("GuardarEtiquetas", "POST", "=" + url, [620, 0], cred=CRED_CHATWOOT,
                 body="={{ JSON.stringify({ labels: $json.labels }) }}",
                 onError="continueRegularOutput"),
            set_node("Respuesta", {"respuesta": ("string",
                     "={{ 'Etiqueta aplicada: ' + $('Start').first().json.etiqueta }}")}, [840, 0]),
            nota("Nota",
                 "## Etiquetas del panel\n"
                 "Chatwoot SUSTITUYE la lista de etiquetas en vez de ampliarla, por eso primero se "
                 "leen las que tiene la conversacion y se manda la union.\n\n"
                 "Las etiquetas de estado de la IA son excluyentes entre si; 'intervenir' apaga el "
                 "bot y lo coge una persona.", [180, -250], 450, 210),
        ],
        "connections": conn(
            ("Start", 0, "LeerEtiquetas", 0),
            ("LeerEtiquetas", 0, "UnirEtiquetas", 0),
            ("UnirEtiquetas", 0, "GuardarEtiquetas", 0),
            ("GuardarEtiquetas", 0, "Respuesta", 0)),
    }


# ---------------------------------------------------------------------------
# [WA][SUB] Enviar plantilla   (calcado del de Blue, con las credenciales
# de Casagencia y sin ningun token escrito en el workflow)
# ---------------------------------------------------------------------------
def wf_plantilla():
    contacto = "$('ElegirContacto').first().json.payload[0]"
    norm = "$('Normalizar').first().json"
    nuevo = "$('CrearContacto').first().json.payload.contact"
    return {
        "name": "[WA][SUB] EnviarPlantilla",
        "settings": SETTINGS,
        "nodes": [
            trigger_sub("Start", [("telefono", "string"), ("nombre", "string"),
                                  ("plantilla", "string"), ("idioma", "string"),
                                  ("param1", "string"), ("param2", "string"),
                                  ("referencia", "string"), ("operacion", "string"),
                                  ("portal", "string"), ("conversacion_id", "number")]),
            code_node("Normalizar", "plantilla_normalizar.js", [180, 0]),
            if_node("¿Telefono valido?", "={{ $json.telefono_valido }}", "true", [400, 0]),
            set_node("SinTelefono", {"resultado": ("string",
                     "Telefono no valido, no se envia nada")}, [620, 220]),
            if_node("¿Ya tengo conversacion?", "={{ $json.conversacion_id }}", "gt",
                    [620, -20], der=0, tipo="number"),
            set_node("UsarConversacionDada",
                     {"conversacion_id": ("number", "={{ $json.conversacion_id }}")}, [860, -180]),
            http("BuscarContacto", "GET",
                 "=" + CW_API + "/contacts/search?q=%2B{{ $json.wa_id }}", [860, 40],
                 cred=CRED_CHATWOOT),
            code_node("ElegirContacto", "plantilla_elegir_contacto.js", [1080, 40]),
            if_node("¿Existe el contacto?", "={{ $json.payload }}", "notEmpty", [1300, 40],
                    tipo="array"),
            http("ConversacionesDelContacto", "GET",
                 "=" + CW_API + "/contacts/{{ $json.payload[0].id }}/conversations",
                 [1520, -60], cred=CRED_CHATWOOT),
            if_node("¿Tiene conversacion?", "={{ $json.payload }}", "notEmpty", [1740, -60],
                    tipo="array"),
            code_node("ElegirConversacion", "plantilla_elegir_conversacion.js", [1960, -160]),
            http("CrearConversacion", "POST", "=" + CW_API + "/conversations", [1960, 40],
                 cred=CRED_CHATWOOT,
                 body="={{ JSON.stringify({ source_id: %s.phone_number.replace('+',''), "
                      "inbox_id: %s, contact_id: %s.id }) }}" % (contacto, CW_INBOX, contacto)),
            set_node("IdConversacionCreada",
                     {"conversacion_id": ("number", "={{ $json.id }}")}, [2180, 40]),
            http("CrearContacto", "POST", "=" + CW_API + "/contacts", [1520, 200],
                 cred=CRED_CHATWOOT,
                 body="={{ JSON.stringify({ name: %s.nombre || %s.telefono_e164, "
                      "phone_number: %s.telefono_e164, identifier: %s.wa_id, "
                      "inbox_id: %s, source_id: %s.wa_id, custom_attributes: { bot: 'On' } }) }}"
                      % (norm, norm, norm, norm, CW_INBOX, norm)),
            node("EsperaAltaContacto", "n8n-nodes-base.wait", {"amount": 3}, [1740, 200], 1.1,
                 webhookId=str(uuid.uuid4())),
            http("CrearConversacionContactoNuevo", "POST", "=" + CW_API + "/conversations",
                 [1960, 200], cred=CRED_CHATWOOT,
                 body="={{ JSON.stringify({ source_id: %s.contact_inboxes[0].source_id, "
                      "inbox_id: %s.contact_inboxes[0].inbox.id, contact_id: %s.id }) }}"
                      % (nuevo, nuevo, nuevo)),
            set_node("IdConversacionNueva",
                     {"conversacion_id": ("number", "={{ $json.id }}")}, [2180, 200]),
            set_node("ConversacionLista",
                     {"conversacion_id": ("number", "={{ $json.conversacion_id }}")}, [2400, 0]),
            http("PlantillaMeta", "GET",
                 "https://graph.facebook.com/v22.0/%s/message_templates" % WABA_ID,
                 [2620, 0], cred=CRED_META,
                 query={"name": "={{ %s.plantilla }}" % norm,
                        "language": "={{ %s.idioma }}" % norm},
                 onError="continueRegularOutput", alwaysOutputData=True),
            code_node("RenderizarTexto", "plantilla_renderizar.js", [2840, 0]),
            http("EnviarPlantilla", "POST",
                 "=" + CW_API + "/conversations/{{ $json.conversacion_id }}/messages",
                 [3060, 0], cred=CRED_CHATWOOT, body="={{ $json.body_mensaje }}",
                 retryOnFail=True, waitBetweenTries=3000),
            pg_query("GuardarEnMemoriaAgente",
                     "insert into n8n_chat_histories (session_id, message) values ($1, $2);",
                     "={{ [ %s.telefono_e164, JSON.stringify({ type: 'ai', "
                     "content: $('RenderizarTexto').first().json.contenido, tool_calls: [], "
                     "additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) ] }}"
                     % norm, [3280, 0], onError="continueRegularOutput", alwaysOutputData=True),
            set_node("Resultado", {
                "resultado": ("string", "Plantilla enviada"),
                "conversacion_id": ("number",
                                    "={{ $('ConversacionLista').first().json.conversacion_id }}"),
                "contenido": ("string", "={{ $('RenderizarTexto').first().json.contenido }}"),
            }, [3500, 0]),
            nota("Nota", "## El primer mensaje\n"
                 "La plantilla se manda POR CHATWOOT (no directamente a Meta) para que la "
                 "conversacion nazca en el panel y las asesoras la vean desde el minuto uno.\n\n"
                 "A Meta solo se le pide el TEXTO de la plantilla aprobada, para que en el panel se "
                 "lea lo mismo que le ha llegado al cliente. Si Meta falla se usa el respaldo del "
                 "nodo RenderizarTexto.\n\n"
                 "Al final se siembra la memoria del agente con ese primer mensaje: asi Sara sabe "
                 "lo que ya le ha dicho al cliente y no se vuelve a presentar.",
                 [2620, -300], 520, 260),
            nota("Nota2", "## Tokens\n"
                 "Ni el de Chatwoot ni el de Meta estan escritos aqui: van en las credenciales "
                 "'Chatwoot Casagencia' y 'Meta WhatsApp Casagencia'.",
                 [180, -230], 420, 150),
        ],
        "connections": conn(
            ("Start", 0, "Normalizar", 0),
            ("Normalizar", 0, "¿Telefono valido?", 0),
            ("¿Telefono valido?", 0, "¿Ya tengo conversacion?", 0),
            ("¿Telefono valido?", 1, "SinTelefono", 0),
            ("¿Ya tengo conversacion?", 0, "UsarConversacionDada", 0),
            ("¿Ya tengo conversacion?", 1, "BuscarContacto", 0),
            ("BuscarContacto", 0, "ElegirContacto", 0),
            ("ElegirContacto", 0, "¿Existe el contacto?", 0),
            ("¿Existe el contacto?", 0, "ConversacionesDelContacto", 0),
            ("¿Existe el contacto?", 1, "CrearContacto", 0),
            ("ConversacionesDelContacto", 0, "¿Tiene conversacion?", 0),
            ("¿Tiene conversacion?", 0, "ElegirConversacion", 0),
            ("¿Tiene conversacion?", 1, "CrearConversacion", 0),
            ("CrearConversacion", 0, "IdConversacionCreada", 0),
            ("CrearContacto", 0, "EsperaAltaContacto", 0),
            ("EsperaAltaContacto", 0, "CrearConversacionContactoNuevo", 0),
            ("CrearConversacionContactoNuevo", 0, "IdConversacionNueva", 0),
            ("UsarConversacionDada", 0, "ConversacionLista", 0),
            ("ElegirConversacion", 0, "ConversacionLista", 0),
            ("IdConversacionCreada", 0, "ConversacionLista", 0),
            ("IdConversacionNueva", 0, "ConversacionLista", 0),
            ("ConversacionLista", 0, "PlantillaMeta", 0),
            ("PlantillaMeta", 0, "RenderizarTexto", 0),
            ("RenderizarTexto", 0, "EnviarPlantilla", 0),
            ("EnviarPlantilla", 0, "GuardarEnMemoriaAgente", 0),
            ("GuardarEnMemoriaAgente", 0, "Resultado", 0)),
    }


# ---------------------------------------------------------------------------
# [WA] 0 · Esquema de base de datos
# ---------------------------------------------------------------------------
def wf_esquema():
    return {
        "name": "[WA] 0 · Esquema de base de datos",
        "settings": SETTINGS,
        "nodes": [
            node("EjecutarAMano", "n8n-nodes-base.manualTrigger", {}, [-40, 0], 1),
            pg_query("CrearTablas", DDL, None, [200, 0]),
            nota("Nota", "## Ejecutar UNA vez\n"
                 "Crea las dos tablas que necesita el asistente de WhatsApp:\n\n"
                 "- **n8n_chat_histories**: la memoria del agente, una fila por mensaje.\n"
                 "- **wa_leads**: la ficha de cada lead que entra de un portal, con la referencia, "
                 "la operacion, la asesora y las respuestas de cualificacion.\n\n"
                 "Se puede volver a ejecutar sin miedo: todo es 'create if not exists'.",
                 [200, -260], 470, 230),
        ],
        "connections": conn(("EjecutarAMano", 0, "CrearTablas", 0)),
    }


# ---------------------------------------------------------------------------
# [WA] 1 · Leads de portales por correo
# ---------------------------------------------------------------------------
def wf_leads(id_plantilla):
    j = "$('ParsearEmail').first().json"
    entradas_plantilla = {
        "telefono": "={{ %s.telefono_e164 }}" % j,
        "nombre": "={{ %s.nombre }}" % j,
        "plantilla": PLANTILLA,
        "idioma": IDIOMA,
        "param1": "={{ %s.param1 }}" % j,
        "param2": "={{ %s.param2 }}" % j,
        "referencia": "={{ %s.referencia }}" % j,
        "operacion": "={{ %s.operacion }}" % j,
        "portal": "={{ %s.portal }}" % j,
        "conversacion_id": 0,
    }
    esquema = [{"id": k, "displayName": k, "required": False, "defaultMatch": False,
                "display": True, "canBeUsedToMatch": True,
                "type": "number" if k == "conversacion_id" else "string"}
               for k in entradas_plantilla]
    return {
        "name": "[WA] 1 · Leads de portales por correo",
        "settings": SETTINGS,
        "nodes": [
            node("CorreoNuevo", "n8n-nodes-base.gmailTrigger", {
                "pollTimes": {"item": [{"mode": "everyMinute"}]},
                "simple": False,
                "filters": {"q": "(from:idealista.com OR from:fotocasa.es OR "
                                 "from:habitaclia.com OR subject:(solicitud OR contacto)) "
                                 "is:unread"},
                "options": {"downloadAttachments": False},
            }, [-40, 0], 1.2, credentials=CRED_GMAIL),
            code_node("ParsearEmail", "parsear_email.js", [200, 0]),
            if_node("¿Hay telefono?", "={{ $json.se_puede_contactar }}", "true", [420, 0]),
            pg_query("AltaDelLead", SQL_ALTA_LEAD,
                     "={{ [ $json.telefono_wa, $json.telefono_e164, $json.referencia, "
                     "$json.nombre, $json.email_cliente, $json.portal, $json.operacion, "
                     "$json.es_alquiler, $json.asesora, $json.asunto ] }}", [660, -120],
                     alwaysOutputData=True, onError="continueRegularOutput"),
            if_node("¿Es un lead nuevo?", "={{ $json.id }}", "exists", [880, -120],
                    tipo="number"),
            node("YaLeEscribimos", "n8n-nodes-base.noOp", {}, [1100, 20], 1),
            node("EnviarPrimeraPlantilla", "n8n-nodes-base.executeWorkflow", {
                "workflowId": {"__rl": True, "value": id_plantilla, "mode": "list",
                               "cachedResultName": "[WA][SUB] EnviarPlantilla"},
                "workflowInputs": {"mappingMode": "defineBelow", "value": entradas_plantilla,
                                   "matchingColumns": [], "schema": esquema,
                                   "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {"waitForSubWorkflow": True},
            }, [1100, -220], 1.2, onError="continueRegularOutput"),
            pg_query("MarcarPlantillaEnviada", SQL_PLANTILLA_ENVIADA,
                     "={{ [ %s.telefono_wa, $json.conversacion_id || 0, %s.referencia ] }}" % (j, j),
                     [1340, -220], onError="continueRegularOutput", alwaysOutputData=True),
            code_node("AvisoSinTelefono", "lead_sin_telefono.js", [660, 200]),
            node("AvisarAsesoraPorCorreo", "n8n-nodes-base.gmail", {
                "sendTo": "={{ $json.destinatarios }}",
                "subject": "={{ $json.asunto }}",
                "message": "={{ $json.cuerpo }}",
                "options": {"appendAttribution": False},
            }, [880, 200], 2.2, credentials=CRED_GMAIL, onError="continueRegularOutput"),
            nota("Nota", "## De donde salen los leads\n"
                 "Cada portal avisa de la solicitud por correo. Este workflow lee el buzon "
                 "**%s**, saca el telefono, el nombre y la referencia, y arranca la conversacion "
                 "de WhatsApp con la primera plantilla.\n\n"
                 "El filtro de Gmail y el buzon se ajustan en el nodo CorreoNuevo y en "
                 "wa/config.js." % (BUZON or "PENDIENTE"), [-40, -300], 470, 250),
            nota("Nota2", "## No se escribe dos veces\n"
                 "El alta del lead es un insert con 'on conflict': si ya le escribimos por ese mismo "
                 "inmueble no devuelve fila y no se manda nada. Pasados 30 dias si se le vuelve a "
                 "escribir, porque ya es otra oportunidad.", [660, -400], 450, 200),
            nota("Nota3", "## Leads sin telefono\n"
                 "Algunos correos no traen telefono. En vez de perder el lead, el aviso se le manda "
                 "por correo a la asesora que le toca por la referencia.", [660, 380], 450, 170),
        ],
        "connections": conn(
            ("CorreoNuevo", 0, "ParsearEmail", 0),
            ("ParsearEmail", 0, "¿Hay telefono?", 0),
            ("¿Hay telefono?", 0, "AltaDelLead", 0),
            ("¿Hay telefono?", 1, "AvisoSinTelefono", 0),
            ("AltaDelLead", 0, "¿Es un lead nuevo?", 0),
            ("¿Es un lead nuevo?", 0, "EnviarPrimeraPlantilla", 0),
            ("¿Es un lead nuevo?", 1, "YaLeEscribimos", 0),
            ("EnviarPrimeraPlantilla", 0, "MarcarPlantillaEnviada", 0),
            ("AvisoSinTelefono", 0, "AvisarAsesoraPorCorreo", 0)),
    }


# ---------------------------------------------------------------------------
# [WA] 2 · Asistente de WhatsApp
# ---------------------------------------------------------------------------
CTX = "$('ContextoDelLead').first().json"


def de_la_ia(nombre, desc, tipo="string"):
    return ("={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('%s', `%s`, '%s') }}"
            % (nombre, desc, tipo))


def tool_wf(nombre, sub, wid, desc, valores, pos, tipos=None):
    tipos = tipos or {}
    esquema = [{"id": k, "displayName": k, "required": False, "defaultMatch": False,
                "display": True, "canBeUsedToMatch": True, "type": tipos.get(k, "string")}
               for k in valores]
    return node(nombre, "@n8n/n8n-nodes-langchain.toolWorkflow", {
        "description": desc,
        "workflowId": {"__rl": True, "value": wid, "mode": "list", "cachedResultName": sub},
        "workflowInputs": {"mappingMode": "defineBelow", "value": valores,
                           "matchingColumns": [], "schema": esquema,
                           "attemptToConvertTypes": False, "convertFieldsToString": False},
    }, pos, 2.2)


def herramientas_del_agente(ids):
    tel = "={{ %s.telefono_e164 }}" % CTX
    x = 340
    paso = 190
    t = []

    t.append(tool_wf(
        "BuscarPorReferencia", "[WA][SUB] BuscarPorReferencia",
        ids.get("[WA][SUB] BuscarPorReferencia", ""),
        "Devuelve los datos reales de un inmueble a partir de su referencia. Usala en cuanto "
        "tengas la referencia, antes de contestar cualquier duda del inmueble. La referencia es "
        "el dato exacto: si la tienes, esta es la herramienta que toca.",
        {"referencia": de_la_ia("referencia",
            "Referencia del anuncio, tal y como la ha dado el cliente o la que ya viene en los "
            "datos del cliente. Ejemplo: BN-1543-V. Sin espacios y en mayusculas.")},
        [x, 320]))

    t.append(tool_wf(
        "BuscarPorDireccion", "[WA][SUB] BuscarPorDireccion",
        ids.get("[WA][SUB] BuscarPorDireccion", ""),
        "Busca un inmueble por la calle o la direccion que dice el cliente. Usala SOLO cuando ya "
        "le hayas preguntado una vez por la referencia y no la tenga. Devuelve 'encontrado' y "
        "'fiabilidad': si 'encontrado' es false, no le sueltes un listado de inmuebles.",
        {"direccion": de_la_ia("direccion",
            "La direccion tal y como la ha escrito el cliente, con el numero si lo ha dado. "
            "Ejemplo: calle del Mestre Falla 39."),
         "municipio": de_la_ia("municipio",
            "Municipio, solo si ya lo sabes. No lo preguntes antes de buscar. Vacio si no lo sabes."),
         "operacion": de_la_ia("operacion",
            "venta o alquiler, solo si ya lo sabes. Vacio si no lo sabes.")},
        [x + paso, 320]))

    t.append(tool_wf(
        "BuscarInmuebles", "[WA][SUB] BuscarInmuebles",
        ids.get("[WA][SUB] BuscarInmuebles", ""),
        "Busca inmuebles disponibles por municipio y caracteristicas. Es una busqueda APROXIMADA: "
        "usala solo cuando no haya referencia ni direccion, y cuando ya conozcas la operacion, un "
        "municipio valido y el numero minimo de habitaciones. Si al cliente le da igual el numero "
        "de habitaciones, manda 0. No mandes otros filtros.",
        {"municipio": de_la_ia("municipio",
            "Municipio exacto. Solo valen: Almazora / Almassora, Alquerias del Nino Perdido, "
            "Benicasim / Benicassim, Borriol, Burriana / Borriana, Castellon de la Plana / "
            "Castello de la Plana, Onda, Oropesa del Mar / Orpesa, Torreblanca, Vilafames, "
            "Vila-real."),
         "operacion": de_la_ia("operacion", "venta o alquiler."),
         "habitaciones": de_la_ia("habitaciones",
            "Numero minimo de habitaciones. 0 si al cliente le da igual.", "number"),
         "precio_min": de_la_ia("precio_min",
            "Precio minimo en euros. 0 si el cliente no ha dicho nada.", "number")},
        [x + 2 * paso, 320], {"habitaciones": "number", "precio_min": "number"}))

    agenda_valores = {
        "nombre": de_la_ia("nombre", "Nombre del cliente. Vacio si todavia no lo sabes."),
        "telefono": tel,
        "referencia": de_la_ia("referencia", "Referencia del inmueble que se va a visitar."),
        "tipo_transaccion": de_la_ia("tipo_transaccion",
            "compra o alquiler. Si la referencia acaba en -A es alquiler."),
        "fecha": de_la_ia("fecha",
            "Fecha de la visita en formato yyyy-MM-dd, con guiones. Ejemplo: 2026-10-14. "
            "Si el cliente dice manana o el jueves, calculalo tu con la fecha y hora actual."),
        "hora": de_la_ia("hora",
            "Hora de la visita en formato HH:mm, de 24 horas. Ejemplo: 17:30."),
    }

    t.append(tool_wf(
        "ConsultarHuecos", "[WA][SUB] ConsultarHuecos",
        ids.get("[WA][SUB] ConsultarHuecos", ""),
        "SOLO EN COMPRA. Dice si se puede hacer una visita de una hora en una fecha y hora "
        "concretas, y devuelve en 'alternativas' las horas que quedan LIBRES ese dia en la agenda "
        "de la asesora. Valida el horario de oficina y los festivos. Solo consulta: no reserva "
        "nada. Si 'disponible' es false, ofrece unicamente las horas de 'alternativas'. "
        "En ALQUILER esta bloqueada: no la llames.",
        agenda_valores, [x, 500]))

    t.append(tool_wf(
        "ConfirmarVisita", "[WA][SUB] ConfirmarVisita",
        ids.get("[WA][SUB] ConfirmarVisita", ""),
        "SOLO EN COMPRA. Crea la visita en la agenda de la asesora. Usala solo despues de que "
        "ConsultarHuecos haya dicho que hay hueco y el cliente haya aceptado esa fecha y hora "
        "concretas. Devuelve 'cita_confirmada': solo puedes decirle al cliente que la visita esta "
        "puesta si es true, y siempre como PRE-RESERVA pendiente de que la asesora la confirme. "
        "En ALQUILER esta bloqueada: no la llames.",
        agenda_valores, [x + paso, 500]))

    t.append(tool_wf(
        "CualificarLead", "[WA][SUB] CualificarLead",
        ids.get("[WA][SUB] CualificarLead", ""),
        "Guarda en la ficha del cliente las respuestas de cualificacion y manda el aviso a la "
        "asesora. OBLIGATORIA: en alquiler, en cuanto tengas las cuatro respuestas (personas, "
        "ingresos, mascotas y cuando quiere entrar); en compra, antes de ofrecer la visita. "
        "Puedes llamarla mas de una vez: solo se sobreescribe lo que mandes con dato.",
        {"telefono": tel,
         "nombre": de_la_ia("nombre", "Nombre del cliente. Vacio si no lo sabes."),
         "referencia": de_la_ia("referencia", "Referencia del inmueble que le interesa."),
         "operacion": de_la_ia("operacion", "venta o alquiler."),
         "personas": de_la_ia("personas",
            "Solo en alquiler. Para cuantas personas seria la vivienda. Vacio si no lo ha dicho."),
         "ingresos": de_la_ia("ingresos",
            "Solo en alquiler. Lo que ha contestado sobre ingresos fijos, nomina o contrato, tal y "
            "como lo ha dicho el. No lo valores ni lo juzgues. Vacio si no lo ha dicho."),
         "mascotas": de_la_ia("mascotas",
            "Solo en alquiler. Si convive con mascotas y cuales. Vacio si no lo ha dicho."),
         "entrada": de_la_ia("entrada",
            "Solo en alquiler. Para que fecha necesita entrar a vivir. Vacio si no lo ha dicho."),
         "duracion": de_la_ia("duracion",
            "Solo en alquiler. Si lo quiere para todo el ano o por temporada, y cuanto tiempo."),
         "cuando": de_la_ia("cuando",
            "Solo en compra. Para cuando quiere comprar. Vacio si no lo ha dicho."),
         "zona": de_la_ia("zona",
            "Solo en compra. Zonas que le interesan. Vacio si no lo ha dicho."),
         "presupuesto": de_la_ia("presupuesto",
            "Solo en compra. Presupuesto del que ha hablado. Vacio si no lo ha dicho."),
         "financiacion": de_la_ia("financiacion",
            "Solo en compra. Si lo va a financiar con hipoteca o lo tiene resuelto."),
         "resumen": de_la_ia("resumen",
            "Resumen en una o dos lineas para la asesora: quien es, que inmueble le interesa y lo "
            "que ha contado que importe. Sin saltos de linea.")},
        [x + 2 * paso, 500]))

    t.append(tool_wf(
        "ConsultarCita", "[WA][SUB] ConsultarCita",
        ids.get("[WA][SUB] ConsultarCita", ""),
        "Busca en las agendas de Carmen y Gisela las visitas que hay a nombre del telefono de este "
        "cliente. Usala cuando pregunte cuando tiene la visita, si esta confirmada, o quiera "
        "cambiarla o anularla. No modifica ni borra nada: para cambiar o anular hay que avisar a "
        "la asesora.",
        {"telefono": tel}, [x, 680]))

    t.append(tool_wf(
        "AvisarAsesora", "[WA][SUB] AvisarAsesora",
        ids.get("[WA][SUB] AvisarAsesora", ""),
        "Deja un aviso y se lo manda por correo a Laurence, Carmen o Gisela. Usala siempre que "
        "digas que vas a tomar nota o que van a llamar al cliente, cuando el cliente pida hablar "
        "con una persona, y cuando te pregunten algo que tu no puedes contestar (direccion exacta, "
        "gastos, hipoteca, condiciones del propietario).",
        {"telefono": tel,
         "nombre": de_la_ia("nombre", "Nombre del cliente. Vacio si no lo sabes."),
         "destinatario": de_la_ia("destinatario",
            "Carmen, Gisela o Laurence. Manda la asesora que sale en los datos del cliente; si no "
            "hay ninguna, manda Laurence."),
         "motivo": de_la_ia("motivo", "En una linea, que hay que hacer con este cliente."),
         "tipo_llamada": de_la_ia("tipo_llamada",
            "Uno de: consulta_info, venta_en_curso, alquiler_en_curso, queja_problema, "
            "derivacion_asesora, visita_pendiente_agendar, lead_alquiler, otro."),
         "resumen_conversacion": de_la_ia("resumen_conversacion",
            "Resumen de la conversacion de WhatsApp en dos o tres lineas."),
         "urgencia": de_la_ia("urgencia", "normal o alta.")},
        [x + paso, 680]))

    t.append(tool_wf(
        "Etiquetar", "[WA][SUB] Etiquetar",
        ids.get("[WA][SUB] Etiquetar", ""),
        "Marca el estado de esta conversacion en el panel de las asesoras. Usala cuando cambie el "
        "estado del cliente: ia-cualificando al empezar a preguntar, ia-cualificado o "
        "ia-lead-alquiler al terminar, ia-cita-agendada cuando la visita quede puesta, e "
        "intervenir cuando el cliente pida hablar con una persona o se enfade.",
        {"conversacion_id": "={{ %s.conversacion_id }}" % CTX,
         "etiqueta": de_la_ia("etiqueta",
            "Una de: ia-cualificando, ia-cualificado, ia-lead-alquiler, ia-cita-agendada, "
            "intervenir. En minusculas y sin comillas.")},
        [x + 2 * paso, 680], {"conversacion_id": "number"}))

    return t


def wf_asistente(ids):
    ent = "$('EntradaMensaje').first().json"
    mensajes_url = ("=" + CW_API + "/conversations/{{ %s.conversacion_id }}/messages" % CTX)
    cuerpo_mensaje = ("={{ JSON.stringify({ content: $json.mensaje, "
                      "message_type: 'outgoing', private: false }) }}")

    modelo = node("ModeloOpenAI", "@n8n/n8n-nodes-langchain.lmChatOpenAi", {
        "model": {"__rl": True, "value": MODELO, "mode": "list", "cachedResultName": MODELO},
        "options": {"temperature": 0},
    }, [1180, 320], 1.2)
    if CRED_OPENAI:
        modelo["credentials"] = CRED_OPENAI

    nodos = [
        node("Webhook", "n8n-nodes-base.webhook", {
            "httpMethod": "POST", "path": "wa-asistente", "options": {},
        }, [-40, 0], 2.1, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/webhook"))),
        code_node("EntradaMensaje", "asistente_entrada.js", [180, 0]),
        if_node("¿Contestar?", "={{ $json.contestar }}", "true", [400, 0]),
        node("NoContestar", "n8n-nodes-base.noOp", {}, [620, 180], 1),
        node("GuardarBuffer", "n8n-nodes-base.redis", {
            "operation": "push",
            "list": "={{ $json.clave_buffer }}",
            "messageData": "={{ $json.contenido }}",
        }, [620, -60], 1, credentials=CRED_REDIS),
        node("Espera", "n8n-nodes-base.wait", {"amount": ESPERA}, [840, -60], 1.1,
             webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/espera"))),
        node("LeerBuffer", "n8n-nodes-base.redis", {
            "operation": "get", "propertyName": "message",
            "key": "={{ %s.clave_buffer }}" % ent, "options": {},
        }, [1060, -60], 1, credentials=CRED_REDIS, alwaysOutputData=True),
        if_node("¿Soy el ultimo?", "={{ $json.message[0] }}", "equals", [1280, -60],
                der="={{ %s.contenido }}" % ent, tipo="string"),
        node("OtroMensajeMasNuevo", "n8n-nodes-base.noOp", {}, [1500, 100], 1),
        node("BorrarBuffer", "n8n-nodes-base.redis", {
            "operation": "delete", "key": "={{ %s.clave_buffer }}" % ent,
        }, [1500, -160], 1, credentials=CRED_REDIS, onError="continueRegularOutput"),
        code_node("JuntarMensajes", "asistente_juntar.js", [1720, -160]),
        pg_query("LeerFichaDelLead", SQL_FICHA, "={{ [ $json.telefono_wa ] }}", [1940, -160],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        code_node("ContextoDelLead", "asistente_contexto.js", [2160, -160]),
        node("Agente", "@n8n/n8n-nodes-langchain.agent", {
            "promptType": "define",
            "text": "=Datos del cliente:\n{{ $json.contexto }}\n"
                    "- Fecha y hora ahora mismo: "
                    "{{ $now.setZone('Europe/Madrid').toFormat(\"cccc dd/MM/yyyy HH:mm\", "
                    "{ locale: 'es' }) }}\n\n"
                    "Mensaje del cliente:\n{{ $json.mensaje }}",
            "options": {"systemMessage": "=" + PROMPT, "maxIterations": 12},
        }, [2400, -160], 1.8, onError="continueErrorOutput"),
        modelo,
        node("MemoriaPostgres", "@n8n/n8n-nodes-langchain.memoryPostgresChat", {
            "sessionIdType": "customKey",
            "sessionKey": "={{ %s.telefono_e164 }}" % CTX,
            "contextWindowLength": 40,
        }, [1380, 320], 1.3, credentials=CRED_PG),
        code_node("DividirRespuesta", "asistente_dividir.js", [2660, -260]),
        http("EnviarMensajes", "POST", mensajes_url, [2900, -260], cred=CRED_CHATWOOT,
             body=cuerpo_mensaje, retryOnFail=True, waitBetweenTries=3000,
             options={"batching": {"batch": {"batchSize": 1, "batchInterval": 2500}}}),
        http("AvisoDeFallo", "POST", mensajes_url, [2660, -20], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ content: 'Te atendemos enseguida, dame un momento.', "
                  "message_type: 'outgoing', private: false }) }}",
             onError="continueRegularOutput"),
        nota("Nota", "## Como llega el mensaje\n"
             "Chatwoot avisa por webhook de cada mensaje. EntradaMensaje decide si el bot debe "
             "contestar: no contesta si lo escribio la agencia, si no hay texto (audio o imagen), "
             "si la conversacion esta resuelta, si tiene la etiqueta **intervenir** o si el "
             "atributo **bot** esta en Off. Esos dos son el interruptor de mano de las asesoras.",
             [180, -330], 470, 240),
        nota("Nota2", "## Los 60 segundos\n"
             "El cliente escribe en varios mensajes seguidos. Cada uno se apila en Redis, se "
             "esperan %d segundos y solo sigue el turno del MAS NUEVO: los demas se caen por "
             "'¿Soy el ultimo?'. Asi se contesta una vez y con todo el contexto, en vez de tres "
             "veces a medias.\n\nEs el mismo mecanismo que usa Blue." % ESPERA,
             [840, -360], 470, 250),
        nota("Nota3", "## Las herramientas son las del telefono\n"
             "Cartera, calendario, horarios, festivos y la regla de 'en alquiler no se agenda' "
             "salen de los MISMOS webhooks que usa Sara por telefono. Una regla se cambia una vez "
             "y vale para los dos canales.\n\n"
             "La memoria va en Postgres (una fila por mensaje, la sesion es el telefono) y el "
             "primer mensaje ya lo siembra [WA][SUB] EnviarPlantilla.",
             [2400, 480], 500, 250),
        nota("Nota4", "## PENDIENTE antes de activar\n"
             "1. Elegir la credencial de OpenAI en el nodo ModeloOpenAI.\n"
             "2. Rellenar Chatwoot, Meta, el inbox y la plantilla en wa/config.js y redesplegar.\n"
             "3. Ejecutar una vez [WA] 0 · Esquema de base de datos.\n"
             "4. Apuntar el webhook de Chatwoot a la URL de este Webhook.\n"
             "5. Activar primero este workflow y despues [WA] 1.",
             [-40, 300], 470, 260),
    ]

    principal = conn(
        ("Webhook", 0, "EntradaMensaje", 0),
        ("EntradaMensaje", 0, "¿Contestar?", 0),
        ("¿Contestar?", 0, "GuardarBuffer", 0),
        ("¿Contestar?", 1, "NoContestar", 0),
        ("GuardarBuffer", 0, "Espera", 0),
        ("Espera", 0, "LeerBuffer", 0),
        ("LeerBuffer", 0, "¿Soy el ultimo?", 0),
        ("¿Soy el ultimo?", 0, "BorrarBuffer", 0),
        ("¿Soy el ultimo?", 1, "OtroMensajeMasNuevo", 0),
        ("BorrarBuffer", 0, "JuntarMensajes", 0),
        ("JuntarMensajes", 0, "LeerFichaDelLead", 0),
        ("LeerFichaDelLead", 0, "ContextoDelLead", 0),
        ("ContextoDelLead", 0, "Agente", 0),
        ("Agente", 0, "DividirRespuesta", 0),
        ("Agente", 1, "AvisoDeFallo", 0),
        ("DividirRespuesta", 0, "EnviarMensajes", 0))

    herramientas = herramientas_del_agente(ids)
    nodos += herramientas
    ai = ai_conn("Agente", [("ModeloOpenAI", "ai_languageModel"),
                            ("MemoriaPostgres", "ai_memory")]
                 + [(h["name"], "ai_tool") for h in herramientas])

    return {"name": "[WA] 2 · Asistente de WhatsApp", "settings": SETTINGS,
            "nodes": nodos, "connections": fusionar(principal, ai)}


# ===========================================================================
# Construccion y despliegue
# ===========================================================================
ORDEN = [
    "[WA][SUB] BuscarPorReferencia",
    "[WA][SUB] BuscarPorDireccion",
    "[WA][SUB] BuscarInmuebles",
    "[WA][SUB] ConsultarHuecos",
    "[WA][SUB] ConfirmarVisita",
    "[WA][SUB] ConsultarCita",
    "[WA][SUB] AvisarAsesora",
    "[WA][SUB] CualificarLead",
    "[WA][SUB] Etiquetar",
    "[WA][SUB] EnviarPlantilla",
    "[WA] 0 · Esquema de base de datos",
    "[WA] 1 · Leads de portales por correo",
    "[WA] 2 · Asistente de WhatsApp",
]


def construir(ids):
    wfs = subs_puente()
    wfs["[WA][SUB] CualificarLead"] = wf_cualificar()
    wfs["[WA][SUB] Etiquetar"] = wf_etiquetar()
    wfs["[WA][SUB] EnviarPlantilla"] = wf_plantilla()
    wfs["[WA] 0 · Esquema de base de datos"] = wf_esquema()
    wfs["[WA] 1 · Leads de portales por correo"] = wf_leads(
        ids.get("[WA][SUB] EnviarPlantilla", ""))
    wfs["[WA] 2 · Asistente de WhatsApp"] = wf_asistente(ids)
    return {n: wfs[n] for n in ORDEN}


def api(method, path, payload=None):
    key = os.environ["N8N_API_KEY"]
    req = urllib.request.Request(
        N8N + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"X-N8N-API-KEY": key, "Content-Type": "application/json",
                 "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode() or "{}")


def esbozo(nombre):
    """Workflow minimo, solo para reservar el id antes de montar las herramientas."""
    return {"name": nombre, "settings": SETTINGS, "connections": {},
            "nodes": [node("Pendiente", "n8n-nodes-base.manualTrigger", {}, [0, 0], 1)]}


def main():
    deploy = "--deploy" in sys.argv
    ids = json.loads(IDS_FILE.read_text(encoding="utf-8")) if IDS_FILE.exists() else {}

    if deploy:
        remotos = {w["name"]: w["id"] for w in api("GET", "/api/v1/workflows?limit=250")["data"]}
        for nombre in ORDEN:
            if nombre in ids:
                continue
            if nombre in remotos:
                ids[nombre] = remotos[nombre]
                print("  reutilizo   %-42s %s" % (nombre, ids[nombre]))
            else:
                ids[nombre] = api("POST", "/api/v1/workflows", esbozo(nombre))["id"]
                print("  reservo id  %-42s %s" % (nombre, ids[nombre]))
        IDS_FILE.write_text(json.dumps(ids, ensure_ascii=False, indent=2), encoding="utf-8")

    wfs = construir(ids)

    SALIDA.mkdir(exist_ok=True)
    for nombre, wf in wfs.items():
        fichero = re.sub(r"[^A-Za-z0-9]+", "_", nombre).strip("_") + ".json"
        (SALIDA / fichero).write_text(json.dumps(wf, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
        print("  generado    %-42s nodos=%-3d id=%s"
              % (nombre, len(wf["nodes"]), ids.get(nombre, "sin id todavia")))

    if not deploy:
        print("\n(sin --deploy: no se ha subido nada)")
        return

    print()
    for nombre, wf in wfs.items():
        api("PUT", "/api/v1/workflows/%s" % ids[nombre], wf)
        print("  ACTUALIZADO %-42s %s" % (nombre, ids[nombre]))
    print("\nTodos quedan DESACTIVADOS a proposito. Antes de activar:")
    print("  1. Elegir la credencial de OpenAI en ModeloOpenAI.")
    print("  2. Rellenar Chatwoot / Meta / plantilla / buzon en wa/config.js y redesplegar.")
    print("  3. Ejecutar una vez [WA] 0 · Esquema de base de datos.")
    print("  4. Apuntar el webhook de Chatwoot al Webhook de [WA] 2.")


if __name__ == "__main__":
    main()
