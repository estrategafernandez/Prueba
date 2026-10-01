#!/usr/bin/env python3
"""Construye y despliega el ASISTENTE DE WHATSAPP de Casagencia.

  python3 build_whatsapp.py            -> genera los JSON en workflows_wa/
  python3 build_whatsapp.py --deploy   -> ademas los crea/actualiza en n8n

Es un proyecto aparte del asistente telefonico. Sus workflows llevan [WA] y la
etiqueta "Asistente WhatsApp", y NO llaman nunca a los [TEL]: comparten los
mismos DATOS (el Google Sheet de la cartera y los calendarios de Carmen y
Gisela), no la ejecucion.

La logica de agenda (horario, festivos, huecos, doble comprobacion antes de
escribir) SI se reutiliza: los ficheros de n8n/casagencia/nodes y la libreria
lib/casagencia_comun.js se LEEN y se inyectan en nodos propios de WhatsApp. Asi
un cambio de horario o de festivos vale para los dos canales sin tocar nada
del telefono.

TODO se crea DESACTIVADO. La API key de n8n se lee de N8N_API_KEY.
"""
import json, os, re, sys, uuid, pathlib, urllib.request, urllib.error

BASE = pathlib.Path(__file__).parent
WA = BASE / "wa"
TEL_NODES = BASE / "nodes"                 # solo lectura: codigo del telefono
SALIDA = BASE / "workflows_wa"
IDS_FILE = WA / "ids.json"
N8N = "https://n8n-casagencia.serversvisionarius.com"

SETTINGS = {"executionOrder": "v1", "timezone": "Europe/Madrid"}

# --- Credenciales de Casagencia ---------------------------------------------
CRED_PG       = {"postgres": {"id": "yvym0TdlOebNMzsm", "name": "Postgres account"}}
CRED_REDIS    = {"redis": {"id": "hddla0B9Wo7BsMpy", "name": "Redis account"}}
CRED_GMAIL    = {"gmailOAuth2": {"id": "mKh6b4I1hwDsBwOd", "name": "Gmail account"}}
CRED_SHEETS   = {"googleSheetsOAuth2Api": {"id": "TPExRnq8a9FlEXAh", "name": "Google Sheets account"}}
# El mismo calendario que usa el telefono para leer y escribir en las agendas
# de Carmen y Gisela: las citas de los dos canales se ven y se respetan.
CRED_CAL      = {"googleCalendarOAuth2Api": {"id": "KKDdmqzzE6jXVm5b", "name": "Google Calendar Paco"}}
CRED_CHATWOOT = {"httpHeaderAuth": {"id": "Wm0tmDE3FjfTx1Tu", "name": "Chatwoot Casagencia"}}
CRED_META     = {"httpHeaderAuth": {"id": "P4xswu9i9E4RILJN", "name": "Meta WhatsApp Casagencia"}}
# Clave que hay que mandar en la cabecera para usar [WA] 9 · Lead a mano
CRED_LEAD_MANUAL = {"httpHeaderAuth": {"id": "cFrVkaTH4R4tKWn0", "name": "WA lead a mano (clave del webhook)"}}
CRED_OPENAI   = {"openAiApi": {"id": "43TI6Y7wzI9hadIh", "name": "OpenAI Casagencia"}}

MODELO = "gpt-5.1"
SHEET_ID = "1cB2UI-ScDI34QS57k-UD2ZE79P5XhpyPJu78A5zPs3Q"
CALENDARIOS = {"Carmen": "carmen@casagencia.com", "Gisela": "gisela@casagencia.com"}

CONFIG = (WA / "config.js").read_text(encoding="utf-8")

# Numeros de prueba: se inyectan desde wa/pruebas.local.json (no esta en git).
# {"telefonos": ["34600000000"], "avisar_movil": "34600000000", "avisar_email": "x@y.com"}
_PRUEBAS_FILE = WA / "pruebas.local.json"
_hueco = re.search(r"/\*PRUEBAS\*/(.*?)/\*FIN_PRUEBAS\*/", CONFIG, re.S)
assert _hueco, "config.js: no encuentro el hueco de PRUEBAS"
CONFIG_REPO = CONFIG                  # lo que se guarda en workflows_wa/ (sin telefonos)
CONFIG_DESPLIEGUE = CONFIG            # lo que se sube a n8n
if _PRUEBAS_FILE.exists():
    _p = json.loads(_PRUEBAS_FILE.read_text(encoding="utf-8"))
    assert _p.get("avisar_movil") and _p.get("avisar_email"), "pruebas.local.json: faltan avisar_movil/avisar_email"
    CONFIG_DESPLIEGUE = CONFIG.replace(_hueco.group(0), json.dumps(_p, ensure_ascii=False))
    PRUEBAS_ACTIVAS = len(_p.get("telefonos", []))
else:
    PRUEBAS_ACTIVAS = 0
CARTERA = (WA / "cartera.js").read_text(encoding="utf-8")
LIB = (BASE / "lib" / "casagencia_comun.js").read_text(encoding="utf-8")
PROMPT = (WA / "prompt_asistente.md").read_text(encoding="utf-8")


def const(nombre, por_defecto=""):
    """Lee una constante simple de wa/config.js para no repetirla aqui."""
    m = re.search(r"^const\s+%s\s*=\s*(.+?);\s*(?://.*)?$" % nombre, CONFIG, re.M)
    if not m:
        return por_defecto
    v = m.group(1).strip()
    return v[1:-1] if v[:1] in "'\"" else v


CW_URL     = const("CHATWOOT_URL")
CW_CUENTA  = const("CHATWOOT_CUENTA", "1")
CW_INBOX   = const("CHATWOOT_INBOX", "1")
META_API   = const("META_API")
PHONE_ID   = const("META_PHONE_ID")
WABA_ID    = const("META_WABA_ID")
BUZON      = const("BUZON_LEADS")
ESPERA     = int(const("BUFFER_SEGUNDOS", "60"))
RECORDAR_H = int(const("RECORDATORIO_HORAS", "24"))
MARCA      = const("MARCA_ORIGEN")
CW_API     = "%s/api/v1/accounts/%s" % (CW_URL, CW_CUENTA)
ETQ_BIENVENIDA = "1-bienvenida_ia"
assert ETQ_BIENVENIDA in CONFIG and MARCA and PHONE_ID and WABA_ID


# ---------------------------------------------------------------------------
# Codigo de los nodos
# ---------------------------------------------------------------------------
def code_wa(fname, cartera=False):
    """Nodo propio de WhatsApp = config de WA [+ cartera] + el cuerpo."""
    partes = [CONFIG] + ([CARTERA] if cartera else []) + [(WA / fname).read_text(encoding="utf-8")]
    return "\n\n".join(partes)


def code_tel(fname, cambios=()):
    """Reutiliza un nodo del telefono tal cual (con su libreria), sin tocar el
    fichero original. `cambios` adapta alguna linea al contexto de WhatsApp y
    falla en voz alta si el original ha cambiado y ya no encaja."""
    cuerpo = (TEL_NODES / fname).read_text(encoding="utf-8")
    for viejo, nuevo in cambios:
        assert viejo in cuerpo, "%s ha cambiado: no encuentro %r" % (fname, viejo)
        cuerpo = cuerpo.replace(viejo, nuevo)
    return LIB + "\n\n" + cuerpo


def node(name, ntype, params, pos, tv, **extra):
    n = {"parameters": params, "type": ntype, "typeVersion": tv, "position": list(pos),
         "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/" + name)), "name": name}
    n.update(extra)
    return n


def code_node(name, codigo, pos, **extra):
    return node(name, "n8n-nodes-base.code", {"jsCode": codigo}, pos, 2, **extra)


def set_node(name, campos, pos):
    asigna = [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name + k)), "name": k, "type": t, "value": v}
              for k, (t, v) in campos.items()]
    return node(name, "n8n-nodes-base.set", {"assignments": {"assignments": asigna}, "options": {}}, pos, 3.4)


def if_node(name, izq, op, pos, der=None, tipo="boolean", conds=None):
    """IF de una condicion, o de varias con AND si se pasa `conds`."""
    lista = conds or [(izq, op, der, tipo)]
    condiciones = []
    for i, (l, o, r, t) in enumerate(lista):
        c = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "if%s%d" % (name, i))),
             "leftValue": l, "rightValue": r if r is not None else "",
             "operator": {"type": t, "operation": o}}
        if r is None:
            c["operator"]["singleValue"] = True
        condiciones.append(c)
    return node(name, "n8n-nodes-base.if", {"conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
        "conditions": condiciones, "combinator": "and"}, "looseTypeValidation": True, "options": {}}, pos, 2.2)


def nota(name, texto, pos, w=440, h=220):
    return node(name, "n8n-nodes-base.stickyNote", {"content": texto, "height": h, "width": w}, pos, 1)


def noop(name, pos):
    return node(name, "n8n-nodes-base.noOp", {}, pos, 1)


def http(name, metodo, url, pos, cred=None, body=None, query=None, **extra):
    p = {"method": metodo, "url": url, "options": extra.pop("options", {})}
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
    kw = {"credentials": cred} if cred else {}
    kw.update(extra)
    return node(name, "n8n-nodes-base.httpRequest", p, pos, 4.2, **kw)


def pg_query(name, sql, valores, pos, **extra):
    p = {"operation": "executeQuery", "query": sql, "options": {}}
    if valores:
        p["options"]["queryReplacement"] = valores
    return node(name, "n8n-nodes-base.postgres", p, pos, 2.6, credentials=CRED_PG, **extra)


def trigger_sub(entradas, pos=(-40, 0)):
    """Entrada de un sub-workflow. entradas = [(nombre, tipo)]"""
    return node("Start", "n8n-nodes-base.executeWorkflowTrigger",
                {"workflowInputs": {"values": [{"name": k} if t == "string" else {"name": k, "type": t}
                                               for k, t in entradas]}}, pos, 1.1)


def leer_hoja(name, pestana, pos, **extra):
    hoja = {"__rl": True, "value": "gid=0", "mode": "id"} if pestana == "gid=0" \
        else {"__rl": True, "value": pestana, "mode": "name"}
    return node(name, "n8n-nodes-base.googleSheets", {
        "documentId": {"__rl": True, "value": SHEET_ID, "mode": "id"},
        "sheetName": hoja, "options": {}}, pos, 4.7, credentials=CRED_SHEETS,
        alwaysOutputData=True, onError="continueRegularOutput", **extra)


def leer_cartera(name, pos):
    """La cartera completa de WhatsApp (tabla wa_cartera, la rellena [WA] 4)."""
    return pg_query(name, SQL_LEER_CARTERA, None, pos, alwaysOutputData=True,
                    onError="continueRegularOutput", executeOnce=True)


def cal_getall(name, calendario, tmin, tmax, pos, query=None):
    opts = {"singleEvents": True}          # expande los eventos periodicos
    if query:
        opts["query"] = query
    return node(name, "n8n-nodes-base.googleCalendar", {
        "operation": "getAll",
        "calendar": {"__rl": True, "value": calendario, "mode": "id"},
        "returnAll": True, "timeMin": tmin, "timeMax": tmax, "options": opts,
    }, pos, 1.3, credentials=CRED_CAL, alwaysOutputData=True, onError="continueRegularOutput")


def exec_sub(name, wid, sub, entradas, pos, tipos=None, cada_uno=False, **extra):
    """Llama a un sub-workflow [WA][SUB] pasandole las entradas por nombre."""
    tipos = tipos or {}
    esquema = [{"id": k, "displayName": k, "required": False, "defaultMatch": False, "display": True,
                "canBeUsedToMatch": True, "type": tipos.get(k, "string")} for k in entradas]
    p = {"workflowId": {"__rl": True, "value": wid, "mode": "list", "cachedResultName": sub},
         "workflowInputs": {"mappingMode": "defineBelow", "value": entradas, "matchingColumns": [],
                            "schema": esquema, "attemptToConvertTypes": False,
                            "convertFieldsToString": False},
         "options": {"waitForSubWorkflow": True}}
    if cada_uno:
        p["mode"] = "each"
    return node(name, "n8n-nodes-base.executeWorkflow", p, pos, 1.2, **extra)


def conn(*pares):
    out = {}
    for src, oidx, dst, didx in pares:
        m = out.setdefault(src, {"main": []})["main"]
        while len(m) <= oidx:
            m.append([])
        m[oidx].append({"node": dst, "type": "main", "index": didx})
    return out


def ai_conn(destino, pares):
    return {nombre: {tipo: [[{"node": destino, "type": tipo, "index": 0}]]} for nombre, tipo in pares}


def fusionar(*dicts):
    out = {}
    for d in dicts:
        for k, v in d.items():
            dst = out.setdefault(k, {})
            for tipo, listas in v.items():
                l = dst.setdefault(tipo, [])
                while len(l) < len(listas):
                    l.append([])
                for i, x in enumerate(listas):
                    l[i].extend(x)
    return out


def wf(nombre, nodos, conexiones):
    return {"name": nombre, "settings": SETTINGS, "nodes": nodos, "connections": conexiones}


# ===========================================================================
# SQL
# ===========================================================================
_CITA_COLS = ["cita_fecha", "cita_hora"]                                # la visita agendada
_Q = ["q_tiempo_buscando", "q_necesita_vender",                       # compra
      "q_personas", "q_ingresos", "q_mascotas", "q_entrada",           # alquiler
      "q_duracion", "q_actividad"]

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
  enlace          text not null default '',
  plantilla       text not null default '',
  operacion       text not null default '',
  es_alquiler     boolean not null default false,
  asesora         text not null default '',
  estado          text not null default 'nuevo',
  conversacion_id bigint,
  asunto          text not null default '',
  notas           text not null default '',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
-- Las respuestas de cualificacion. Con "add column if not exists" el script
-- se puede volver a ejecutar sin miedo aunque la tabla ya exista.
%s
-- Un lead por telefono e inmueble: el mismo cliente puede preguntar por dos
-- inmuebles distintos, pero no se le escribe dos veces por el mismo.
create unique index if not exists wa_leads_unico on wa_leads (telefono_wa, referencia);

-- La cartera COMPLETA, desde el feed de eGO ([WA] 4 la rellena cada hora)
create table if not exists wa_cartera (
  ref              text primary key,
  web_id           text not null default '',
  enlace           text not null default '',
  precio           numeric not null default 0,
  tipo_transaccion text not null default '',
  tipo_inmueble    text not null default '',
  municipio        text not null default '',
  zona             text not null default '',
  habitaciones     integer not null default 0,
  banos            integer not null default 0,
  superficie       integer not null default 0,
  caracteristicas  text not null default '',
  descripcion      text not null default '',
  imagen           text not null default '',
  actualizado_en   timestamptz not null default now()
);

-- Avisos ya enviados (recordatorio de 24 h), para no mandar ninguno dos veces
create table if not exists wa_avisos (
  id         serial primary key,
  evento_id  text not null,
  tipo       text not null,
  enviado_en timestamptz not null default now()
);
create unique index if not exists wa_avisos_unico on wa_avisos (evento_id, tipo);
""" % "\n".join("alter table wa_leads add column if not exists %s text not null default '';" % q
                for q in _Q + _CITA_COLS)

# Devuelve fila SOLO si el lead es nuevo o si el ultimo contacto es de hace mas
# de 30 dias. Si no devuelve nada, ya se le escribio: no se le vuelve a escribir.
SQL_ALTA_LEAD = """insert into wa_leads
  (telefono_wa, telefono_e164, referencia, nombre, email_cliente, portal,
   operacion, es_alquiler, asesora, asunto, enlace, plantilla, estado)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'nuevo')
on conflict (telefono_wa, referencia) do update
   set nombre   = case when wa_leads.nombre = '' then excluded.nombre else wa_leads.nombre end,
       portal   = excluded.portal,
       asunto   = excluded.asunto,
       enlace   = case when excluded.enlace <> '' then excluded.enlace else wa_leads.enlace end,
       estado   = 'nuevo',
       actualizado_en = now()
 where wa_leads.actualizado_en < now() - interval '30 days'
returning id, telefono_wa, referencia;"""

# Alta a mano: a diferencia del correo, SIEMPRE se manda (lo pide una persona)
# y las respuestas de cualificacion de antes se ponen a cero.
SQL_ALTA_MANUAL = """insert into wa_leads
  (telefono_wa, telefono_e164, referencia, nombre, email_cliente, portal,
   operacion, es_alquiler, asesora, asunto, enlace, plantilla, estado)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'nuevo')
on conflict (telefono_wa, referencia) do update
   set nombre = excluded.nombre, portal = excluded.portal, enlace = excluded.enlace,
       plantilla = excluded.plantilla, operacion = excluded.operacion,
       es_alquiler = excluded.es_alquiler, asesora = excluded.asesora, estado = 'nuevo',
       %s,
       actualizado_en = now()
returning id, telefono_wa, referencia;""" % ", ".join("%s = ''" % q for q in _Q + _CITA_COLS)

SQL_PLANTILLA_ENVIADA = """update wa_leads
   set estado = 'plantilla_enviada', conversacion_id = $2, actualizado_en = now()
 where telefono_wa = $1 and referencia = $3;"""

SQL_FICHA = """select * from wa_leads
 where telefono_wa = $1
 order by actualizado_en desc
 limit 1;"""

SQL_CUALIFICAR = """insert into wa_leads
  (telefono_wa, telefono_e164, referencia, nombre, operacion, es_alquiler, asesora, estado, conversacion_id, %s)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,%s)
on conflict (telefono_wa, referencia) do update set
  nombre      = case when excluded.nombre <> '' then excluded.nombre else wa_leads.nombre end,
  asesora     = excluded.asesora,
  operacion   = excluded.operacion,
  es_alquiler = excluded.es_alquiler,
  estado      = excluded.estado,
  conversacion_id = coalesce(nullif(excluded.conversacion_id, 0), wa_leads.conversacion_id),
  %s,
  actualizado_en = now()
returning id;""" % (
    ", ".join(_Q),
    ",".join("$%d" % (10 + i) for i in range(len(_Q))),
    ",\n  ".join("%s = case when excluded.%s <> '' then excluded.%s else wa_leads.%s end"
                 % (q, q, q, q) for q in _Q))

SQL_CITA = """update wa_leads
   set estado = 'cita_agendada', cita_fecha = $2, cita_hora = $3, actualizado_en = now()
 where telefono_wa = $1;"""

# La misma visita (mismo cliente, dia y hora) ya reservada: no se repite.
SQL_YA_RESERVADA = """select cita_fecha, cita_hora from wa_leads
 where telefono_wa = $1 and estado = 'cita_agendada' and cita_fecha = $2 and cita_hora = $3
 limit 1;"""

# Una sola sentencia: mete o actualiza lo que viene en el feed y borra lo que ya
# no esta (vendido o retirado). O todo o nada.
_CARTERA_COLS = [("ref", "text"), ("web_id", "text"), ("enlace", "text"), ("precio", "numeric"),
                 ("tipo_transaccion", "text"), ("tipo_inmueble", "text"), ("municipio", "text"),
                 ("zona", "text"), ("habitaciones", "integer"), ("banos", "integer"),
                 ("superficie", "integer"), ("caracteristicas", "text"), ("descripcion", "text"),
                 ("imagen", "text")]
SQL_GUARDAR_CARTERA = """with nuevos as (
  select * from jsonb_to_recordset($1::jsonb) as x(%s)
), borrados as (
  delete from wa_cartera where ref not in (select ref from nuevos)
  returning ref
)
insert into wa_cartera (%s, actualizado_en)
select %s, now() from nuevos
on conflict (ref) do update set
  %s,
  actualizado_en = now()
returning ref;""" % (
    ", ".join("%s %s" % c for c in _CARTERA_COLS),
    ", ".join(c for c, _ in _CARTERA_COLS),
    ", ".join(c for c, _ in _CARTERA_COLS),
    ",\n  ".join("%s = excluded.%s" % (c, c) for c, _ in _CARTERA_COLS if c != "ref"))

SQL_LEER_CARTERA = "select * from wa_cartera order by ref;"

SQL_AVISADO = """insert into wa_avisos (evento_id, tipo) values ($1, 'recordatorio_24h')
on conflict (evento_id, tipo) do nothing
returning evento_id;"""


# ===========================================================================
# CARTERA: leen el mismo Google Sheet que el telefono (solo lectura)
# ===========================================================================
NOTA_CARTERA = (
    "## La cartera\nSale de la tabla *wa_cartera*, que [WA] 4 rellena cada hora desde el MISMO "
    "feed de eGO que usa el telefono, pero COMPLETA: descripcion entera (la hoja del telefono la "
    "corta a 500 caracteres), superficie, caracteristicas en espanol y el enlace de la web.\n\n"
    "La pestana *Direcciones* del Google Sheet la rellena la agencia a mano: si un inmueble tiene "
    "su calle ahi, Sara puede darla.")


def wf_cartera(nombre, entradas, fichero, nodo_final, texto_nota, tipos_extra=None):
    return wf(nombre, [
        trigger_sub(entradas),
        leer_cartera("LeerCartera", [200, 0]),
        leer_hoja("LeerDirecciones", "Direcciones", [420, 0], executeOnce=True),
        code_node(nodo_final, code_wa(fichero, cartera=True), [640, 0]),
        nota("Nota", texto_nota + "\n\n" + NOTA_CARTERA, [200, -300], 480, 270),
    ], conn(("Start", 0, "LeerCartera", 0), ("LeerCartera", 0, "LeerDirecciones", 0),
            ("LeerDirecciones", 0, nodo_final, 0)))


def wf_ficha():
    return wf_cartera("[WA][SUB] buscarPorReferencia", [("referencia", "string")],
                      "ficha_inmueble.js", "FichaCompleta",
                      "## Ficha completa del inmueble\nTodo lo que hay de ese inmueble en la cartera, "
                      "incluida la descripcion entera del anuncio, para que Sara resuelva cualquier "
                      "duda sin inventar. Tolera la referencia con o sin guiones.")


def wf_buscar():
    return wf_cartera("[WA][SUB] buscarInmuebles",
                      [("operacion", "string"), ("municipio", "string"), ("zona", "string"),
                       ("tipo", "string"), ("habitaciones_min", "number"), ("banos_min", "number"),
                       ("precio_min", "number"), ("precio_max", "number"),
                       ("superficie_min", "number"), ("extras", "string"), ("excluir", "string"),
                       ("limite", "number")],
                      "buscar_inmuebles.js", "Filtrar",
                      "## Busqueda con todos los filtros\nOperacion, municipio, zona, tipo, "
                      "habitaciones, banos, precio minimo y maximo, superficie y extras (piscina, "
                      "terraza, garaje...). Si nada cumple todos los extras, ensena los que mas se "
                      "acercan y lo dice.")


def wf_similares():
    return wf_cartera("[WA][SUB] recomendarSimilares",
                      [("referencia", "string"), ("excluir", "string"), ("limite", "number"),
                       ("precio_max", "number"), ("precio_min", "number")],
                      "recomendar_similares.js", "Puntuar",
                      "## Recomendar parecidos\nMisma operacion y, puntuando: mismo municipio, "
                      "misma zona, mismo tipo, habitaciones parecidas y precio en la horquilla del "
                      "25 %. Para cuando el que pidio no le encaja o ya no esta.")


def wf_direccion():
    return wf("[WA][SUB] buscarPorDireccion", [
        trigger_sub([("direccion", "string"), ("municipio", "string"), ("operacion", "string")]),
        leer_cartera("LeerInmuebles", [200, 0]),
        leer_hoja("LeerDirecciones", "Direcciones", [420, 0], executeOnce=True),
        # El mismo algoritmo que el telefono (acierta el 91 % a la primera con las
        # calles reales de eGO), leyendo la peticion del sub-workflow en vez del webhook.
        code_node("EmparejarDireccion", code_tel("dir_emparejar.js", [
            ("$('Webhook').first().json.body", "$('Start').first().json")]), [640, 0]),
        code_node("RespuestaParaElAgente", code_wa("herramienta_respuesta.js"), [860, 0]),
        nota("Nota", "## Busqueda por calle\nReutiliza el emparejador de direcciones del telefono "
             "(fichero nodes/dir_emparejar.js, sin tocarlo). Si no hay coincidencia clara devuelve "
             "'no encontrado' a proposito, para no soltarle al cliente un listado que no ha "
             "pedido.\n\n" + NOTA_CARTERA, [200, -320], 480, 290),
    ], conn(("Start", 0, "LeerInmuebles", 0), ("LeerInmuebles", 0, "LeerDirecciones", 0),
            ("LeerDirecciones", 0, "EmparejarDireccion", 0),
            ("EmparejarDireccion", 0, "RespuestaParaElAgente", 0)))


# ===========================================================================
# AGENDA: mismos calendarios y misma logica que el telefono
# ===========================================================================
AGENDA_IN = [("nombre", "string"), ("telefono", "string"), ("referencia", "string"),
             ("tipo_transaccion", "string"), ("fecha", "string"), ("hora", "string"),
             ("modo", "string")]
DIA = "$json.fecha_consulta"
DESDE_DIA = "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).startOf('day').toISO() }}" % DIA
NOTA_AGENDA = (
    "## Agenda\nLos MISMOS calendarios que el asistente telefonico (Carmen y Gisela) y la misma "
    "logica: horario de oficina, festivos, huecos libres y segunda comprobacion antes de escribir. "
    "Los nodos PrepararDatos, CalcularDisponibilidad y ValidarAntesDeInsertar son los ficheros "
    "del telefono (nodes/*.js) inyectados tal cual: un cambio de horario o de festivos vale para "
    "los dos canales.\n\nDelante va la guardia de alquiler: en alquiler no se agenda nunca.")


def wf_disponibilidad():
    return wf("[WA][SUB] BuscarDisponibilidadCalendario", [
        trigger_sub(AGENDA_IN),
        code_node("GuardiaDeAlquiler", code_wa("guardia_alquiler.js"), [200, 0]),
        if_node("¿Se puede agendar?", "={{ $json.seguir }}", "true", [420, 0]),
        set_node("Bloqueado", {"respuesta": ("string", "={{ $json.respuesta }}")}, [640, 180]),
        code_node("PrepararDatos", code_tel("bd_preparar.js"), [640, -40]),
        cal_getall("LeerAgenda", "={{ $json.calendario }}", DESDE_DIA,
                   "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).plus({days:8}).endOf('day').toISO() }}" % DIA,
                   [860, -40]),
        code_node("CalcularDisponibilidad", code_tel("bd_calcular.js"), [1080, -40]),
        code_node("FiltrarAntelacion", code_wa("filtrar_antelacion.js"), [1300, -40]),
        code_node("RespuestaParaElAgente", code_wa("herramienta_respuesta.js"), [1520, -40]),
        nota("Nota", NOTA_AGENDA + "\n\nSOLO CONSULTA: no reserva nada.", [640, -380], 520, 300),
    ], conn(("Start", 0, "GuardiaDeAlquiler", 0),
            ("GuardiaDeAlquiler", 0, "¿Se puede agendar?", 0),
            ("¿Se puede agendar?", 0, "PrepararDatos", 0),
            ("¿Se puede agendar?", 1, "Bloqueado", 0),
            ("PrepararDatos", 0, "LeerAgenda", 0),
            ("LeerAgenda", 0, "CalcularDisponibilidad", 0),
            ("CalcularDisponibilidad", 0, "FiltrarAntelacion", 0),
            ("FiltrarAntelacion", 0, "RespuestaParaElAgente", 0)))


def wf_confirmar(ids):
    v = "$('ValidarAntesDeInsertar').first().json"
    g = "$('GuardiaDeAlquiler').first().json"
    s = "$('Start').first().json"
    ini = "DateTime.fromFormat($json.fecha + ' ' + $json.hora,'yyyy-MM-dd HH:mm',{zone:'Europe/Madrid'})"
    aviso = {k: "={{ $json.%s }}" % k for k in
             ("accion", "destinatario", "referencia", "cliente_nombre", "cliente_telefono",
              "cita", "resumen", "detalle", "conversacion_id", "pasar_a_humano", "etiqueta")}
    return wf("[WA][SUB] confirmarCitaCalendario", [
        trigger_sub(AGENDA_IN + [("resumen", "string"), ("conversacion_id", "number")]),
        code_node("GuardiaDeAlquiler", code_wa("guardia_alquiler.js"), [200, 0]),
        if_node("¿Se puede agendar?", "={{ $json.seguir }}", "true", [420, 0]),
        set_node("Bloqueado", {"respuesta": ("string", "={{ $json.respuesta }}")}, [640, 200]),
        pg_query("¿YaReservada?", SQL_YA_RESERVADA,
                 "={{ [ String(%s.telefono || '').replace(/\\D/g,''), %s.body.fecha, %s.body.hora ] }}" % (g, g, g),
                 [640, -40], alwaysOutputData=True, onError="continueRegularOutput"),
        if_node("¿Ya la tiene?", "={{ String($json.cita_fecha || '') }}", "notEmpty", [860, -40], tipo="string"),
        set_node("RespuestaYaReservada", {"respuesta": ("string",
                 "cita_confirmada: true. Esta visita YA estaba registrada (mismo dia y hora): no se ha vuelto a "
                 "reservar ni a avisar. Diselo al cliente: ya la tiene, pendiente de que la asesora se la confirme.")},
                 [1080, -200]),
        code_node("RecuperarPeticion", "return [{ json: $('GuardiaDeAlquiler').first().json }];", [1080, -40]),
        code_node("PrepararDatos", code_tel("cc_preparar.js"), [1300, -40]),
        cal_getall("LeerAgendaDelDia", "={{ $json.calendario }}", DESDE_DIA,
                   "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).endOf('day').toISO() }}" % DIA,
                   [860, -40]),
        code_node("ValidarAntesDeInsertar", code_tel("cc_validar.js"), [1080, -40]),
        if_node("¿Puede crear?", "={{ $json.puede_crear }}", "true", [1300, -40]),
        code_node("RespuestaRechazo", code_wa("herramienta_respuesta.js"), [1520, 140]),
        # Numero de prueba: la agenda se ha consultado de verdad, pero la reserva
        # no se escribe (ni ocupa hueco, ni salta el recordatorio de 24 h).
        if_node("¿Es prueba?", "={{ $('GuardiaDeAlquiler').first().json.es_prueba }}", "true", [1520, -120]),
        set_node("SimularReserva", {"id": ("string", "PRUEBA-sin-agenda"), "prueba": ("boolean", "true")},
                 [1740, -260]),
        node("InsertarEnAgenda", "n8n-nodes-base.googleCalendar", {
            "calendar": {"__rl": True, "value": "={{ $json.calendario }}", "mode": "id"},
            "start": "={{ %s.toISO() }}" % ini,
            "end": "={{ %s.plus({hours:1}).toISO() }}" % ini,
            # Mismo titulo que las citas del telefono (asi buscarCitaPorTelefono
            # las encuentra venga de donde venga el cliente) y la marca de origen,
            # que es lo que mira el recordatorio de 24 h.
            "additionalFields": {
                "summary": "={{ $json.titulo }}",
                "description": ("={{ $json.descripcion + '\\n\\n%s\\nConversacion: ' + (%s.conversacion_id || '') "
                                "+ '\\nResumen: ' + String(%s.resumen || '').replace(/\\n/g, ' ') }}"
                                % (MARCA, s, s)),
            },
        }, [1740, -60], 1.3, credentials=CRED_CAL, onError="continueErrorOutput"),
        set_node("RespuestaErrorCalendario", {"respuesta": ("string",
                 "cita_confirmada: false. No he podido guardar la cita por un problema tecnico. NO le "
                 "digas al cliente que esta reservada: explicale que ha habido una incidencia y usa "
                 "avisarEquipo para que la asesora cierre la visita.")}, [1740, 60]),
        code_node("PrepararAvisoCita", code_wa("aviso_cita.js"), [1740, -120]),
        exec_sub("AvisarAlComercial", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 aviso, [1960, -120], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("MarcarCitaEnLaFicha", SQL_CITA,
                 "={{ [ %s.telefono_e164.replace(/\\D/g,''), %s.fecha, %s.hora ] }}" % (v, v, v), [2180, -120],
                 onError="continueRegularOutput", alwaysOutputData=True, executeOnce=True),
        code_node("RespuestaOK", code_wa("cita_respuesta.js"), [2400, -120]),
        nota("Nota", NOTA_AGENDA, [640, -420], 520, 300),
        nota("Nota2", "## En cuanto se agenda\n1. Se escribe en la agenda del comercial, con la "
             "marca *%s*.\n2. Se le avisa por WhatsApp (plantilla_aviso) y por correo.\n3. La "
             "conversacion pasa a *3-agendada_ia*.\n\n24 horas antes le llega el recordatorio: "
             "[WA] 3." % MARCA, [1740, -440], 460, 260),
    ], conn(("Start", 0, "GuardiaDeAlquiler", 0),
            ("GuardiaDeAlquiler", 0, "¿Se puede agendar?", 0),
            ("¿Se puede agendar?", 0, "¿YaReservada?", 0),
            ("¿Se puede agendar?", 1, "Bloqueado", 0),
            ("¿YaReservada?", 0, "¿Ya la tiene?", 0),
            ("¿Ya la tiene?", 0, "RespuestaYaReservada", 0), ("¿Ya la tiene?", 1, "RecuperarPeticion", 0),
            ("RecuperarPeticion", 0, "PrepararDatos", 0),
            ("PrepararDatos", 0, "LeerAgendaDelDia", 0),
            ("LeerAgendaDelDia", 0, "ValidarAntesDeInsertar", 0),
            ("ValidarAntesDeInsertar", 0, "¿Puede crear?", 0),
            ("¿Puede crear?", 0, "¿Es prueba?", 0),
            ("¿Es prueba?", 0, "SimularReserva", 0), ("¿Es prueba?", 1, "InsertarEnAgenda", 0),
            ("SimularReserva", 0, "PrepararAvisoCita", 0),
            ("¿Puede crear?", 1, "RespuestaRechazo", 0),
            ("InsertarEnAgenda", 0, "PrepararAvisoCita", 0),
            ("InsertarEnAgenda", 1, "RespuestaErrorCalendario", 0),
            ("PrepararAvisoCita", 0, "AvisarAlComercial", 0),
            ("AvisarAlComercial", 0, "MarcarCitaEnLaFicha", 0),
            ("MarcarCitaEnLaFicha", 0, "RespuestaOK", 0)))


def wf_cita_telefono():
    tmin, tmax = "={{ $json.desde_iso }}", "={{ $json.hasta_iso }}"
    return wf("[WA][SUB] buscarCitaPorTelefono", [
        trigger_sub([("telefono", "string")]),
        code_node("EnvolverPeticion", "return [{ json: { body: $input.first().json } }];", [200, 0]),
        code_node("NormalizarTelefono", code_tel("tel_normalizar.js"), [420, 0]),
        cal_getall("LeerAgendaCarmen", CALENDARIOS["Carmen"], tmin, tmax, [640, -120]),
        cal_getall("LeerAgendaGisela", CALENDARIOS["Gisela"], tmin, tmax, [640, 120]),
        node("Merge", "n8n-nodes-base.merge", {"numberInputs": 2}, [860, 0], 3.2),
        code_node("FormatearCitas", code_tel("tel_formatear.js"), [1080, 0]),
        code_node("RespuestaParaElAgente", code_wa("herramienta_respuesta.js"), [1300, 0]),
        nota("Nota", "## Visitas del cliente\nBusca en las agendas de Carmen y Gisela las visitas "
             "con el telefono de este WhatsApp, las haya agendado Sara por WhatsApp o por telefono. "
             "Es la logica del telefono (nodes/tel_*.js) tal cual. No modifica ni borra nada.",
             [420, -320], 460, 220),
    ], conn(("Start", 0, "EnvolverPeticion", 0), ("EnvolverPeticion", 0, "NormalizarTelefono", 0),
            ("NormalizarTelefono", 0, "LeerAgendaCarmen", 0),
            ("NormalizarTelefono", 0, "LeerAgendaGisela", 0),
            ("LeerAgendaCarmen", 0, "Merge", 0), ("LeerAgendaGisela", 0, "Merge", 1),
            ("Merge", 0, "FormatearCitas", 0), ("FormatearCitas", 0, "RespuestaParaElAgente", 0)))


# ===========================================================================
# AVISOS, ETIQUETAS Y CUALIFICACION
# ===========================================================================
AVISO_IN = [("accion", "string"), ("destinatario", "string"), ("referencia", "string"),
            ("municipio", "string"), ("cliente_nombre", "string"), ("cliente_telefono", "string"),
            ("cita", "string"), ("resumen", "string"), ("detalle", "string"),
            ("conversacion_id", "number"), ("pasar_a_humano", "boolean"), ("etiqueta", "string")]


def wf_aviso(ids):
    p = "$('Preparar').first().json"
    return wf("[WA][SUB] AvisoEquipo", [
        trigger_sub(AVISO_IN),
        code_node("Preparar", code_wa("aviso_preparar.js"), [200, 0]),
        http("EnviarWhatsApp", "POST", "%s/%s/messages" % (META_API, PHONE_ID), [420, 0],
             cred=CRED_META, body="={{ JSON.stringify($json.meta_body) }}",
             onError="continueRegularOutput", alwaysOutputData=True,
             retryOnFail=True, waitBetweenTries=3000, maxTries=2),
        node("EnviarCorreo", "n8n-nodes-base.gmail", {
            "sendTo": "={{ %s.email_para }}" % p,
            "subject": "={{ %s.email_asunto }}" % p,
            "emailType": "text",
            "message": "={{ %s.email_cuerpo }}" % p,
            "options": {"appendAttribution": False},
        }, [640, 0], 2.2, credentials=CRED_GMAIL, onError="continueRegularOutput", alwaysOutputData=True),
        exec_sub("Etiquetar", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ %s.conversacion_id }}" % p, "etiquetas": "={{ %s.etiquetas }}" % p},
                 [860, 0], {"conversacion_id": "number"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Resultado", code_wa("aviso_resultado.js"), [1080, 0]),
        nota("Nota", "## Todos los avisos al equipo salen de aqui\nVisita agendada, recordatorio de "
             "24 h, lead de alquiler que tiene que coger una persona, o lo que Sara no pueda resolver.\n\n"
             "- **WhatsApp**: plantilla_aviso directa a Meta (no por Chatwoot, para no abrir una "
             "conversacion de cliente con el comercial). {{1}} = el comercial, {{2}} = que tiene que "
             "hacer + el resumen de la conversacion + el enlace al chat.\n"
             "- **Correo**: el mismo aviso con el detalle, al comercial y a Paco. Por si Meta frena "
             "la plantilla (es de marketing).\n\nSi hay que pasar a una persona, pone 4-intervenir "
             "y la IA deja de contestar.", [200, -380], 560, 340),
    ], conn(("Start", 0, "Preparar", 0), ("Preparar", 0, "EnviarWhatsApp", 0),
            ("EnviarWhatsApp", 0, "EnviarCorreo", 0), ("EnviarCorreo", 0, "Etiquetar", 0),
            ("Etiquetar", 0, "Resultado", 0)))


def wf_etiquetar():
    url = "=" + CW_API + "/conversations/{{ $('Start').first().json.conversacion_id }}/labels"
    return wf("[WA][SUB] Etiquetar", [
        trigger_sub([("conversacion_id", "number"), ("etiquetas", "string"), ("forzar", "boolean")]),
        if_node("¿Hay algo que poner?", None, None, [200, 0], conds=[
            ("={{ Number($json.conversacion_id || 0) }}", "gt", 0, "number"),
            ("={{ String($json.etiquetas || '') }}", "notEmpty", None, "string")]),
        noop("NadaQueHacer", [420, 160]),
        http("LeerEtiquetas", "GET", url, [420, -40], cred=CRED_CHATWOOT,
             onError="continueRegularOutput", alwaysOutputData=True),
        code_node("UnirEtiquetas", code_wa("etiquetas_unir.js"), [640, -40]),
        http("GuardarEtiquetas", "POST", url, [860, -40], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ labels: $json.labels }) }}", onError="continueRegularOutput"),
        nota("Nota", "## Etiquetas del panel (las de Blue)\n**1-bienvenida_ia** plantilla enviada · "
             "**2-en_proceso** el cliente ha contestado · **3-agendada_ia** visita agendada de "
             "verdad · **4-intervenir** tiene que entrar una persona (la IA se calla).\n\nChatwoot "
             "SUSTITUYE la lista entera, asi que primero se leen las que hay y se manda la union. "
             "Las de estado van de una en una y nunca hacia atras.", [200, -330], 500, 260),
    ], conn(("Start", 0, "¿Hay algo que poner?", 0),
            ("¿Hay algo que poner?", 0, "LeerEtiquetas", 0),
            ("¿Hay algo que poner?", 1, "NadaQueHacer", 0),
            ("LeerEtiquetas", 0, "UnirEtiquetas", 0), ("UnirEtiquetas", 0, "GuardarEtiquetas", 0)))


def wf_cualificar(ids):
    a = "$('Preparar').first().json.aviso"
    valores = ("={{ [ $json.telefono_wa, $json.telefono_e164, $json.referencia, $json.nombre, "
               "$json.operacion, $json.es_alquiler, $json.asesora, $json.estado, $json.conversacion_id, "
               + ", ".join("$json.%s" % q for q in _Q) + " ] }}")
    return wf("[WA][SUB] guardarCualificacion", [
        trigger_sub([("telefono", "string"), ("nombre", "string"), ("referencia", "string"),
                     ("operacion", "string"), ("tiempo_buscando", "string"),
                     ("necesita_vender", "string"), ("personas", "string"), ("ingresos", "string"),
                     ("mascotas", "string"), ("entrada", "string"), ("duracion", "string"),
                     ("actividad", "string"), ("resumen", "string"), ("conversacion_id", "number")]),
        code_node("Preparar", code_wa("cualificar_preparar.js"), [200, 0]),
        pg_query("GuardarFicha", SQL_CUALIFICAR, valores, [420, 0],
                 onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Es alquiler?", "={{ $('Preparar').first().json.es_alquiler }}", "true", [640, 0]),
        exec_sub("PasarAlEquipo", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 {k: "={{ %s.%s }}" % (a, k) for k, _ in AVISO_IN if k not in ("municipio", "cita")},
                 [860, -100], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Respuesta", code_wa("cualificar_respuesta.js"), [1080, 0]),
        nota("Nota", "## Cualificacion\n**Compra**: dos preguntas (cuanto tiempo lleva buscando y si "
             "necesita vender para comprar). Se guardan y Sara ofrece la visita.\n\n**Alquiler**: las "
             "cuatro preguntas del telefono (personas, ingresos, mascotas y cuando entrar). Se "
             "guardan, se avisa al comercial por WhatsApp y la conversacion pasa a *4-intervenir*: "
             "en alquiler la IA no agenda, decide una persona.", [200, -330], 520, 270),
    ], conn(("Start", 0, "Preparar", 0), ("Preparar", 0, "GuardarFicha", 0),
            ("GuardarFicha", 0, "¿Es alquiler?", 0),
            ("¿Es alquiler?", 0, "PasarAlEquipo", 0), ("¿Es alquiler?", 1, "Respuesta", 0),
            ("PasarAlEquipo", 0, "Respuesta", 0)))


# ===========================================================================
# PRIMER MENSAJE: plantilla de bienvenida por Chatwoot
# ===========================================================================
def wf_plantilla(ids):
    contacto = "$('ElegirContacto').first().json.payload[0]"
    norm = "$('Normalizar').first().json"
    nuevo = "$('CrearContacto').first().json.payload.contact"
    return wf("[WA][SUB] EnviarPlantilla", [
        trigger_sub([("telefono", "string"), ("nombre", "string"), ("plantilla", "string"),
                     ("param1", "string"), ("param2", "string"), ("referencia", "string"),
                     ("operacion", "string"), ("portal", "string"), ("conversacion_id", "number")]),
        pg_query("EnlaceDeLaWeb", "select enlace from wa_cartera where upper(ref) = upper($1) limit 1;",
                 "={{ [ String($json.referencia || '') ] }}", [180, 160], alwaysOutputData=True,
                 onError="continueRegularOutput"),
        code_node("Normalizar", code_wa("plantilla_normalizar.js"), [180, 0]),
        if_node("¿Telefono valido?", "={{ $json.telefono_valido }}", "true", [400, 0]),
        set_node("SinTelefono", {"resultado": ("string", "Telefono no valido, no se envia nada")}, [620, 220]),
        if_node("¿Ya tengo conversacion?", "={{ Number($json.conversacion_id || 0) }}", "gt", [620, -20],
                der=0, tipo="number"),
        set_node("UsarConversacionDada", {"conversacion_id": ("number", "={{ $json.conversacion_id }}")}, [860, -180]),
        http("BuscarContacto", "GET", "=" + CW_API + "/contacts/search?q=%2B{{ $json.wa_id }}",
             [860, 40], cred=CRED_CHATWOOT),
        code_node("ElegirContacto", code_wa("plantilla_elegir_contacto.js"), [1080, 40]),
        if_node("¿Existe el contacto?", "={{ $json.payload }}", "notEmpty", [1300, 40], tipo="array"),
        http("ConversacionesDelContacto", "GET",
             "=" + CW_API + "/contacts/{{ $json.payload[0].id }}/conversations", [1520, -60], cred=CRED_CHATWOOT),
        if_node("¿Tiene conversacion?", "={{ $json.payload }}", "notEmpty", [1740, -60], tipo="array"),
        code_node("ElegirConversacion", code_wa("plantilla_elegir_conversacion.js"), [1960, -160]),
        http("CrearConversacion", "POST", "=" + CW_API + "/conversations", [1960, 40], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ source_id: %s.phone_number.replace('+',''), inbox_id: %s, "
                  "contact_id: %s.id }) }}" % (contacto, CW_INBOX, contacto)),
        set_node("IdConversacionCreada", {"conversacion_id": ("number", "={{ $json.id }}")}, [2180, 40]),
        http("CrearContacto", "POST", "=" + CW_API + "/contacts", [1520, 200], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ name: %s.nombre || %s.telefono_e164, phone_number: %s.telefono_e164, "
                  "identifier: %s.wa_id, inbox_id: %s, source_id: %s.wa_id, custom_attributes: { bot: 'On' } }) }}"
                  % (norm, norm, norm, norm, CW_INBOX, norm)),
        node("EsperaAltaContacto", "n8n-nodes-base.wait", {"amount": 3}, [1740, 200], 1.1,
             webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/espera-alta"))),
        http("CrearConversacionContactoNuevo", "POST", "=" + CW_API + "/conversations", [1960, 200],
             cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ source_id: %s.contact_inboxes[0].source_id, "
                  "inbox_id: %s.contact_inboxes[0].inbox.id, contact_id: %s.id }) }}" % (nuevo, nuevo, nuevo)),
        set_node("IdConversacionNueva", {"conversacion_id": ("number", "={{ $json.id }}")}, [2180, 200]),
        set_node("ConversacionLista", {"conversacion_id": ("number", "={{ $json.conversacion_id }}")}, [2400, 0]),
        http("PlantillaMeta", "GET", "%s/%s/message_templates" % (META_API, WABA_ID), [2620, 0],
             cred=CRED_META, query={"name": "={{ %s.plantilla }}" % norm},
             onError="continueRegularOutput", alwaysOutputData=True),
        code_node("RenderizarTexto", code_wa("plantilla_renderizar.js"), [2840, 0]),
        http("EnviarPlantilla", "POST", "=" + CW_API + "/conversations/{{ $json.conversacion_id }}/messages",
             [3060, 0], cred=CRED_CHATWOOT, body="={{ $json.body_mensaje }}",
             retryOnFail=True, waitBetweenTries=3000),
        pg_query("GuardarEnMemoriaAgente", "insert into n8n_chat_histories (session_id, message) values ($1, $2);",
                 "={{ [ %s.telefono_e164, JSON.stringify({ type: 'ai', content: "
                 "$('RenderizarTexto').first().json.contenido, tool_calls: [], additional_kwargs: {}, "
                 "response_metadata: {}, invalid_tool_calls: [] }) ] }}" % norm,
                 [3280, 0], onError="continueRegularOutput", alwaysOutputData=True),
        exec_sub("MarcarBienvenida", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $('ConversacionLista').first().json.conversacion_id }}",
                  "etiquetas": ETQ_BIENVENIDA}, [3500, 0], {"conversacion_id": "number"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        set_node("Resultado", {
            "resultado": ("string", "Plantilla enviada"),
            "conversacion_id": ("number", "={{ $('ConversacionLista').first().json.conversacion_id }}"),
            "contenido": ("string", "={{ $('RenderizarTexto').first().json.contenido }}"),
        }, [3720, 0]),
        nota("Nota", "## El primer mensaje\nLa plantilla de bienvenida se manda POR CHATWOOT para que "
             "la conversacion nazca en el panel.\n\n- Compra: *bienvenida_compra* (es)\n- Alquiler: "
             "*bienvenida_alquiler* (en: asi esta dada de alta en Meta)\n\n{{1}} el nombre del cliente, "
             "{{2}} el enlace del anuncio. Despues se siembra la memoria del agente con ese texto (asi "
             "Sara sabe lo que ya le ha dicho) y la conversacion pasa a *1-bienvenida_ia*.",
             [2620, -340], 540, 290),
    ], conn(("Start", 0, "EnlaceDeLaWeb", 0), ("EnlaceDeLaWeb", 0, "Normalizar", 0),
            ("Normalizar", 0, "¿Telefono valido?", 0),
            ("¿Telefono valido?", 0, "¿Ya tengo conversacion?", 0), ("¿Telefono valido?", 1, "SinTelefono", 0),
            ("¿Ya tengo conversacion?", 0, "UsarConversacionDada", 0),
            ("¿Ya tengo conversacion?", 1, "BuscarContacto", 0),
            ("BuscarContacto", 0, "ElegirContacto", 0), ("ElegirContacto", 0, "¿Existe el contacto?", 0),
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
            ("ConversacionLista", 0, "PlantillaMeta", 0), ("PlantillaMeta", 0, "RenderizarTexto", 0),
            ("RenderizarTexto", 0, "EnviarPlantilla", 0), ("EnviarPlantilla", 0, "GuardarEnMemoriaAgente", 0),
            ("GuardarEnMemoriaAgente", 0, "MarcarBienvenida", 0), ("MarcarBienvenida", 0, "Resultado", 0)))


def wf_esquema():
    return wf("[WA] 0 · Esquema de base de datos", [
        node("EjecutarAMano", "n8n-nodes-base.manualTrigger", {}, [-40, 0], 1),
        pg_query("CrearTablas", DDL, None, [200, 0]),
        nota("Nota", "## Ejecutar UNA vez antes de activar nada\n- **n8n_chat_histories**: la memoria "
             "del agente.\n- **wa_leads**: la ficha de cada lead (portal, inmueble, enlace, operacion, "
             "comercial y las respuestas de cualificacion).\n- **wa_avisos**: los recordatorios ya "
             "enviados, para no repetir.\n\nSe puede volver a ejecutar sin miedo: todo es 'if not "
             "exists'.", [200, -280], 460, 250),
    ], conn(("EjecutarAMano", 0, "CrearTablas", 0)))


def wf_leads(ids):
    j = "$('ParsearEmail').first().json"
    entradas = {k: "={{ %s.%s }}" % (j, v) for k, v in (
        ("telefono", "telefono_e164"), ("nombre", "nombre"), ("plantilla", "plantilla"),
        ("param1", "param1"), ("param2", "param2"), ("referencia", "referencia"),
        ("operacion", "operacion"), ("portal", "portal"))}
    entradas["conversacion_id"] = 0
    return wf("[WA] 1 · Leads de portales por correo", [
        node("CorreoNuevo", "n8n-nodes-base.gmailTrigger", {
            "pollTimes": {"item": [{"mode": "everyMinute"}]},
            "simple": False,
            "filters": {"q": "(from:idealista.com OR from:fotocasa.es OR from:habitaclia.com "
                             "OR subject:(solicitud OR contacto)) is:unread"},
            "options": {"downloadAttachments": False},
        }, [-40, 0], 1.2, credentials=CRED_GMAIL),
        code_node("ParsearEmail", code_wa("parsear_email.js"), [200, 0]),
        if_node("¿Hay telefono?", "={{ $json.se_puede_contactar }}", "true", [420, 0]),
        pg_query("AltaDelLead", SQL_ALTA_LEAD,
                 "={{ [ $json.telefono_wa, $json.telefono_e164, $json.referencia, $json.nombre, "
                 "$json.email_cliente, $json.portal, $json.operacion, $json.es_alquiler, $json.asesora, "
                 "$json.asunto, $json.enlace, $json.plantilla ] }}", [660, -120],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        if_node("¿Es un lead nuevo?", "={{ $json.id }}", "exists", [880, -120], tipo="number"),
        noop("YaLeEscribimos", [1100, 20]),
        exec_sub("EnviarBienvenida", ids.get("[WA][SUB] EnviarPlantilla", ""), "[WA][SUB] EnviarPlantilla",
                 entradas, [1100, -220], {"conversacion_id": "number"}, onError="continueRegularOutput"),
        pg_query("MarcarPlantillaEnviada", SQL_PLANTILLA_ENVIADA,
                 "={{ [ %s.telefono_wa, $json.conversacion_id || 0, %s.referencia ] }}" % (j, j),
                 [1340, -220], onError="continueRegularOutput", alwaysOutputData=True),
        code_node("AvisoSinTelefono", code_wa("lead_sin_telefono.js"), [660, 200]),
        node("AvisarAsesoraPorCorreo", "n8n-nodes-base.gmail", {
            "sendTo": "={{ $json.destinatarios }}", "subject": "={{ $json.asunto }}",
            "emailType": "text", "message": "={{ $json.cuerpo }}", "options": {"appendAttribution": False},
        }, [880, 200], 2.2, credentials=CRED_GMAIL, onError="continueRegularOutput"),
        nota("Nota", "## PENDIENTE: el buzon\nFalta la conexion al correo donde entran las "
             "solicitudes de los portales (%s). Cuando este, se cambia la credencial del nodo "
             "CorreoNuevo y se ajusta su filtro.\n\nCada correo: telefono, nombre, referencia y "
             "ENLACE del anuncio. Compra -> bienvenida_compra, alquiler -> bienvenida_alquiler." % BUZON,
             [-40, -320], 480, 250),
        nota("Nota2", "## No se escribe dos veces\nSi ya le escribimos por ese mismo inmueble, el alta "
             "no devuelve fila y no se manda nada. Pasados 30 dias si, porque ya es otra oportunidad."
             "\n\nSin telefono no hay WhatsApp: el aviso va por correo a la comercial.",
             [660, -440], 460, 210),
    ], conn(("CorreoNuevo", 0, "ParsearEmail", 0), ("ParsearEmail", 0, "¿Hay telefono?", 0),
            ("¿Hay telefono?", 0, "AltaDelLead", 0), ("¿Hay telefono?", 1, "AvisoSinTelefono", 0),
            ("AltaDelLead", 0, "¿Es un lead nuevo?", 0),
            ("¿Es un lead nuevo?", 0, "EnviarBienvenida", 0), ("¿Es un lead nuevo?", 1, "YaLeEscribimos", 0),
            ("EnviarBienvenida", 0, "MarcarPlantillaEnviada", 0),
            ("AvisoSinTelefono", 0, "AvisarAsesoraPorCorreo", 0)))


def wf_recordatorio(ids):
    aviso = {k: "={{ $json.%s }}" % k for k in
             ("accion", "destinatario", "referencia", "cliente_nombre", "cliente_telefono", "cita",
              "resumen", "conversacion_id")}
    aviso.update({"pasar_a_humano": False, "etiqueta": "", "detalle": "={{ $json.resumen }}"})
    ventana = ("const ahora = DateTime.now().setZone('Europe/Madrid');\n"
               "// Visitas que empiezan dentro de unas %d horas. La ventana es algo mas ancha que\n"
               "// la hora entre ejecuciones (y wa_avisos evita repetir), para no perder ninguna\n"
               "// aunque n8n este parado un rato.\n"
               "return [{ json: { desde_iso: ahora.plus({ hours: %d }).toISO(),\n"
               "                  hasta_iso: ahora.plus({ hours: %d }).toISO() } }];"
               % (RECORDAR_H, RECORDAR_H - 2, RECORDAR_H + 1))
    tmin, tmax = "={{ $json.desde_iso }}", "={{ $json.hasta_iso }}"
    return wf("[WA] 3 · Recordatorio 24 h al comercial", [
        node("CadaHora", "n8n-nodes-base.scheduleTrigger",
             {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}}, [-40, 0], 1.2),
        code_node("Ventana", ventana, [180, 0]),
        cal_getall("LeerAgendaCarmen", CALENDARIOS["Carmen"], tmin, tmax, [400, -120], query="WhatsApp"),
        cal_getall("LeerAgendaGisela", CALENDARIOS["Gisela"], tmin, tmax, [400, 120], query="WhatsApp"),
        node("Merge", "n8n-nodes-base.merge", {"numberInputs": 2}, [620, 0], 3.2),
        code_node("VisitasDeWhatsApp", code_wa("recordatorio_filtrar.js"), [840, 0]),
        pg_query("ApuntarAvisado", SQL_AVISADO, "={{ [ $json.evento_id ] }}", [1060, 0],
                 onError="continueRegularOutput"),
        code_node("SoloLosNuevos", code_wa("recordatorio_pendientes.js"), [1280, 0]),
        exec_sub("AvisarAlComercial", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 aviso, [1500, 0], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 cada_uno=True, onError="continueRegularOutput"),
        nota("Nota", "## Recordatorio al comercial\nCada hora mira las agendas de Carmen y Gisela y, a "
             "las visitas que agendo el asistente de WhatsApp (llevan *%s* en la descripcion) y "
             "empiezan en unas %d horas, les manda el recordatorio con la plantilla_aviso.\n\nCada "
             "visita se avisa una sola vez (tabla wa_avisos). Las visitas del telefono no se tocan."
             % (MARCA, RECORDAR_H), [180, -320], 500, 260),
    ], conn(("CadaHora", 0, "Ventana", 0), ("Ventana", 0, "LeerAgendaCarmen", 0),
            ("Ventana", 0, "LeerAgendaGisela", 0), ("LeerAgendaCarmen", 0, "Merge", 0),
            ("LeerAgendaGisela", 0, "Merge", 1), ("Merge", 0, "VisitasDeWhatsApp", 0),
            ("VisitasDeWhatsApp", 0, "ApuntarAvisado", 0), ("ApuntarAvisado", 0, "SoloLosNuevos", 0),
            ("SoloLosNuevos", 0, "AvisarAlComercial", 0)))


# ===========================================================================
# [WA] 2 · Asistente de WhatsApp
# ===========================================================================
CTX = "$('ContextoDelLead').first().json"
TEL_CLIENTE = "={{ %s.telefono_e164 }}" % CTX
CONV = "={{ %s.conversacion_id }}" % CTX


def de_la_ia(nombre, desc, tipo="string"):
    return "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('%s', `%s`, '%s') }}" % (nombre, desc, tipo)


def herramienta(nombre, ids, desc, valores, pos, tipos=None):
    """Nodo toolWorkflow: el modelo ve el NOMBRE del nodo como nombre de la herramienta."""
    sub = "[WA][SUB] " + nombre if nombre != "avisarEquipo" else "[WA][SUB] AvisoEquipo"
    tipos = tipos or {}
    esquema = [{"id": k, "displayName": k, "required": False, "defaultMatch": False, "display": True,
                "canBeUsedToMatch": True, "type": tipos.get(k, "string")} for k in valores]
    return node(nombre, "@n8n/n8n-nodes-langchain.toolWorkflow", {
        "description": desc,
        "workflowId": {"__rl": True, "value": ids.get(sub, ""), "mode": "list", "cachedResultName": sub},
        "workflowInputs": {"mappingMode": "defineBelow", "value": valores, "matchingColumns": [],
                           "schema": esquema, "attemptToConvertTypes": False, "convertFieldsToString": False},
    }, pos, 2.2)


REF_DESC = ("Referencia del inmueble tal y como la tengas (la de Datos del cliente o la que diga el "
            "cliente), con todas sus letras y numeros. Ejemplo: BN-1547-V.")


def herramientas(ids):
    x, dx, y = 1900, 200, 360
    agenda = {
        "nombre": de_la_ia("nombre", "Nombre del cliente. Vacio si no lo sabes."),
        "telefono": TEL_CLIENTE,
        "referencia": de_la_ia("referencia", REF_DESC),
        "tipo_transaccion": de_la_ia("tipo_transaccion", "compra o alquiler. Si la referencia acaba en -A es alquiler."),
        "fecha": de_la_ia("fecha", "Fecha en formato yyyy-MM-dd, con guiones. Ejemplo: 2026-10-14. Para "
                          "'manana' o 'el jueves', calculala con la fecha actual de Datos del cliente."),
        "hora": de_la_ia("hora", "Hora en formato HH:mm de 24 horas. Ejemplo: 17:30."),
    }
    return [
        herramienta("buscarPorReferencia", ids,
            "Devuelve la ficha COMPLETA de un inmueble de la cartera: tipo, operacion, zona, direccion (si "
            "consta), precio, superficie, habitaciones, banos, caracteristicas y la descripcion entera del "
            "anuncio. Usala antes de contestar cualquier duda del inmueble. Lo que no este en la ficha, no "
            "lo sabes.",
            {"referencia": de_la_ia("referencia", REF_DESC)}, [x, y]),
        herramienta("buscarPorDireccion", ids,
            "Busca un inmueble por la calle o direccion que diga el cliente. Solo si no tienes la "
            "referencia. Devuelve 'encontrado' y 'fiabilidad'; si no lo encuentra, no le sueltes un listado.",
            {"direccion": de_la_ia("direccion", "La direccion tal cual la ha escrito el cliente."),
             "municipio": de_la_ia("municipio", "Municipio, solo si ya lo sabes. Vacio si no."),
             "operacion": de_la_ia("operacion", "venta o alquiler, solo si ya lo sabes. Vacio si no.")},
            [x + dx, y]),
        herramienta("buscarInmuebles", ids,
            "Busca en TODA la cartera actual con los filtros que diga el cliente. Manda solo lo que haya "
            "dicho; lo demas vacio o 0. Devuelve cuantos hay y los que mejor encajan.",
            {"operacion": de_la_ia("operacion", "venta o alquiler."),
             "municipio": de_la_ia("municipio", "Municipio tal como lo diga el cliente. Vacio si no lo ha dicho."),
             "zona": de_la_ia("zona", "Barrio o zona (centro, playa, Grao...). Vacio si no."),
             "tipo": de_la_ia("tipo", "piso, casa, atico, local, terreno, garaje o trastero. Vacio si le da igual."),
             "habitaciones_min": de_la_ia("habitaciones_min", "Habitaciones minimas. 0 si le da igual.", "number"),
             "banos_min": de_la_ia("banos_min", "Banos minimos. 0 si le da igual.", "number"),
             "precio_min": de_la_ia("precio_min", "Precio minimo en euros, entero. 0 si no lo ha dicho.", "number"),
             "precio_max": de_la_ia("precio_max", "Precio maximo en euros, entero. 0 si no lo ha dicho.", "number"),
             "superficie_min": de_la_ia("superficie_min", "Metros cuadrados minimos. 0 si no.", "number"),
             "extras": de_la_ia("extras", "Extras que pide, separados por comas: piscina, terraza, garaje, "
                                "ascensor, vistas al mar... Vacio si ninguno."),
             "excluir": de_la_ia("excluir", "Referencias que ya le has ensenado, separadas por comas. Vacio si ninguna."),
             "limite": de_la_ia("limite", "Cuantos devolver como mucho. Normalmente 5.", "number")},
            [x + 2 * dx, y], {k: "number" for k in ("habitaciones_min", "banos_min", "precio_min",
                                                    "precio_max", "superficie_min", "limite")}),
        herramienta("recomendarSimilares", ids,
            "Busca en la cartera los inmuebles mas parecidos a uno dado (misma operacion, zona, tipo, "
            "habitaciones y precio parecidos). Usala cuando el que pidio ya no esta, no le encaja o te pide "
            "alternativas.",
            {"referencia": de_la_ia("referencia", REF_DESC),
             "excluir": de_la_ia("excluir", "Referencias que ya le has ensenado, separadas por comas. Vacio si ninguna."),
             "precio_max": de_la_ia("precio_max", "Si lo quiere mas barato: precio maximo en euros, entero (por "
                                    "ejemplo el precio del suyo). 0 si no ha hablado de precio.", "number"),
             "limite": de_la_ia("limite", "Cuantos devolver. Normalmente 3.", "number")},
            [x + 3 * dx, y], {"limite": "number", "precio_max": "number"}),
        herramienta("BuscarDisponibilidadCalendario", ids,
            "SOLO COMPRA. Comprueba si se puede hacer una visita de una hora ese dia y a esa hora en la agenda "
            "del comercial, y devuelve las horas LIBRES en 'alternativas'. Valida horario de oficina y "
            "festivos. Solo consulta, no reserva. Si el cliente solo dice el dia, deja la hora vacia. En "
            "ALQUILER esta bloqueada.",
            {**agenda, "modo": "consulta"}, [x, y + 180]),
        herramienta("confirmarCitaCalendario", ids,
            "SOLO COMPRA. Crea la visita en la agenda del comercial y le avisa por WhatsApp. Usala solo "
            "despues de que BuscarDisponibilidadCalendario haya dicho que hay hueco y el cliente haya "
            "aceptado ese dia y esa hora. Solo di que esta registrada si devuelve cita_confirmada: true, y "
            "siempre como PRE-RESERVA. En ALQUILER esta bloqueada.",
            {**agenda, "modo": "reserva", "conversacion_id": CONV,
             "resumen": de_la_ia("resumen", "Una o dos lineas para el comercial: cuanto lleva buscando, si "
                                 "necesita vender, que le ha interesado. Sin saltos de linea.")},
            [x + dx, y + 180], {"conversacion_id": "number"}),
        herramienta("buscarCitaPorTelefono", ids,
            "Busca las visitas que tiene este cliente en las agendas de Carmen y Gisela. Usala cuando "
            "pregunte cuando es su visita, si esta confirmada, o quiera cambiarla o anularla. No modifica nada.",
            {"telefono": TEL_CLIENTE}, [x + 2 * dx, y + 180]),
        herramienta("guardarCualificacion", ids,
            "Guarda las respuestas de cualificacion. COMPRA: cuando tengas las dos (tiempo buscando y si "
            "necesita vender); despues ofrece la visita. ALQUILER: cuando tengas las cuatro (personas, "
            "ingresos, mascotas, entrada); avisa al comercial y pasa la conversacion a una persona.",
            {"telefono": TEL_CLIENTE, "conversacion_id": CONV,
             "nombre": de_la_ia("nombre", "Nombre del cliente. Vacio si no lo sabes."),
             "referencia": de_la_ia("referencia", REF_DESC),
             "operacion": de_la_ia("operacion", "venta o alquiler."),
             "tiempo_buscando": de_la_ia("tiempo_buscando", "Solo compra. Cuanto tiempo lleva buscando, con sus palabras. Vacio si no aplica."),
             "necesita_vender": de_la_ia("necesita_vender", "Solo compra. Si necesita vender para comprar, con sus palabras. Vacio si no aplica."),
             "personas": de_la_ia("personas", "Solo alquiler. Para cuantas personas. 'no facilitado' si no quiso decirlo."),
             "ingresos": de_la_ia("ingresos", "Solo alquiler. Lo que dijo de ingresos fijos, nomina o contrato, sin valorarlo."),
             "mascotas": de_la_ia("mascotas", "Solo alquiler. Si conviven con mascotas y cuales."),
             "entrada": de_la_ia("entrada", "Solo alquiler. Para que fecha necesitan entrar."),
             "duracion": de_la_ia("duracion", "Solo alquiler. Todo el ano o temporada, si lo ha dicho."),
             "actividad": de_la_ia("actividad", "Solo locales, oficinas o traspasos: para que actividad."),
             "resumen": de_la_ia("resumen", "Resumen de la conversacion en dos o tres frases, sin saltos de linea.")},
            [x + 3 * dx, y + 180], {"conversacion_id": "number"}),
        herramienta("avisarEquipo", ids,
            "Manda un aviso por WhatsApp (y copia por correo) a la asesora o a Laurence, con el resumen de la "
            "conversacion y lo que tiene que hacer. Usala cuando el cliente pida una persona, cuando no puedas "
            "resolver algo, cuando quiera cambiar o anular una visita, o cuando la visita no se cierre.",
            {"accion": de_la_ia("accion", "INTERVENIR si tiene que entrar una persona en la conversacion; "
                                "AVISO si basta con que lo sepa y le conteste."),
             "destinatario": de_la_ia("destinatario", "Carmen, Gisela o Laurence. La comercial de Datos del "
                                      "cliente; Laurence para ventas en curso, firmas, quejas o si no hay comercial."),
             "referencia": de_la_ia("referencia", "Referencia del inmueble del que se trata. Vacio si ninguno."),
             "municipio": de_la_ia("municipio", "Municipio si no hay referencia. Vacio si no."),
             "cliente_nombre": de_la_ia("cliente_nombre", "Nombre del cliente."),
             "cliente_telefono": TEL_CLIENTE,
             "cita": "",
             "resumen": de_la_ia("resumen", "Dos o tres frases: que pide el cliente, de que inmueble, que le "
                                 "has contestado y que queda pendiente. Sin saltos de linea. No inventes."),
             "detalle": de_la_ia("detalle", "El mismo resumen, con mas detalle si hace falta."),
             "conversacion_id": CONV,
             "pasar_a_humano": de_la_ia("pasar_a_humano", "true si a partir de ahora tiene que llevar la "
                                        "conversacion una persona y tu dejas de contestar.", "boolean"),
             "etiqueta": ""},
            [x, y + 360], {"conversacion_id": "number", "pasar_a_humano": "boolean"}),
    ]


def wf_asistente(ids):
    ent = "$('EntradaMensaje').first().json"
    mensajes_url = "=" + CW_API + "/conversations/{{ %s.conversacion_id }}/messages" % CTX
    modelo = node("ModeloOpenAI", "@n8n/n8n-nodes-langchain.lmChatOpenAi", {
        "model": {"__rl": True, "value": MODELO, "mode": "list", "cachedResultName": MODELO},
        "options": {"temperature": 0.3},
    }, [1500, 360], 1.2)
    if CRED_OPENAI:
        modelo["credentials"] = CRED_OPENAI
    tools = herramientas(ids)
    nodos = [
        node("Webhook", "n8n-nodes-base.webhook", {"httpMethod": "POST", "path": "wa-asistente", "options": {}},
             [-40, 0], 2.1, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/webhook"))),
        code_node("EntradaMensaje", code_wa("asistente_entrada.js"), [180, 0]),
        if_node("¿Contestar?", "={{ $json.contestar }}", "true", [400, 0]),
        noop("NoContestar", [620, 180]),
        node("GuardarBuffer", "n8n-nodes-base.redis", {
            "operation": "push", "list": "={{ $json.clave_buffer }}", "messageData": "={{ $json.contenido }}",
        }, [620, -60], 1, credentials=CRED_REDIS),
        node("Espera", "n8n-nodes-base.wait", {"amount": ESPERA}, [840, -60], 1.1,
             webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/espera"))),
        node("LeerBuffer", "n8n-nodes-base.redis", {
            "operation": "get", "propertyName": "message", "key": "={{ %s.clave_buffer }}" % ent, "options": {},
        }, [1060, -60], 1, credentials=CRED_REDIS, alwaysOutputData=True),
        if_node("¿Soy el ultimo?", "={{ $json.message[0] }}", "equals", [1280, -60],
                der="={{ %s.contenido }}" % ent, tipo="string"),
        noop("OtroMensajeMasNuevo", [1500, 100]),
        node("BorrarBuffer", "n8n-nodes-base.redis", {"operation": "delete", "key": "={{ %s.clave_buffer }}" % ent},
             [1500, -160], 1, credentials=CRED_REDIS, onError="continueRegularOutput"),
        code_node("JuntarMensajes", code_wa("asistente_juntar.js"), [1720, -160]),
        code_node("EstadoEnProceso", code_wa("estado_en_proceso.js"), [1940, -340]),
        if_node("¿Marcar en proceso?", "={{ $json.marcar }}", "true", [2160, -340]),
        exec_sub("MarcarEnProceso", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $json.conversacion_id }}", "etiquetas": "={{ $json.etiquetas }}"},
                 [2380, -400], {"conversacion_id": "number"}, onError="continueRegularOutput"),
        pg_query("LeerFichaDelLead", SQL_FICHA, "={{ [ $('JuntarMensajes').first().json.telefono_wa ] }}",
                 [1940, -160], alwaysOutputData=True, onError="continueRegularOutput"),
        # La ficha completa del inmueble del lead va en el contexto de cada turno
        leer_cartera("LeerCartera", [2160, -160]),
        leer_hoja("LeerDirecciones", "Direcciones", [2380, -160], executeOnce=True),
        code_node("ContextoDelLead", code_wa("asistente_contexto.js", cartera=True), [2600, -160]),
        node("Agente", "@n8n/n8n-nodes-langchain.agent", {
            "promptType": "define",
            "text": "=Datos del cliente:\n{{ $json.contexto }}\n"
                    "- Fecha y hora actual: {{ $now.setZone('Europe/Madrid').toFormat(\"cccc dd/MM/yyyy HH:mm\", "
                    "{ locale: 'es' }) }}\n\nMensaje del cliente:\n{{ $json.mensaje }}",
            "options": {"systemMessage": "=" + PROMPT, "maxIterations": 12},
        }, [2840, -160], 1.8, onError="continueErrorOutput"),
        modelo,
        node("MemoriaPostgres", "@n8n/n8n-nodes-langchain.memoryPostgresChat", {
            "sessionIdType": "customKey", "sessionKey": "={{ %s.telefono_e164 }}" % CTX, "contextWindowLength": 40,
        }, [1700, 360], 1.3, credentials=CRED_PG),
        code_node("DividirRespuesta", code_wa("asistente_dividir.js"), [3100, -260]),
        http("EnviarMensajes", "POST", mensajes_url, [3340, -260], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ content: $json.mensaje, message_type: 'outgoing', private: false }) }}",
             retryOnFail=True, waitBetweenTries=3000,
             options={"batching": {"batch": {"batchSize": 1, "batchInterval": 2500}}}),
        http("AvisoDeFallo", "POST", mensajes_url, [3100, -20], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ content: 'Te atendemos enseguida, dame un momento.', "
                  "message_type: 'outgoing', private: false }) }}", onError="continueRegularOutput"),
        nota("Nota", "## Como llega el mensaje\nChatwoot avisa por webhook de cada mensaje. La IA NO "
             "contesta si: lo escribio la agencia, no hay texto (audio o imagen), la conversacion esta "
             "resuelta, tiene la etiqueta **4-intervenir**, el atributo **bot** esta en Off, o escribe "
             "un movil del equipo (los avisos salen de esta misma linea).", [180, -340], 480, 250),
        nota("Nota2", "## Los %d segundos\nEl cliente escribe en varios mensajes seguidos. Se apilan en "
             "Redis, se espera y solo sigue el turno del MAS NUEVO: se contesta una vez, con todo. Es el "
             "mismo mecanismo que Blue." % ESPERA, [840, -360], 440, 220),
        nota("Nota3", "## Proyecto aparte del telefono\nNinguna herramienta llama a un workflow [TEL]. "
             "Leen el mismo Sheet de cartera y los mismos calendarios, y reutilizan la logica de agenda "
             "del telefono inyectando sus ficheros, pero en workflows [WA][SUB] propios.\n\nMemoria en "
             "Postgres: la sesion es el telefono y el primer mensaje lo siembra la plantilla.",
             [1900, 820], 520, 250),
        nota("Nota4", "## PENDIENTE antes de activar\n1. Credencial de OpenAI en ModeloOpenAI.\n2. Buzon "
             "de correo de los leads en [WA] 1.\n3. Ejecutar una vez [WA] 0.\n4. Webhook de Chatwoot -> "
             "este Webhook (wa-asistente).\n5. Activar [WA] 2, [WA] 3 y por ultimo [WA] 1.",
             [-40, 300], 440, 250),
    ] + tools
    principal = conn(
        ("Webhook", 0, "EntradaMensaje", 0), ("EntradaMensaje", 0, "¿Contestar?", 0),
        ("¿Contestar?", 0, "GuardarBuffer", 0), ("¿Contestar?", 1, "NoContestar", 0),
        ("GuardarBuffer", 0, "Espera", 0), ("Espera", 0, "LeerBuffer", 0),
        ("LeerBuffer", 0, "¿Soy el ultimo?", 0),
        ("¿Soy el ultimo?", 0, "BorrarBuffer", 0), ("¿Soy el ultimo?", 1, "OtroMensajeMasNuevo", 0),
        ("BorrarBuffer", 0, "JuntarMensajes", 0),
        # primero la etiqueta (rapido) y luego el agente
        ("JuntarMensajes", 0, "EstadoEnProceso", 0), ("JuntarMensajes", 0, "LeerFichaDelLead", 0),
        ("EstadoEnProceso", 0, "¿Marcar en proceso?", 0), ("¿Marcar en proceso?", 0, "MarcarEnProceso", 0),
        ("LeerFichaDelLead", 0, "LeerCartera", 0), ("LeerCartera", 0, "LeerDirecciones", 0),
        ("LeerDirecciones", 0, "ContextoDelLead", 0), ("ContextoDelLead", 0, "Agente", 0),
        ("Agente", 0, "DividirRespuesta", 0), ("Agente", 1, "AvisoDeFallo", 0),
        ("DividirRespuesta", 0, "EnviarMensajes", 0))
    ai = ai_conn("Agente", [("ModeloOpenAI", "ai_languageModel"), ("MemoriaPostgres", "ai_memory")]
                 + [(t["name"], "ai_tool") for t in tools])
    return wf("[WA] 2 · Asistente de WhatsApp", nodos, fusionar(principal, ai))


# ===========================================================================
# [WA] 4 · Cartera desde eGO
# ===========================================================================
FEED_EGO = "http://feeds.transporter.janeladigital.com/423E0F5F-30FC-4E01-8FE1-99BD7E14B021/0500013012.xml"


def wf_cartera_ego():
    return wf("[WA] 4 · Cartera desde eGO", [
        node("CadaHora", "n8n-nodes-base.scheduleTrigger",
             {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}}, [-40, -80], 1.2),
        node("RefrescarAhora", "n8n-nodes-base.webhook", {
            "httpMethod": "POST", "path": "wa-refrescar-cartera", "authentication": "headerAuth", "options": {}},
            [-40, 120], 2.1, credentials=CRED_LEAD_MANUAL,
            webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/refrescar-cartera"))),
        http("DescargarFeed", "GET", FEED_EGO, [200, 0], retryOnFail=True, waitBetweenTries=5000,
             options={"timeout": 60000}),
        node("LeerXML", "n8n-nodes-base.xml", {"options": {}}, [420, 0], 1),
        code_node("Mapear", code_wa("cartera_mapear.js"), [640, 0]),
        if_node("¿Feed correcto?", "={{ $json.ok }}", "true", [860, 0]),
        pg_query("CrearTablasSiFaltan", DDL, None, [1080, -80], executeOnce=True),
        pg_query("GuardarCartera", SQL_GUARDAR_CARTERA,
                 "={{ [ JSON.stringify($('Mapear').first().json.filas) ] }}", [1300, -80], executeOnce=True),
        noop("FeedRotoNoSeToca", [1080, 120]),
        nota("Nota", "## La cartera de WhatsApp\nCada hora lee el MISMO feed de eGO que usa el telefono "
             "(solo lectura) y lo guarda COMPLETO en la tabla *wa_cartera*:\n\n"
             "- la descripcion entera (la hoja del telefono la corta a 500 caracteres y se pierden "
             "cosas como el parking, el trastero o los honorarios);\n"
             "- la superficie, las caracteristicas en espanol;\n"
             "- el ENLACE de la web de cada inmueble (la web abre la ficha con el id del feed sin el "
             "05 del principio).\n\n"
             "Lo vendido o retirado se borra. Si el feed llega vacio o roto, no se toca nada.\n\n"
             "Para refrescarla al momento: POST a */webhook/wa-refrescar-cartera* con la clave de la "
             "credencial *WA lead a mano*.", [200, -420], 560, 360),
    ], conn(("CadaHora", 0, "DescargarFeed", 0), ("RefrescarAhora", 0, "DescargarFeed", 0),
            ("DescargarFeed", 0, "LeerXML", 0), ("LeerXML", 0, "Mapear", 0),
            ("Mapear", 0, "¿Feed correcto?", 0), ("¿Feed correcto?", 0, "CrearTablasSiFaltan", 0),
            ("CrearTablasSiFaltan", 0, "GuardarCartera", 0),
            ("¿Feed correcto?", 1, "FeedRotoNoSeToca", 0)))


# ===========================================================================
# UTILIDADES: lead a mano y prueba sin IA
# ===========================================================================
def wf_lead_manual(ids):
    j = "$('PrepararLead').first().json"
    entradas = {k: "={{ %s.%s }}" % (j, v) for k, v in (
        ("telefono", "telefono_e164"), ("nombre", "nombre"), ("plantilla", "plantilla"),
        ("param1", "param1"), ("param2", "param2"), ("referencia", "referencia"),
        ("operacion", "operacion"), ("portal", "portal"))}
    entradas["conversacion_id"] = 0
    return wf("[WA] 9 · Lead a mano", [
        node("Webhook", "n8n-nodes-base.webhook", {
            "httpMethod": "POST", "path": "wa-lead-manual", "authentication": "headerAuth",
            "responseMode": "responseNode", "options": {}}, [-40, 0], 2.1,
            credentials=CRED_LEAD_MANUAL, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/lead-manual"))),
        code_node("PrepararLead", code_wa("lead_manual.js"), [180, 0]),
        if_node("¿Datos correctos?", "={{ $json.valido }}", "true", [400, 0]),
        node("RespuestaError", "n8n-nodes-base.respondToWebhook", {
            "respondWith": "json", "responseBody": "={{ { ok: false, error: $json.error } }}",
            "options": {"responseCode": 400}}, [620, 180], 1.5),
        # Las tablas se crean si no existen: el mismo SQL que [WA] 0, que se
        # puede repetir sin miedo.
        pg_query("CrearTablasSiFaltan", DDL, None, [620, -40], executeOnce=True),
        # Reiniciar: fuera la memoria de la conversacion anterior y las fichas sin
        # inmueble que hayan quedado de escribir sin pasar por un portal.
        pg_query("ReiniciarMemoria",
                 "with memoria as (delete from n8n_chat_histories where session_id = $1 and $2::boolean returning 1) "
                 "delete from wa_leads where telefono_wa = $3 and referencia = '' and $2::boolean;",
                 "={{ [ %s.telefono_e164, %s.reiniciar, %s.telefono_wa ] }}" % (j, j, j), [840, -40],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        pg_query("AltaDelLead", SQL_ALTA_MANUAL,
                 "={{ [ %s.telefono_wa, %s.telefono_e164, %s.referencia, %s.nombre, %s.email_cliente, "
                 "%s.portal, %s.operacion, %s.es_alquiler, %s.asesora, %s.asunto, %s.enlace, %s.plantilla ] }}"
                 % ((j,) * 12), [1060, -40]),
        exec_sub("EnviarBienvenida", ids.get("[WA][SUB] EnviarPlantilla", ""), "[WA][SUB] EnviarPlantilla",
                 entradas, [1280, -40], {"conversacion_id": "number"}),
        pg_query("MarcarPlantillaEnviada", SQL_PLANTILLA_ENVIADA,
                 "={{ [ %s.telefono_wa, $json.conversacion_id || 0, %s.referencia ] }}" % (j, j),
                 [1500, -40], alwaysOutputData=True, onError="continueRegularOutput"),
        # Al reiniciar, la conversacion vuelve a 1-bienvenida_ia (y sin 4-intervenir)
        exec_sub("EtiquetaDeInicio", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $('EnviarBienvenida').first().json.conversacion_id }}",
                  "etiquetas": ETQ_BIENVENIDA, "forzar": "={{ %s.reiniciar }}" % j},
                 [1720, -40], {"conversacion_id": "number", "forzar": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        node("RespuestaOK", "n8n-nodes-base.respondToWebhook", {
            "respondWith": "json",
            "responseBody": "={{ { ok: true, plantilla: %s.plantilla, telefono: %s.telefono_e164, "
                            "referencia: %s.referencia, asesora: %s.asesora, "
                            "conversacion_id: $('EnviarBienvenida').first().json.conversacion_id, "
                            "texto: $('EnviarBienvenida').first().json.contenido } }}" % (j, j, j, j),
            "options": {"responseCode": 200}}, [1940, -40], 1.5),
        nota("Nota", "## Dar de alta un lead a mano\nPara leads que entran por telefono o en persona, "
             "y para pruebas. Hace lo mismo que [WA] 1 cuando llega un correo: ficha del lead, "
             "plantilla de bienvenida (compra o alquiler) y memoria del agente.\n\n"
             "`POST /webhook/wa-lead-manual` con la cabecera de la credencial *WA lead a mano* y:\n"
             "`{ \"telefono\", \"nombre\", \"referencia\", \"enlace\", \"reiniciar\" }`\n\n"
             "*reiniciar: true* borra la memoria de la conversacion anterior con ese telefono.",
             [180, -360], 520, 290),
    ], conn(("Webhook", 0, "PrepararLead", 0), ("PrepararLead", 0, "¿Datos correctos?", 0),
            ("¿Datos correctos?", 0, "CrearTablasSiFaltan", 0), ("¿Datos correctos?", 1, "RespuestaError", 0),
            ("CrearTablasSiFaltan", 0, "ReiniciarMemoria", 0), ("ReiniciarMemoria", 0, "AltaDelLead", 0),
            ("AltaDelLead", 0, "EnviarBienvenida", 0), ("EnviarBienvenida", 0, "MarcarPlantillaEnviada", 0),
            ("MarcarPlantillaEnviada", 0, "EtiquetaDeInicio", 0), ("EtiquetaDeInicio", 0, "RespuestaOK", 0)))


def wf_prueba_contexto():
    """La primera mitad del asistente, sin IA y sin contestar: recibe el mensaje
    como [WA] 2 y monta el contexto EXACTO que leeria Sara. Para probar sin OpenAI."""
    w = wf("[WA] 8 · Prueba sin IA (contexto)", [
        node("Webhook", "n8n-nodes-base.webhook", {"httpMethod": "POST", "path": "wa-asistente", "options": {}},
             [-40, 0], 2.1, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/prueba-contexto"))),
        code_node("EntradaMensaje", code_wa("asistente_entrada.js"), [180, 0]),
        if_node("¿Contestaria?", "={{ $json.contestar }}", "true", [400, 0]),
        noop("NoContestaria", [620, 180]),
        code_node("JuntarMensajes", "const e = $('EntradaMensaje').first().json;\n"
                  "return [{ json: { ...e, mensaje: e.contenido, numero_de_mensajes: 1 } }];", [620, -40]),
        pg_query("LeerFichaDelLead", SQL_FICHA, "={{ [ $json.telefono_wa ] }}", [840, -40],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        leer_cartera("LeerCartera", [1060, -40]),
        leer_hoja("LeerDirecciones", "Direcciones", [1280, -40], executeOnce=True),
        code_node("ContextoDelLead", code_wa("asistente_contexto.js", cartera=True), [1500, -40]),
        nota("Nota", "## Solo para probar, sin OpenAI\nEscucha en la MISMA ruta que [WA] 2 "
             "(wa-asistente) y monta el contexto exacto que leeria Sara, pero no contesta a nadie.\n\n"
             "**No pueden estar los dos activos a la vez**: para poner en marcha el asistente, "
             "desactivar este y activar [WA] 2.", [180, -320], 480, 240),
    ], conn(("Webhook", 0, "EntradaMensaje", 0), ("EntradaMensaje", 0, "¿Contestaria?", 0),
            ("¿Contestaria?", 0, "JuntarMensajes", 0), ("¿Contestaria?", 1, "NoContestaria", 0),
            ("JuntarMensajes", 0, "LeerFichaDelLead", 0), ("LeerFichaDelLead", 0, "LeerCartera", 0),
            ("LeerCartera", 0, "LeerDirecciones", 0), ("LeerDirecciones", 0, "ContextoDelLead", 0)))
    w["settings"] = dict(SETTINGS, saveDataSuccessExecution="all", saveManualExecutions=True)
    return w


# ===========================================================================
# Construccion y despliegue
# ===========================================================================
ORDEN = [
    "[WA][SUB] Etiquetar",
    "[WA][SUB] AvisoEquipo",
    "[WA][SUB] buscarPorReferencia",
    "[WA][SUB] buscarPorDireccion",
    "[WA][SUB] buscarInmuebles",
    "[WA][SUB] recomendarSimilares",
    "[WA][SUB] BuscarDisponibilidadCalendario",
    "[WA][SUB] confirmarCitaCalendario",
    "[WA][SUB] buscarCitaPorTelefono",
    "[WA][SUB] guardarCualificacion",
    "[WA][SUB] EnviarPlantilla",
    "[WA] 0 · Esquema de base de datos",
    "[WA] 1 · Leads de portales por correo",
    "[WA] 2 · Asistente de WhatsApp",
    "[WA] 3 · Recordatorio 24 h al comercial",
    "[WA] 4 · Cartera desde eGO",
    "[WA] 8 · Prueba sin IA (contexto)",
    "[WA] 9 · Lead a mano",
]

# Workflows de la primera version que se reaprovechan con su nombre nuevo, para
# no dejar huerfanos en n8n (estan desactivados y nadie los usa).
RENOMBRADOS = {
    "[WA][SUB] BuscarPorReferencia": "[WA][SUB] buscarPorReferencia",
    "[WA][SUB] BuscarPorDireccion": "[WA][SUB] buscarPorDireccion",
    "[WA][SUB] BuscarInmuebles": "[WA][SUB] buscarInmuebles",
    "[WA][SUB] ConsultarHuecos": "[WA][SUB] BuscarDisponibilidadCalendario",
    "[WA][SUB] ConfirmarVisita": "[WA][SUB] confirmarCitaCalendario",
    "[WA][SUB] ConsultarCita": "[WA][SUB] buscarCitaPorTelefono",
    "[WA][SUB] AvisarAsesora": "[WA][SUB] AvisoEquipo",
    "[WA][SUB] CualificarLead": "[WA][SUB] guardarCualificacion",
}


def construir(ids):
    wfs = {
        "[WA][SUB] Etiquetar": wf_etiquetar(),
        "[WA][SUB] AvisoEquipo": wf_aviso(ids),
        "[WA][SUB] buscarPorReferencia": wf_ficha(),
        "[WA][SUB] buscarPorDireccion": wf_direccion(),
        "[WA][SUB] buscarInmuebles": wf_buscar(),
        "[WA][SUB] recomendarSimilares": wf_similares(),
        "[WA][SUB] BuscarDisponibilidadCalendario": wf_disponibilidad(),
        "[WA][SUB] confirmarCitaCalendario": wf_confirmar(ids),
        "[WA][SUB] buscarCitaPorTelefono": wf_cita_telefono(),
        "[WA][SUB] guardarCualificacion": wf_cualificar(ids),
        "[WA][SUB] EnviarPlantilla": wf_plantilla(ids),
        "[WA] 0 · Esquema de base de datos": wf_esquema(),
        "[WA] 1 · Leads de portales por correo": wf_leads(ids),
        "[WA] 2 · Asistente de WhatsApp": wf_asistente(ids),
        "[WA] 3 · Recordatorio 24 h al comercial": wf_recordatorio(ids),
        "[WA] 4 · Cartera desde eGO": wf_cartera_ego(),
        "[WA] 8 · Prueba sin IA (contexto)": wf_prueba_contexto(),
        "[WA] 9 · Lead a mano": wf_lead_manual(ids),
    }
    assert list(wfs) == ORDEN
    return wfs


def api(method, path, payload=None):
    req = urllib.request.Request(N8N + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Content-Type": "application/json",
                 "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode() or "{}")


def esbozo(nombre):
    return wf(nombre, [node("Pendiente", "n8n-nodes-base.manualTrigger", {}, [0, 0], 1)], {})


def main():
    deploy = "--deploy" in sys.argv
    ids = json.loads(IDS_FILE.read_text(encoding="utf-8")) if IDS_FILE.exists() else {}
    for viejo, nuevo in RENOMBRADOS.items():
        if viejo in ids and nuevo not in ids:
            ids[nuevo] = ids.pop(viejo)
    ids = {k: v for k, v in ids.items() if k in ORDEN}

    if deploy:
        remotos = {w["name"]: w["id"] for w in api("GET", "/api/v1/workflows?limit=250")["data"]}
        for nombre in ORDEN:
            if nombre in ids:
                continue
            if nombre in remotos:
                ids[nombre] = remotos[nombre]
                print("  reutilizo   %-46s %s" % (nombre, ids[nombre]))
            else:
                ids[nombre] = api("POST", "/api/v1/workflows", esbozo(nombre))["id"]
                print("  reservo id  %-46s %s" % (nombre, ids[nombre]))
        IDS_FILE.write_text(json.dumps(ids, ensure_ascii=False, indent=2), encoding="utf-8")

    global CONFIG
    CONFIG = CONFIG_REPO                  # los ficheros del repositorio, sin telefonos
    wfs = construir(ids)
    SALIDA.mkdir(exist_ok=True)
    for f in SALIDA.glob("*.json"):
        f.unlink()                      # sin restos de la version anterior
    for nombre, w in wfs.items():
        fichero = re.sub(r"[^A-Za-z0-9]+", "_", nombre).strip("_") + ".json"
        (SALIDA / fichero).write_text(json.dumps(w, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  generado    %-46s nodos=%-3d id=%s" % (nombre, len(w["nodes"]), ids.get(nombre, "sin id")))

    if not deploy:
        print("\n(sin --deploy: no se ha subido nada)")
        return
    print()
    CONFIG = CONFIG_DESPLIEGUE            # a n8n, con los numeros de prueba
    wfs = construir(ids)
    for nombre, w in wfs.items():
        api("PUT", "/api/v1/workflows/%s" % ids[nombre], w)
        print("  ACTUALIZADO %-46s %s" % (nombre, ids[nombre]))
    print("\nLos nuevos quedan desactivados; los que ya estaban activos se publican con la version nueva.")
    print("Numeros de prueba: %d %s" % (PRUEBAS_ACTIVAS,
          "(OJO: con esos telefonos no se escribe en la agenda real)" if PRUEBAS_ACTIVAS
          else "(todo en real: agenda y avisos de verdad para todos)"))


if __name__ == "__main__":
    main()
