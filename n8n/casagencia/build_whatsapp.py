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
CRED_SHEETS   = {"googleSheetsOAuth2Api": {"id": "TPExRnq8a9FlEXAh", "name": "Google Sheets account"}}
# El mismo calendario que usa el telefono para leer y escribir en las agendas
# de Carmen y Gisela: las citas de los dos canales se ven y se respetan.
CRED_CAL      = {"googleCalendarOAuth2Api": {"id": "KKDdmqzzE6jXVm5b", "name": "Google Calendar Paco"}}
CRED_CHATWOOT = {"httpHeaderAuth": {"id": "Wm0tmDE3FjfTx1Tu", "name": "Chatwoot Casagencia"}}
CRED_META     = {"httpHeaderAuth": {"id": "P4xswu9i9E4RILJN", "name": "Meta WhatsApp Casagencia"}}
# Clave que hay que mandar en la cabecera para usar [WA] 9 · Lead a mano
CRED_LEAD_MANUAL = {"httpHeaderAuth": {"id": "cFrVkaTH4R4tKWn0", "name": "WA lead a mano (clave del webhook)"}}
CRED_OPENAI   = {"openAiApi": {"id": "43TI6Y7wzI9hadIh", "name": "OpenAI Casagencia"}}
# Buzon de los formularios de la web (formularioscasagencia@gmail.com)
CRED_FORMULARIO = {"gmailOAuth2": {"id": "V5ZZzoVhgTTledWB", "name": "Correo Formulario"}}
# Buzones de las asesoras: el correo a los leads sin telefono sale del de su asesora
CRED_CORREO = {"Carmen": {"gmailOAuth2": {"id": "28CFTBdQ01u2fYQE", "name": "Conexión Correo Carmen"}},
               "Gisela": {"gmailOAuth2": {"id": "EOojkcNwPPiTNDvR", "name": "Conexion Correo Gisela"}}}
# API de eGO: usuario y contrasena dentro de la credencial (Custom Auth, en el cuerpo del login)
CRED_EGO = {"httpCustomAuth": {"id": "D4GGvFsuQmfalTqZ", "name": "eGO API"}}

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
    _p = {k: _p.get(k) for k in ("telefonos", "avisar_movil", "avisar_email")}   # solo lo que usa config.js
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
# Ids de Carmen, Gisela y Laurence como agentes del panel (de AGENTES_CHATWOOT)
COMERCIALES_CW = [int(x) for x in re.findall(r"\d+", const("AGENTES_CHATWOOT", "{}"))]
assert len(COMERCIALES_CW) == 3, COMERCIALES_CW
# Las comerciales de zona (Carmen y Gisela): si la conversacion ya es de una de
# ellas no se reasigna; si es de Laurence (o de nadie), pasa a la de la referencia.
ASESORAS_CW = [int(x) for x in re.findall(r"(?:Carmen|Gisela):\s*(\d+)", const("AGENTES_CHATWOOT", "{}"))]
assert len(ASESORAS_CW) == 2, ASESORAS_CW
ETQ_BIENVENIDA = "1-bienvenida_ia"
assert ETQ_BIENVENIDA in CONFIG and MARCA and PHONE_ID and WABA_ID


# ---------------------------------------------------------------------------
# Codigo de los nodos
# ---------------------------------------------------------------------------
def code_wa(fname, cartera=False):
    """Nodo propio de WhatsApp = config de WA [+ cartera] + el cuerpo."""
    partes = [CONFIG] + ([CARTERA] if cartera else []) + [(WA / fname).read_text(encoding="utf-8")]
    return "\n\n".join(partes)


def code_leads(fname):
    """Nodo de leads entrantes = config + reglas del primer mensaje (leads.js) + el cuerpo."""
    return "\n\n".join([CONFIG, (WA / "leads.js").read_text(encoding="utf-8"),
                        (WA / fname).read_text(encoding="utf-8")])


def code_correo(fname):
    """Nodo que compone correos = config + plantilla de correo (correo_lead.js) + el cuerpo."""
    return "\n\n".join([CONFIG, (WA / "correo_lead.js").read_text(encoding="utf-8"),
                        (WA / fname).read_text(encoding="utf-8")])


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


def nota(name, texto, pos, w=440, h=220, color=None):
    p = {"content": texto, "height": h, "width": w}
    if color:
        p["color"] = color
    return node(name, "n8n-nodes-base.stickyNote", p, pos, 1)


def noop(name, pos):
    return node(name, "n8n-nodes-base.noOp", {}, pos, 1)


def http(name, metodo, url, pos, cred=None, body=None, query=None, **extra):
    p = {"method": metodo, "url": url, "options": extra.pop("options", {})}
    if metodo == "GET":
        p.pop("method")
    if cred and next(iter(cred)) == "httpCustomAuth":
        # Custom Auth solo funciona como credencial generica (mete usuario y clave en el cuerpo)
        p["authentication"] = "genericCredentialType"
        p["genericAuthType"] = "httpCustomAuth"
    elif cred:
        p["authentication"] = "predefinedCredentialType"
        p["nodeCredentialType"] = next(iter(cred))      # httpHeaderAuth, openAiApi...
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


def exec_sub(name, wid, sub, entradas, pos, tipos=None, cada_uno=False, sin_esperar=False, **extra):
    """Llama a un sub-workflow [WA][SUB] pasandole las entradas por nombre.
    sin_esperar: lo lanza y sigue (para lo que no debe frenar ni romper el flujo)."""
    tipos = tipos or {}
    esquema = [{"id": k, "displayName": k, "required": False, "defaultMatch": False, "display": True,
                "canBeUsedToMatch": True, "type": tipos.get(k, "string")} for k in entradas]
    p = {"workflowId": {"__rl": True, "value": wid, "mode": "list", "cachedResultName": sub},
         "workflowInputs": {"mappingMode": "defineBelow", "value": entradas, "matchingColumns": [],
                            "schema": esquema, "attemptToConvertTypes": False,
                            "convertFieldsToString": False},
         "options": {"waitForSubWorkflow": not sin_esperar}}
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


def reubicar(w, posiciones):
    """Recoloca nodos en el lienzo (solo estetica) sin tocar la logica."""
    for n in w["nodes"]:
        if n["name"] in posiciones:
            n["position"] = list(posiciones[n["name"]])
    return w


# ===========================================================================
# SQL
# ===========================================================================
_CITA_COLS = ["cita_fecha", "cita_hora"]                                # la visita agendada
_Q = ["q_tiempo_buscando", "q_necesita_vender",                       # compra
      "q_vivienda_venta", "q_financiacion",                            # compra (desde 10-2026)
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
-- Alquiler de larga duracion o temporal (lo dice eGO; [WA] 4)
alter table wa_cartera add column if not exists modalidad text not null default '';

-- Leads que entran (web por correo y eGO): que se ha decidido mandarles y si
-- se ha mandado. Con MODO_LEADS = 'preparado' se apunta aqui y no se manda.
create table if not exists leads_entrantes (
  id             serial primary key,
  fuente         text not null,               -- web | ego
  id_origen      text not null,               -- id del correo o del lead de eGO
  telefono_e164  text not null default '',
  nombre         text not null default '',
  referencia     text not null default '',
  tipo           text not null default '',    -- compra, alquiler, vender_su_vivienda...
  accion         text not null default '',    -- bienvenida, no_disponible, busqueda, captacion, revisar
  plantilla      text not null default '',
  param2         text not null default '',
  asesora        text not null default '',
  estado         text not null default 'preparado',
  detalle        jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now(),
  unique (fuente, id_origen)
);
-- El correo preparado para los leads que solo dejan su email
alter table leads_entrantes add column if not exists correo_html text not null default '';

-- Llamadas del asistente telefonico ya puestas en el panel (Retell puede
-- mandar el mismo aviso de fin de llamada mas de una vez)
create table if not exists tel_llamadas_panel (
  call_id          text primary key,
  telefono_e164    text not null default '',
  conversacion_id  integer not null default 0,
  creado_en        timestamptz not null default now()
);

-- Cada aviso al equipo que sale por WhatsApp (de los dos asistentes). Sirve
-- para no repetir: si en una llamada ya salio el recado o la pre-reserva, al
-- colgar no se manda ademas el aviso de LLAMADA.
create table if not exists avisos_enviados (
  id          serial primary key,
  telefono    text not null default '',
  accion      text not null default '',
  origen      text not null default '',
  destinos    text not null default '',
  enviado_en  timestamptz not null default now()
);
create index if not exists avisos_enviados_tel on avisos_enviados (telefono, enviado_en);

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

SQL_REGISTRAR_ENTRANTE = """insert into leads_entrantes
  (fuente, id_origen, telefono_e164, nombre, referencia, tipo, accion, plantilla, param2, asesora, estado, detalle)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
on conflict (fuente, id_origen) do nothing
returning id;"""

SQL_ENTRANTE_ESTADO = """update leads_entrantes set estado = $2 where id = $1;"""

# Alta de un lead de la web: como el del correo, con lo que escribio en la web en notas
SQL_ALTA_LEAD_WEB = SQL_ALTA_LEAD.replace(
    "asunto, enlace, plantilla, estado)", "asunto, enlace, plantilla, notas, estado)").replace(
    "$10,$11,$12,'nuevo')", "$10,$11,$12,$13,'nuevo')").replace(
    "       estado   = 'nuevo',", "       notas    = excluded.notas,\n       estado   = 'nuevo',")
assert "$13" in SQL_ALTA_LEAD_WEB and "notas    = excluded.notas" in SQL_ALTA_LEAD_WEB

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

# El correo que dejo en su solicitud (lead del portal, de la web o a mano)
SQL_CORREO_DEL_LEAD = """select coalesce(
  (select lower(trim(email_cliente)) from wa_leads
    where telefono_wa = $1 and email_cliente ~ '^[^@ ]+@[^@ ]+[.][^@ ]+$'
    order by actualizado_en desc limit 1),
  (select lower(trim(detalle->>'email')) from leads_entrantes
    where regexp_replace(telefono_e164, '[^0-9]', '', 'g') = $1
      and coalesce(detalle->>'email', '') ~ '^[^@ ]+@[^@ ]+[.][^@ ]+$'
    order by creado_en desc limit 1),
  '') as email;"""

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
returning id, q_personas, q_ingresos, q_mascotas, q_entrada, q_actividad;""" % (
    ", ".join(_Q),
    ",".join("$%d" % (10 + i) for i in range(len(_Q))),
    ",\n  ".join("%s = case when excluded.%s <> '' then excluded.%s else wa_leads.%s end"
                 % (q, q, q, q) for q in _Q))

# Lo que la asesora tiene que saber del cliente, en una linea (evento y aviso)
SQL_CUALIFICACION_TEXTO = """select concat_ws(' · ',
  case when q_tiempo_buscando <> '' then 'Lleva buscando: ' || q_tiempo_buscando end,
  case when q_necesita_vender <> '' then 'Necesita vender: ' || q_necesita_vender end,
  case when q_vivienda_venta  <> '' then 'Vivienda que vende: ' || q_vivienda_venta end,
  case when q_financiacion    <> '' then 'Financiacion: ' || q_financiacion end) as cualificacion
  from wa_leads where telefono_wa = $1
 order by actualizado_en desc limit 1;"""

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
                 ("imagen", "text"), ("modalidad", "text")]
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
                       ("limite", "number"), ("modalidad", "string")],
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
    return reubicar(wf("[WA][SUB] confirmarCitaCalendario", [
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
        pg_query("LeerCualificacion", SQL_CUALIFICACION_TEXTO,
                 "={{ [ String(%s.telefono || '').replace(/\\D/g,'') ] }}" % g, [1080, -40],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        code_node("RecuperarPeticion", "return [{ json: $('GuardiaDeAlquiler').first().json }];", [1300, -40]),
        code_node("PrepararDatos", code_tel("cc_preparar.js"), [1300, -40]),
        cal_getall("LeerAgendaDelDia", "={{ $json.calendario }}", DESDE_DIA,
                   "={{ DateTime.fromFormat(%s,'yyyy-MM-dd',{zone:'Europe/Madrid'}).endOf('day').toISO() }}" % DIA,
                   [860, -40]),
        code_node("ValidarAntesDeInsertar", code_tel("cc_validar.js"), [1080, -40]),
        if_node("¿Puede crear?", "={{ $json.puede_crear }}", "true", [1300, -40]),
        code_node("RespuestaRechazo", code_wa("herramienta_respuesta.js"), [1520, 140]),
        # Numero de prueba con PRUEBAS_AGENDA_REAL = false: la agenda se ha consultado
        # de verdad, pero la reserva no se escribe (ni ocupa hueco, ni salta el
        # recordatorio de 24 h). Con true se escribe, con [PRUEBA] en el titulo.
        if_node("¿Es prueba?", "={{ $('GuardiaDeAlquiler').first().json.simular_reserva }}", "true", [1520, -120]),
        set_node("SimularReserva", {"id": ("string", "PRUEBA-sin-agenda"), "prueba": ("boolean", "true")},
                 [1740, -260]),
        node("InsertarEnAgenda", "n8n-nodes-base.googleCalendar", {
            "calendar": {"__rl": True, "value": "={{ $json.calendario }}", "mode": "id"},
            "start": "={{ %s.toISO() }}" % ini,
            "end": "={{ %s.plus({hours:1}).toISO() }}" % ini,
            # PRE-RESERVA: bloquea el hueco (nadie mas puede coger esa hora) y la
            # asesora la confirma llamando al cliente, o la mueve. El resto del
            # titulo es el de las citas del telefono (asi buscarCitaPorTelefono
            # las encuentra) y la marca de origen es lo que mira el recordatorio.
            "additionalFields": {
                "summary": "={{ ($('GuardiaDeAlquiler').first().json.es_prueba ? '[PRUEBA] ' : '') + 'PRE-RESERVA · ' + $json.titulo }}",
                "color": "5",
                "description": ("={{ $json.descripcion + '\\n\\nPara confirmarla: llama al cliente y quita "
                                "PRE-RESERVA del titulo. Si no le va, muevela o borrala.\\n\\n%s\\nConversacion: ' "
                                "+ (%s.conversacion_id || '') + '\\nResumen: ' + [ String($('LeerCualificacion')"
                                ".first().json.cualificacion || ''), String(%s.resumen || '') ].filter(Boolean)"
                                ".join(' · ').replace(/\\n/g, ' ') }}" % (MARCA, s, s)),
            },
        }, [1740, -60], 1.3, credentials=CRED_CAL, onError="continueErrorOutput"),
        set_node("RespuestaErrorCalendario", {"respuesta": ("string",
                 "cita_confirmada: false. No he podido guardar la cita por un problema tecnico. NO le "
                 "digas al cliente que esta reservada: explicale que ha habido una incidencia y usa "
                 "avisarEquipo para que la asesora cierre la visita.")}, [1740, 60]),
        exec_sub("FichaDelCRM", ids.get("[EGO][SUB] FichaCRM", ""), "[EGO][SUB] FichaCRM",
                 {"referencia": "={{ %s.referencia }}" % v}, [1740, -200],
                 onError="continueRegularOutput", alwaysOutputData=True),
        code_node("PrepararAvisoCita", code_wa("aviso_cita.js"), [1740, -120]),
        exec_sub("AvisarAlComercial", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 aviso, [1960, -120], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("MarcarCitaEnLaFicha", SQL_CITA,
                 "={{ [ %s.telefono_e164.replace(/\\D/g,''), %s.fecha, %s.hora ] }}" % (v, v, v), [2180, -120],
                 onError="continueRegularOutput", alwaysOutputData=True, executeOnce=True),
        code_node("RespuestaOK", code_wa("cita_respuesta.js"), [2400, -120]),
        nota("Nota", NOTA_AGENDA, [640, -420], 520, 300),
        nota("Nota2", "## PRE-RESERVA\n1. Se escribe en la agenda de la asesora como *PRE-RESERVA* "
             "(en amarillo), con lo que sabemos del cliente y la marca *%s*. El hueco queda "
             "bloqueado: no se pueden dar dos citas a la misma hora.\n2. Le llega el aviso por "
             "WhatsApp (plantilla_aviso) y por correo: que llame al cliente para confirmarla.\n3. Al "
             "cliente se le dice que NO esta confirmada hasta que le llame la asesora.\n4. La "
             "conversacion pasa a *3-agendada_ia*.\n\n24 horas antes, recordatorio a la asesora: "
             "[WA] 3." % MARCA, [1740, -500], 500, 330),
    ], conn(("Start", 0, "GuardiaDeAlquiler", 0),
            ("GuardiaDeAlquiler", 0, "¿Se puede agendar?", 0),
            ("¿Se puede agendar?", 0, "¿YaReservada?", 0),
            ("¿Se puede agendar?", 1, "Bloqueado", 0),
            ("¿YaReservada?", 0, "¿Ya la tiene?", 0),
            ("¿Ya la tiene?", 0, "RespuestaYaReservada", 0), ("¿Ya la tiene?", 1, "LeerCualificacion", 0),
            ("LeerCualificacion", 0, "RecuperarPeticion", 0),
            ("RecuperarPeticion", 0, "PrepararDatos", 0),
            ("PrepararDatos", 0, "LeerAgendaDelDia", 0),
            ("LeerAgendaDelDia", 0, "ValidarAntesDeInsertar", 0),
            ("ValidarAntesDeInsertar", 0, "¿Puede crear?", 0),
            ("¿Puede crear?", 0, "¿Es prueba?", 0),
            ("¿Es prueba?", 0, "SimularReserva", 0), ("¿Es prueba?", 1, "InsertarEnAgenda", 0),
            ("SimularReserva", 0, "FichaDelCRM", 0), ("FichaDelCRM", 0, "PrepararAvisoCita", 0),
            ("¿Puede crear?", 1, "RespuestaRechazo", 0),
            ("InsertarEnAgenda", 0, "FichaDelCRM", 0),
            ("InsertarEnAgenda", 1, "RespuestaErrorCalendario", 0),
            ("PrepararAvisoCita", 0, "AvisarAlComercial", 0),
            ("AvisarAlComercial", 0, "MarcarCitaEnLaFicha", 0),
            ("MarcarCitaEnLaFicha", 0, "RespuestaOK", 0))), {
        "¿YaReservada?": [640, 0], "¿Ya la tiene?": [860, 0], "RespuestaYaReservada": [1080, -200],
        "LeerCualificacion": [1080, 0], "RecuperarPeticion": [1300, 0], "PrepararDatos": [1520, 0],
        "LeerAgendaDelDia": [1740, 0], "ValidarAntesDeInsertar": [1960, 0], "¿Puede crear?": [2180, 0],
        "RespuestaRechazo": [2400, 200], "¿Es prueba?": [2400, 0], "SimularReserva": [2620, -200],
        "InsertarEnAgenda": [2620, 0], "RespuestaErrorCalendario": [2840, 200],
        "FichaDelCRM": [2840, 0], "PrepararAvisoCita": [3060, 0], "AvisarAlComercial": [3280, 0],
        "MarcarCitaEnLaFicha": [3500, 0], "RespuestaOK": [3720, 0], "Nota": [640, -440], "Nota2": [2620, -560]})


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
            ("conversacion_id", "number"), ("pasar_a_humano", "boolean"), ("etiqueta", "string"),
            ("origen", "string")]


def wf_aviso(ids):
    p = "$('Preparar').first().json"
    nodos_asig, n_if, n_post = asignar("AsignarConversacion", "%s.conversacion_id" % p, "%s.agente_id" % p,
                                       "$json.meta?.assignee?.id", [1960, -80])
    return wf("[WA][SUB] AvisoEquipo", [
        trigger_sub(AVISO_IN),
        pg_query("ResolverReferencia", SQL_RESOLVER_REF,
                 "={{ [ String($json.referencia || ''), %s ] }}" % tel_wa("$json.cliente_telefono"), [60, 180],
                 onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Preparar", code_wa("aviso_preparar.js"), [200, 0]),
        if_node("¿Nota en eGO?", "={{ $json.nota_ego_si }}", "true", [420, 0]),
        exec_sub("NotaEnEgo", ids.get("[EGO][SUB] NotaEnEgo", ""), "[EGO][SUB] NotaEnEgo",
                 {"telefono": "={{ %s.cliente_telefono_e164 }}" % p, "texto": "={{ %s.nota_ego }}" % p,
                  "tipo": "whatsapp"},
                 [640, -160], onError="continueRegularOutput", alwaysOutputData=True, sin_esperar=True),
        code_node("UnoPorDestino", "return $('Preparar').first().json.envios.map(e => ({ json: e }));", [860, 0]),
        http("EnviarWhatsApp", "POST", "%s/%s/messages" % (META_API, PHONE_ID), [1080, 0],
             cred=CRED_META, body="={{ JSON.stringify($json.meta_body) }}",
             onError="continueRegularOutput", alwaysOutputData=True,
             retryOnFail=True, waitBetweenTries=3000, maxTries=2),
        code_node("Juntar", "const destinos = $('UnoPorDestino').all();\n"
                  "return [{ json: { envios: $input.all().map((i, k) => ({ para: destinos[k]?.json.para, "
                  "ok: Array.isArray(i.json.messages) && !!i.json.messages[0]?.id, "
                  "error: String(i.json.error?.message || i.json.error || '').slice(0, 200) })) } }];", [1300, 0]),
        pg_query("ApuntarAviso", SQL_APUNTAR_AVISO,
                 "={{ [ String(%s.cliente_telefono_e164 || '').replace(/\\D/g, ''), %s.accion, %s.origen, "
                 "$json.envios.filter(e => e.ok).map(e => e.para).join(', ') ] }}" % (p, p, p),
                 [1410, 160], onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Hay conversacion?", "={{ Number(%s.conversacion_id || 0) }}" % p, "gt", [1520, 0], der=0,
                tipo="number"),
        exec_sub("Etiquetar", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ %s.conversacion_id }}" % p, "etiquetas": "={{ %s.etiquetas }}" % p},
                 [1520, -200], {"conversacion_id": "number"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        http("LeerAsignacion", "GET", "=" + CW_API + "/conversations/{{ Number(%s.conversacion_id || 0) }}" % p,
             [1740, -200], cred=CRED_CHATWOOT, onError="continueRegularOutput", alwaysOutputData=True),
    ] + nodos_asig + [
        code_node("Resultado", code_wa("aviso_resultado.js"), [2400, 0]),
        nota("Nota", "## Todos los avisos al equipo salen de aqui (solo WhatsApp)\nDel asistente de "
             "WhatsApp (pre-reserva, recordatorio de 24 h, alquiler cualificado, lo que Sara no pueda "
             "resolver) y del asistente telefonico (llamada recibida, pre-reserva por telefono, recado).\n\n"
             "plantilla_aviso directa a Meta (no por Chatwoot, para no abrir una conversacion de cliente con "
             "el comercial), a **la comercial y a Paco**. {{1}} = quien lo recibe, {{2}} = de donde viene "
             "(📞 telefono / 💬 WhatsApp), que, quien, un resumen corto, que tiene que hacer y el enlace al "
             "chat.\n\n**La comercial de la referencia manda siempre** (BN/OR Carmen, CS/VR Gisela): antes se "
             "comprueba la referencia en la cartera (aunque llegue el numero del enlace de la web) y, si no "
             "hay, la del lead de ese telefono. Laurence solo si no se sabe ni inmueble ni zona.\n\nSi hay "
             "que pasar a una persona, pone 4-intervenir (la IA sigue contestando: solo se calla con bot = "
             "Off). La conversacion se asigna en el panel a la comercial del aviso.", [200, -460], 640, 380),
    ], conn(("Start", 0, "ResolverReferencia", 0), ("ResolverReferencia", 0, "Preparar", 0),
            ("Preparar", 0, "¿Nota en eGO?", 0),
            ("¿Nota en eGO?", 0, "NotaEnEgo", 0), ("¿Nota en eGO?", 1, "UnoPorDestino", 0),
            ("NotaEnEgo", 0, "UnoPorDestino", 0), ("UnoPorDestino", 0, "EnviarWhatsApp", 0),
            ("EnviarWhatsApp", 0, "Juntar", 0), ("Juntar", 0, "ApuntarAviso", 0),
            ("ApuntarAviso", 0, "¿Hay conversacion?", 0),
            ("¿Hay conversacion?", 0, "Etiquetar", 0), ("¿Hay conversacion?", 1, "Resultado", 0),
            ("Etiquetar", 0, "LeerAsignacion", 0), ("LeerAsignacion", 0, n_if, 0),
            (n_if, 0, n_post, 0), (n_if, 1, "Resultado", 0), (n_post, 0, "Resultado", 0)))


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
             "verdad · **4-intervenir** tiene que entrar una persona (la IA sigue contestando).\n\nChatwoot "
             "SUSTITUYE la lista entera, asi que primero se leen las que hay y se manda la union. "
             "Las de estado van de una en una y nunca hacia atras.", [200, -330], 500, 260),
    ], conn(("Start", 0, "¿Hay algo que poner?", 0),
            ("¿Hay algo que poner?", 0, "LeerEtiquetas", 0),
            ("¿Hay algo que poner?", 1, "NadaQueHacer", 0),
            ("LeerEtiquetas", 0, "UnirEtiquetas", 0), ("UnirEtiquetas", 0, "GuardarEtiquetas", 0)))


# La referencia que manda Sara, comprobada en la cartera. Si lo que llega es el
# numero del enlace de la web (p. ej. "26699629-A" en vez de "BN-C-126-A"), se
# cambia por la referencia de verdad: de ella sale la asesora que recibe el aviso.
SQL_RESOLVER_REF = """with entrada as (
  select upper(trim($1)) as r,
         coalesce((regexp_match($1, '(\\d{6,})\\D*$'))[1], (regexp_match($1, '(\\d{6,})'))[1], '') as num
), en_cartera as (
  select c.ref, c.municipio from wa_cartera c, entrada e
   where (e.r <> '' and upper(c.ref) = e.r) or (e.num <> '' and c.web_id = e.num)
   order by (upper(c.ref) = e.r) desc limit 1
), del_lead as (
  select coalesce(c.ref, l.referencia) as referencia from wa_leads l
    left join wa_cartera c on upper(c.ref) = upper(l.referencia)
                           or c.web_id = (regexp_match(l.referencia, '(\\d{6,})'))[1]
   where $2 <> '' and l.telefono_wa = $2 and l.referencia <> ''
   order by l.actualizado_en desc, (c.ref is not null) desc limit 1
)
select coalesce((select ref from en_cartera), '') as ref_cartera,
       coalesce((select municipio from en_cartera), '') as municipio_cartera,
       coalesce((select referencia from del_lead), '') as ref_del_lead;"""
# Telefono en el formato de wa_leads.telefono_wa (34 + 9 cifras)
def tel_wa(expr):
    return "(d => d.length === 9 ? '34' + d : d)(String(%s || '').replace(/\\D/g, ''))" % expr


def wf_cualificar(ids):
    a = "$('Preparar').first().json.aviso"
    valores = ("={{ [ $json.telefono_wa, $json.telefono_e164, $json.referencia, $json.nombre, "
               "$json.operacion, $json.es_alquiler, $json.asesora, $json.estado, $json.conversacion_id, "
               + ", ".join("$json.%s" % q for q in _Q) + " ] }}")
    return wf("[WA][SUB] guardarCualificacion", [
        trigger_sub([("telefono", "string"), ("nombre", "string"), ("referencia", "string"),
                     ("operacion", "string"), ("tiempo_buscando", "string"),
                     ("necesita_vender", "string"), ("vivienda_a_vender", "string"),
                     ("financiacion", "string"), ("es_vendedor", "boolean"),
                     ("personas", "string"), ("ingresos", "string"),
                     ("mascotas", "string"), ("entrada", "string"), ("duracion", "string"),
                     ("actividad", "string"), ("resumen", "string"), ("conversacion_id", "number")]),
        pg_query("ResolverReferencia", SQL_RESOLVER_REF,
                 "={{ [ String($json.referencia || ''), %s ] }}" % tel_wa("$json.telefono"), [80, -180],
                 onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Preparar", code_wa("cualificar_preparar.js"), [200, 0]),
        pg_query("GuardarFicha", SQL_CUALIFICAR, valores, [420, 0],
                 onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Es vendedor?", "={{ $('Preparar').first().json.es_vendedor }}", "true", [640, 0]),
        exec_sub("MarcarVendedor", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $('Preparar').first().json.conversacion_id }}",
                  "etiquetas": "={{ $('Preparar').first().json.etiqueta_vendedor }}"},
                 [860, -160], {"conversacion_id": "number"}, onError="continueRegularOutput",
                 alwaysOutputData=True),
        if_node("¿Es alquiler?", "={{ $('Preparar').first().json.es_alquiler }}", "true", [1080, 0]),
        code_node("FaltaAlquiler", code_wa("cualificar_falta.js"), [1300, -100]),
        if_node("¿Alquiler completo?", "={{ $json.completo }}", "true", [1520, -100]),
        pg_query("MarcarPasado", "update wa_leads set estado = 'alquiler_pasado_al_equipo' where id = $1;",
                 "={{ [ $json.ficha_id || 0 ] }}", [1740, -200], onError="continueRegularOutput",
                 alwaysOutputData=True),
        exec_sub("PasarAlEquipo", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 dict({k: "={{ %s.%s }}" % (a, k) for k, _ in AVISO_IN if k not in ("municipio", "cita", "origen")},
                      resumen="={{ $('FaltaAlquiler').first().json.resumen_aviso }}",
                      detalle="={{ $('FaltaAlquiler').first().json.detalle_aviso }}"),
                 [1960, -200], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Respuesta", code_wa("cualificar_respuesta.js"), [2180, 0]),
        nota("Nota", "## Cualificacion\n**Compra**: tres preguntas (cuanto tiempo lleva buscando, si "
             "necesita vender para comprar y como lo financia). Si tiene que vender, Sara le pide la "
             "direccion o zona de esa vivienda y la conversacion se marca con la etiqueta **vendedor**. "
             "Despues ofrece la visita.\n\n**Alquiler**: las "
             "cuatro preguntas del telefono (personas, ingresos, mascotas y cuando entrar). Se "
             "guardan (pueden llegar en varias veces) y, cuando estan las cuatro, se avisa al comercial por "
             "WhatsApp y la conversacion se marca con *4-intervenir*: "
             "en alquiler la IA no agenda, decide una persona.", [200, -330], 520, 270),
    ], conn(("Start", 0, "ResolverReferencia", 0), ("ResolverReferencia", 0, "Preparar", 0),
            ("Preparar", 0, "GuardarFicha", 0),
            ("GuardarFicha", 0, "¿Es vendedor?", 0),
            ("¿Es vendedor?", 0, "MarcarVendedor", 0), ("¿Es vendedor?", 1, "¿Es alquiler?", 0),
            ("MarcarVendedor", 0, "¿Es alquiler?", 0),
            ("¿Es alquiler?", 0, "FaltaAlquiler", 0), ("¿Es alquiler?", 1, "Respuesta", 0),
            ("FaltaAlquiler", 0, "¿Alquiler completo?", 0),
            ("¿Alquiler completo?", 0, "MarcarPasado", 0), ("¿Alquiler completo?", 1, "Respuesta", 0),
            ("MarcarPasado", 0, "PasarAlEquipo", 0), ("PasarAlEquipo", 0, "Respuesta", 0)))


# ===========================================================================
# PRIMER MENSAJE: plantilla de bienvenida por Chatwoot
# ===========================================================================
def wf_plantilla(ids):
    contacto = "$('ElegirContacto').first().json.payload[0]"
    norm = "$('Normalizar').first().json"
    nuevo = "$('CrearContacto').first().json.payload.contact"
    nodos_asig, n_if, n_post = asignar("AsignarAsesora", "$('ConversacionLista').first().json.conversacion_id",
                                       "%s.agente_id" % norm,
                                       "$('LeerConversacion').first().json.meta?.assignee?.id", [3060, 160])
    return reubicar(wf("[WA][SUB] EnviarPlantilla", nodos_asig + [
        trigger_sub([("telefono", "string"), ("nombre", "string"), ("plantilla", "string"),
                     ("param1", "string"), ("param2", "string"), ("referencia", "string"),
                     ("operacion", "string"), ("portal", "string"), ("conversacion_id", "number"),
                     ("email", "string")]),
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
        # Como en Blue: el contacto lleva el atributo bot=On para que la IA le conteste.
        # Si ya lo tiene (On u Off puesto a mano) no se toca.
        http("LeerConversacion", "GET", "=" + CW_API + "/conversations/{{ $json.conversacion_id }}",
             [2620, 0], cred=CRED_CHATWOOT, onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Contacto sin bot?", None, None, [2840, 0], conds=[
            ("={{ Number($json.meta?.sender?.id || 0) }}", "gt", 0, "number"),
            ("={{ String($json.meta?.sender?.custom_attributes?.bot ?? '') }}", "empty", None, "string")]),
        http("ActivarBot", "PUT", "=" + CW_API + "/contacts/{{ $json.meta.sender.id }}", [3060, -140],
             cred=CRED_CHATWOOT, body="={{ JSON.stringify({ custom_attributes: { bot: 'On' } }) }}",
             onError="continueRegularOutput", alwaysOutputData=True),
        # El correo de la solicitud en el contacto del panel, si no tiene uno.
        # Aparte del alta (Chatwoot no deja dos contactos con el mismo correo):
        # si falla, la plantilla sale igual.
        if_node("¿Poner correo?", None, None, [3060, 160], conds=[
            ("={{ Number($('LeerConversacion').first().json.meta?.sender?.id || 0) }}", "gt", 0, "number"),
            ("={{ %s.email }}" % norm, "notEmpty", None, "string"),
            ("={{ String($('LeerConversacion').first().json.meta?.sender?.email ?? '') }}", "empty", None, "string")]),
        http("PonerCorreo", "PUT", "=" + CW_API + "/contacts/{{ $('LeerConversacion').first().json.meta.sender.id }}",
             [3280, 160], cred=CRED_CHATWOOT, body="={{ JSON.stringify({ email: %s.email }) }}" % norm,
             onError="continueRegularOutput", alwaysOutputData=True),
        http("PlantillaMeta", "GET", "%s/%s/message_templates" % (META_API, WABA_ID), [3280, 0],
             cred=CRED_META, query={"name": "={{ %s.plantilla }}" % norm},
             onError="continueRegularOutput", alwaysOutputData=True),
        code_node("RenderizarTexto", code_wa("plantilla_renderizar.js"), [3500, 0]),
        http("EnviarPlantilla", "POST", "=" + CW_API + "/conversations/{{ $json.conversacion_id }}/messages",
             [3720, 0], cred=CRED_CHATWOOT, body="={{ $json.body_mensaje }}",
             retryOnFail=True, waitBetweenTries=3000),
        pg_query("GuardarEnMemoriaAgente", "insert into n8n_chat_histories (session_id, message) values ($1, $2);",
                 "={{ [ %s.telefono_e164, JSON.stringify({ type: 'ai', content: "
                 "$('RenderizarTexto').first().json.contenido, tool_calls: [], additional_kwargs: {}, "
                 "response_metadata: {}, invalid_tool_calls: [] }) ] }}" % norm,
                 [3940, 0], onError="continueRegularOutput", alwaysOutputData=True),
        exec_sub("MarcarBienvenida", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $('ConversacionLista').first().json.conversacion_id }}",
                  "etiquetas": ETQ_BIENVENIDA}, [4160, 0], {"conversacion_id": "number"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        set_node("Resultado", {
            "resultado": ("string", "Plantilla enviada"),
            "conversacion_id": ("number", "={{ $('ConversacionLista').first().json.conversacion_id }}"),
            "contenido": ("string", "={{ $('RenderizarTexto').first().json.contenido }}"),
        }, [4380, 0]),
        nota("Nota", "## El primer mensaje\nLa plantilla de bienvenida se manda POR CHATWOOT para que "
             "la conversacion nazca en el panel.\n\n- Compra: *bienvenida_compra* (es)\n- Alquiler: "
             "*bienvenida_alquiler* (en: asi esta dada de alta en Meta)\n\n{{1}} el nombre del cliente, "
             "{{2}} el enlace del anuncio. Despues se siembra la memoria del agente con ese texto (asi "
             "Sara sabe lo que ya le ha dicho) y la conversacion pasa a *1-bienvenida_ia*.",
             [3280, -340], 540, 290),
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
            ("ConversacionLista", 0, "LeerConversacion", 0), ("LeerConversacion", 0, "¿Contacto sin bot?", 0),
            ("¿Contacto sin bot?", 0, "ActivarBot", 0), ("¿Contacto sin bot?", 1, "¿Poner correo?", 0),
            ("ActivarBot", 0, "¿Poner correo?", 0), ("¿Poner correo?", 0, "PonerCorreo", 0),
            ("¿Poner correo?", 1, n_if, 0), ("PonerCorreo", 0, n_if, 0),
            (n_if, 0, n_post, 0), (n_if, 1, "PlantillaMeta", 0),
            (n_post, 0, "PlantillaMeta", 0), ("PlantillaMeta", 0, "RenderizarTexto", 0),
            ("RenderizarTexto", 0, "EnviarPlantilla", 0), ("EnviarPlantilla", 0, "GuardarEnMemoriaAgente", 0),
            ("GuardarEnMemoriaAgente", 0, "MarcarBienvenida", 0), ("MarcarBienvenida", 0, "Resultado", 0))), {
        "LeerConversacion": [2620, 0], "¿Contacto sin bot?": [2840, 0], "ActivarBot": [3060, -160],
        "¿Poner correo?": [3060, 160], "PonerCorreo": [3170, 320],
        "¿AsignarAsesora?": [3280, 0], "AsignarAsesora": [3500, -160], "PlantillaMeta": [3720, 0],
        "RenderizarTexto": [3940, 0], "EnviarPlantilla": [4160, 0], "GuardarEnMemoriaAgente": [4380, 0],
        "MarcarBienvenida": [4600, 0], "Resultado": [4820, 0], "Nota": [3720, -380]})


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


PROMPT_CLASIFICAR_WEB = (
    "Una persona ha dejado este mensaje en el formulario de contacto de la web de Casagencia, una "
    "inmobiliaria de Benicassim y Castellon. Clasificalo. Responde SOLO con JSON: {\"tipo\": \"\", "
    "\"municipio\": \"\", \"referencia\": \"\", \"idioma\": \"\", \"resumen\": \"\", "
    "\"resumen_cliente\": \"\"}. tipo: compra (quiere comprar), alquiler (quiere alquilar para vivir), "
    "alquiler_temporada (vacaciones, unas semanas o meses), vender_su_vivienda o alquilar_su_vivienda (es "
    "PROPIETARIO y quiere que la agencia le venda o alquile su casa), otro (cualquier otra cosa: "
    "proveedores, empleo, publicidad, spam). municipio: el que mencione, o vacio. referencia: si cita una "
    "referencia de inmueble (como BN-1528-V), o vacio. idioma: es, en o fr segun en que escribe. resumen: "
    "una linea en espanol para la asesora. resumen_cliente: lo que busca en pocas palabras, en SU idioma y "
    "dirigido a el (segunda persona: 'tu familia', no 'mi familia'), para completar la frase 'hemos recibido "
    "tu mensaje sobre ...' (por ejemplo: un piso de unos 75 m2 en Voramar). No inventes.")


def wf_leads(ids):
    """Leads del FORMULARIO DE LA WEB (por correo). Los de portales vienen de eGO ([WA] 5).
    El trigger de Gmail puede traer varios correos a la vez: cada uno va por separado
    a [WA][SUB] LeadDeLaWeb, para que no se pierda ninguno."""
    return wf("[WA] 1 · Leads de la web (correo)", [
        node("CorreoDeLaWeb", "n8n-nodes-base.gmailTrigger", {
            "pollTimes": {"item": [{"mode": "everyMinute"}]},
            "simple": False,
            "filters": {"q": "from:websites.egorealestate.com"},
            "options": {"downloadAttachments": False},
        }, [-40, 0], 1.2, credentials=CRED_FORMULARIO),
        exec_sub("CadaCorreo", ids.get("[WA][SUB] LeadDeLaWeb", ""), "[WA][SUB] LeadDeLaWeb",
                 {"correo": "={{ JSON.stringify($json) }}"}, [200, 0], cada_uno=True,
                 onError="continueRegularOutput"),
        nota("Nota", "## Solo los formularios de la WEB\nBuzon *formularioscasagencia@gmail.com* (credencial "
             "*Correo Formulario*): solo los correos de **web@websites.egorealestate.com** (\"Contacto del "
             "WebSite\"). Los de Idealista, Fotocasa... son las mismas solicitudes que entran en eGO: esas "
             "salen de [WA] 5.\n\nCada correo se trata por separado en *[WA][SUB] LeadDeLaWeb*.",
             [-40, -320], 520, 260),
    ], conn(("CorreoDeLaWeb", 0, "CadaCorreo", 0)))


def wf_lead_web(ids):
    """Un formulario de la web: que es, que se le manda y, si toca, se le manda."""
    d = "$('Decidir').first().json"
    entradas = {k: "={{ %s.%s }}" % (d, v) for k, v in (
        ("telefono", "telefono_e164"), ("nombre", "nombre"), ("plantilla", "plantilla"),
        ("param1", "param1"), ("param2", "param2"), ("referencia", "referencia"),
        ("operacion", "operacion"), ("portal", "portal"), ("email", "email_cliente"))}
    entradas["conversacion_id"] = 0
    registro = ("={{ [ 'web', %s.mensaje_id, %s.telefono_e164, %s.nombre, %s.referencia, %s.tipo, %s.accion, "
                "%s.plantilla, %s.param2, %s.asesora, %s.se_puede_contactar ? "
                "(%s.enviar ? 'enviando' : 'preparado') : 'sin_telefono', JSON.stringify({ origen: %s.origen_url, idioma: %s.idioma, municipio: %s.municipio, resumen: "
                "%s.resumen, mensaje: %s.mensaje }) ] }}")
    registro = registro % tuple([d] * registro.count("%s"))
    alta = ("={{ [ %s.telefono_wa, %s.telefono_e164, %s.referencia, %s.nombre, %s.email_cliente, 'Web', "
            "%s.operacion, %s.es_alquiler, %s.asesora, %s.asunto, %s.enlace, %s.plantilla, %s.notas ] }}")
    alta = alta % tuple([d] * alta.count("%s"))
    return wf("[WA][SUB] LeadDeLaWeb", [
        trigger_sub([("correo", "string")]),
        code_node("LeerFormulario", code_wa("web_parsear.js"), [180, 0]),
        if_node("¿Es de la web?", "={{ $json.es_de_la_web }}", "true", [400, 0]),
        noop("NoEsDeLaWeb", [620, 200]),
        http("Clasificar", "POST", "https://api.openai.com/v1/chat/completions", [620, 0], cred=CRED_OPENAI,
             body="={{ JSON.stringify({ model: 'gpt-4.1-mini', temperature: 0, response_format: { type: "
                  "'json_object' }, messages: [ { role: 'system', content: %s }, { role: 'user', content: "
                  "$json.mensaje || '(sin mensaje)' } ] }) }}" % json.dumps(PROMPT_CLASIFICAR_WEB),
             onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("LeerInmueble", "select * from wa_cartera where upper(ref) = upper($1) "
                 "or ($2 <> '' and enlace like '%/' || $2) limit 1;",
                 "={{ [ $('LeerFormulario').first().json.referencia || (() => { try { return JSON.parse("
                 "$json.choices[0].message.content).referencia || '' } catch (e) { return '' } })(), "
                 "$('LeerFormulario').first().json.id_web ] }}", [840, 0],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        code_node("Decidir", code_leads("web_decidir.js"), [1060, 0]),
        pg_query("Registrar", SQL_REGISTRAR_ENTRANTE, registro, [1280, 0], alwaysOutputData=True),
        if_node("¿Es nuevo?", "={{ $json.id }}", "exists", [1500, 0], tipo="number"),
        noop("YaEstabaApuntado", [1720, 200]),
        if_node("¿Se manda?", "={{ %s.enviar }}" % d, "true", [1720, 0]),
        noop("Preparado (no se manda)", [1940, 200]),
        pg_query("AltaDelLead", SQL_ALTA_LEAD_WEB, alta, [1940, -120], alwaysOutputData=True,
                 onError="continueRegularOutput"),
        if_node("¿Lead nuevo?", "={{ $json.id }}", "exists", [2160, -120], tipo="number"),
        exec_sub("EnviarPrimerWhatsApp", ids.get("[WA][SUB] EnviarPlantilla", ""), "[WA][SUB] EnviarPlantilla",
                 entradas, [2380, -220], {"conversacion_id": "number"}, onError="continueRegularOutput"),
        pg_query("MarcarPlantillaEnviada", SQL_PLANTILLA_ENVIADA,
                 "={{ [ %s.telefono_wa, $json.conversacion_id || 0, %s.referencia ] }}" % (d, d),
                 [2600, -220], onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("ApuntarEnviado", SQL_ENTRANTE_ESTADO, "={{ [ $('Registrar').first().json.id, 'enviado' ] }}",
                 [2820, -220], onError="continueRegularOutput", alwaysOutputData=True),
        # Propietario que quiere vender o alquilar: ademas, aviso a la asesora
        if_node("¿Es captacion?", "={{ %s.accion }}" % d, "equals", [3040, -220], der="captacion", tipo="string"),
        exec_sub("AvisoCaptacion", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 {"accion": "AVISO", "destinatario": "={{ %s.asesora }}" % d,
                  "referencia": "={{ %s.referencia }}" % d, "municipio": "={{ %s.municipio }}" % d,
                  "cliente_nombre": "={{ %s.nombre }}" % d, "cliente_telefono": "={{ %s.telefono_e164 }}" % d,
                  "cita": "", "resumen": "={{ 'Propietario (formulario de la web): ' + %s.resumen }}" % d,
                  "detalle": "={{ %s.notas }}" % d,
                  "conversacion_id": "={{ $('EnviarPrimerWhatsApp').first().json.conversacion_id || 0 }}",
                  "pasar_a_humano": False, "etiqueta": ""},
                 [3260, -320], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        nota("Nota", "## Solo los formularios de la WEB\nBuzon *formularioscasagencia@gmail.com* (credencial "
             "*Correo Formulario*): solo los correos de **web@websites.egorealestate.com** (\"Contacto del "
             "WebSite\"). Los de Idealista, Fotocasa... son las mismas solicitudes que entran en eGO: esas "
             "salen de [WA] 5.\n\nOpenAI lee el mensaje: compra, alquiler, propietario que quiere vender o "
             "alquilar, u otra cosa.", [-40, -380], 560, 300),
        nota("Nota2", "## Que se le manda\n- Habla de un inmueble disponible: **bienvenida_compra / "
             "_alquiler** con su enlace.\n- El inmueble ya no esta: **plantilla_abierta** (ya no esta "
             "disponible, te enseno otros).\n- Formulario general (lo normal en la web): **plantilla_abierta** "
             "con lo que busca.\n- Propietario: **plantilla_abierta** y aviso a la asesora.\n- Otra cosa: "
             "nada, lo revisa una persona.\n\nTodo se apunta en *leads_entrantes*.", [840, -440], 560, 330),
        nota("Nota3", "## Modo: %s\nCon MODO_LEADS = 'preparado' (wa/config.js) se decide y se apunta, pero "
             "**no se manda nada**. Con 'real', se da de alta el lead y sale el WhatsApp (sin repetir: 30 "
             "dias por telefono e inmueble). A los telefonos de prueba se les manda siempre." % const("MODO_LEADS"), [1720, -480], 460, 220),
    ], conn(("LeerFormulario", 0, "¿Es de la web?", 0),
            ("Start", 0, "LeerFormulario", 0), ("¿Es de la web?", 0, "Clasificar", 0), ("¿Es de la web?", 1, "NoEsDeLaWeb", 0),
            ("Clasificar", 0, "LeerInmueble", 0), ("LeerInmueble", 0, "Decidir", 0),
            ("Decidir", 0, "Registrar", 0), ("Registrar", 0, "¿Es nuevo?", 0),
            ("¿Es nuevo?", 0, "¿Se manda?", 0), ("¿Es nuevo?", 1, "YaEstabaApuntado", 0),
            ("¿Se manda?", 0, "AltaDelLead", 0), ("¿Se manda?", 1, "Preparado (no se manda)", 0),
            ("AltaDelLead", 0, "¿Lead nuevo?", 0), ("¿Lead nuevo?", 0, "EnviarPrimerWhatsApp", 0),
            ("EnviarPrimerWhatsApp", 0, "MarcarPlantillaEnviada", 0),
            ("MarcarPlantillaEnviada", 0, "ApuntarEnviado", 0), ("ApuntarEnviado", 0, "¿Es captacion?", 0),
            ("¿Es captacion?", 0, "AvisoCaptacion", 0)))


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
# RECORDATORIO DE LA VISITA AL CLIENTE (24 h y 2 h antes)
# ===========================================================================
SQL_RECORDADO = """insert into wa_avisos (evento_id, tipo) values ($1, 'cliente_' || $2)
on conflict (evento_id, tipo) do nothing
returning evento_id;"""
RECORDATORIO_IN = [("tipo", "string"), ("evento_id", "string"), ("telefono", "string"), ("nombre", "string"),
                   ("referencia", "string"), ("asesora", "string"), ("fecha", "string"), ("hora", "string"),
                   ("fecha_hora", "string"), ("cuando", "string"), ("conversacion_id", "number")]


def wf_recordatorio_cliente_sub(ids):
    """Un recordatorio: busca (o crea) la conversacion del cliente en el panel y le
    manda la plantilla de Meta por Chatwoot, con sus datos."""
    st = "$('Start').first().json"
    return wf("[WA][SUB] RecordatorioCliente", [
        trigger_sub(RECORDATORIO_IN),
        code_node("Config", CONFIG + "\n\nconst c = RECORDATORIO_CLIENTE[$('Start').first().json.tipo] || {};\n"
                  "return [{ json: { plantilla: c.plantilla || '', idioma: c.idioma || 'es' } }];", [200, 0]),
        pg_query("FichaDelInmueble", "select tipo_inmueble, zona, municipio from wa_cartera "
                 "where upper(ref) = upper($1) limit 1;", "={{ [ String(%s.referencia || '') ] }}" % st,
                 [420, 0], alwaysOutputData=True, onError="continueRegularOutput"),
        leer_hoja("LeerDirecciones", "Direcciones", [640, 0], executeOnce=True),
        if_node("¿Tiene conversacion?", "={{ Number(%s.conversacion_id || 0) }}" % st, "gt", [860, 0], der=0,
                tipo="number"),
        exec_sub("ConversacionDelContacto", ids.get("[WA][SUB] ConversacionDelContacto", ""),
                 "[WA][SUB] ConversacionDelContacto",
                 {"telefono": "={{ %s.telefono }}" % st, "nombre": "={{ %s.nombre }}" % st}, [1080, 160],
                 onError="continueRegularOutput", alwaysOutputData=True),
        http("PlantillaMeta", "GET", "%s/%s/message_templates" % (META_API, WABA_ID), [1300, 0],
             cred=CRED_META, query={"name": "={{ $('Config').first().json.plantilla }}"},
             onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Componer", code_wa("recordatorio_cliente_componer.js"), [1520, 0]),
        # Solo con la plantilla APROBADA en Meta y una conversacion donde mandarla
        if_node("¿Se puede mandar?", None, None, [1740, 0], conds=[
            ("={{ Number($json.conversacion_id || 0) }}", "gt", 0, "number"),
            ("={{ $json.aprobada }}", "true", None, "boolean")]),
        http("EnviarRecordatorio", "POST", "=" + CW_API + "/conversations/{{ $json.conversacion_id }}/messages",
             [1960, -80], cred=CRED_CHATWOOT, body="={{ $json.body_mensaje }}",
             onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Enviado?", "={{ Number($json.id || 0) }}", "gt", [2180, -80], der=0, tipo="number"),
        # Sara sabe que se le ha recordado la visita (si contesta "no puedo ir", lo entiende)
        pg_query("GuardarEnMemoriaAgente", "insert into n8n_chat_histories (session_id, message) values ($1, $2);",
                 "={{ [ %s.telefono, JSON.stringify({ type: 'ai', content: $('Componer').first().json.contenido + "
                 "'\\n\\n' + $('Componer').first().json.contexto_visita, "
                 "tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) ] }}" % st,
                 [2400, -160], onError="continueRegularOutput", alwaysOutputData=True),
        # No ha salido (plantilla aun sin aprobar, sin conversacion o error): se quita la
        # marca para que se reintente en la siguiente pasada (si sigue en la ventana)
        pg_query("Desapuntar", "delete from wa_avisos where evento_id = $1 and tipo = 'cliente_' || $2;",
                 "={{ [ %s.evento_id, %s.tipo ] }}" % (st, st), [2400, 160],
                 onError="continueRegularOutput", alwaysOutputData=True),
        set_node("Resultado", {"conversacion_id": ("number", "={{ $('Componer').first().json.conversacion_id }}"),
                               "plantilla": ("string", "={{ $('Componer').first().json.estado_plantilla }}")},
                 [2620, 0]),
        nota("Nota", "## Un recordatorio de visita al cliente\nPor su conversacion del panel (si no la tiene, "
             "se busca o se crea por el telefono) con la plantilla de Meta de RECORDATORIO_CLIENTE "
             "(wa/config.js): {{1}}, {{2}}... segun *parametros*. Se guarda en la memoria de Sara para que "
             "sepa que se le ha recordado si contesta.", [200, -320], 520, 230),
    ], conn(("Start", 0, "Config", 0), ("Config", 0, "FichaDelInmueble", 0),
            ("FichaDelInmueble", 0, "LeerDirecciones", 0), ("LeerDirecciones", 0, "¿Tiene conversacion?", 0),
            ("¿Tiene conversacion?", 0, "PlantillaMeta", 0), ("¿Tiene conversacion?", 1, "ConversacionDelContacto", 0),
            ("ConversacionDelContacto", 0, "PlantillaMeta", 0), ("PlantillaMeta", 0, "Componer", 0),
            ("Componer", 0, "¿Se puede mandar?", 0), ("¿Se puede mandar?", 0, "EnviarRecordatorio", 0),
            ("¿Se puede mandar?", 1, "Desapuntar", 0),
            ("EnviarRecordatorio", 0, "¿Enviado?", 0), ("¿Enviado?", 0, "GuardarEnMemoriaAgente", 0),
            ("¿Enviado?", 1, "Desapuntar", 0),
            ("GuardarEnMemoriaAgente", 0, "Resultado", 0), ("Desapuntar", 0, "Resultado", 0)))


def wf_recordatorio_cliente(ids, tipo, nombre):
    """Cada 15 minutos, las visitas que empiezan dentro de unas N horas (24 o 2)."""
    horas = {"24h": 24, "2h": 2}[tipo]
    ventana = ("const ahora = DateTime.now().setZone('Europe/Madrid');\n"
               "// Visitas que empiezan dentro de unas %d h. La ventana (de %d h 30 min a %d h 15 min)\n"
               "// es algo mas ancha que los 15 min entre ejecuciones; wa_avisos evita repetir.\n"
               "return [{ json: { tipo: '%s', desde_iso: ahora.plus({ hours: %d, minutes: 30 }).toISO(),\n"
               "                  hasta_iso: ahora.plus({ hours: %d, minutes: 15 }).toISO() } }];"
               % (horas, horas - 1, horas, tipo, horas - 1, horas))
    tmin, tmax = "={{ $json.desde_iso }}", "={{ $json.hasta_iso }}"
    entradas = {k: "={{ $json.%s }}" % k for k, _ in RECORDATORIO_IN}
    return wf(nombre, [
        node("Cada15Min", "n8n-nodes-base.scheduleTrigger",
             {"rule": {"interval": [{"field": "minutes", "minutesInterval": 15}]}}, [-40, 0], 1.2),
        code_node("Ventana", ventana, [180, 0]),
        cal_getall("LeerAgendaCarmen", CALENDARIOS["Carmen"], tmin, tmax, [400, -120]),
        cal_getall("LeerAgendaGisela", CALENDARIOS["Gisela"], tmin, tmax, [400, 120]),
        node("Merge", "n8n-nodes-base.merge", {"numberInputs": 2}, [620, 0], 3.2),
        code_node("Visitas", code_wa("recordatorio_cliente_visitas.js"), [840, 0]),
        if_node("¿Se manda?", "={{ $json.enviar }}", "true", [1060, 0]),
        noop("Preparado (falta la plantilla o no esta activo)", [1280, 180]),
        pg_query("ApuntarRecordado", SQL_RECORDADO, "={{ [ $json.evento_id, $json.tipo ] }}", [1280, -80],
                 onError="continueRegularOutput"),
        code_node("SoloLosNuevos", "const nuevos = new Set($input.all().map(i => String(i.json.evento_id ?? '')));\n"
                  "return $('Visitas').all().filter(i => i.json.enviar && nuevos.has(String(i.json.evento_id)));",
                  [1500, -80]),
        exec_sub("Recordar", ids.get("[WA][SUB] RecordatorioCliente", ""), "[WA][SUB] RecordatorioCliente",
                 entradas, [1720, -80], {"conversacion_id": "number"}, cada_uno=True,
                 onError="continueRegularOutput"),
        nota("Nota", "## Recordatorio de la visita al cliente, %d h antes\nCada 15 minutos mira las agendas "
             "de Carmen y Gisela y, a cada visita con el telefono del cliente en el titulo (de WhatsApp o "
             "del telefono) que empieza en unas %d horas, le manda la plantilla de "
             "RECORDATORIO_CLIENTE['%s'] (wa/config.js) por su conversacion del panel.\n\nMientras la "
             "plantilla no tenga nombre (o activo = false, salvo los telefonos de prueba) solo se ve aqui a "
             "quien se le mandaria. Cada visita una sola vez (wa_avisos). No se manda si la visita se "
             "acaba de reservar (hace menos de %d h)." % (horas, horas, tipo, max(1, horas // 4)),
             [180, -380], 560, 300),
    ], conn(("Cada15Min", 0, "Ventana", 0), ("Ventana", 0, "LeerAgendaCarmen", 0),
            ("Ventana", 0, "LeerAgendaGisela", 0), ("LeerAgendaCarmen", 0, "Merge", 0),
            ("LeerAgendaGisela", 0, "Merge", 1), ("Merge", 0, "Visitas", 0), ("Visitas", 0, "¿Se manda?", 0),
            ("¿Se manda?", 0, "ApuntarRecordado", 0),
            ("¿Se manda?", 1, "Preparado (falta la plantilla o no esta activo)", 0),
            ("ApuntarRecordado", 0, "SoloLosNuevos", 0), ("SoloLosNuevos", 0, "Recordar", 0)))


# ===========================================================================
# SEGUIMIENTO A QUIEN NO CONTESTA A LA BIENVENIDA
# ===========================================================================
SEG_PLANTILLA = re.search(r"plantilla:\s*'([^']+)'", const("SEGUIMIENTO")).group(1)
SQL_SEGUIDO = """insert into wa_avisos (evento_id, tipo) values ($1, $2)
on conflict (evento_id, tipo) do nothing
returning evento_id;"""


def wf_seguimiento():
    """Cada 15 minutos en horario comercial: a las conversaciones que siguen en
    1-bienvenida_ia con la bienvenida como ultimo mensaje (de hace 12 h o mas),
    la plantilla de seguimiento por Chatwoot. Una sola vez por bienvenida."""
    comp = "$('Componer').item.json"
    return wf("[WA] 10 · Seguimiento a quien no contesta", [
        node("Cada15MinEnHorario", "n8n-nodes-base.scheduleTrigger",
             {"rule": {"interval": [{"field": "cronExpression", "expression": "*/15 9-18 * * *"}]}},
             [-40, 0], 1.2),
        # Todas las paginas (25 por pagina) de las conversaciones con la etiqueta
        http("SinContestar", "GET", CW_API + "/conversations", [180, 0], cred=CRED_CHATWOOT,
             query={"status": "all", "labels[]": ETQ_BIENVENIDA},
             options={"pagination": {"pagination": {
                 "paginationMode": "updateAParameterInEachRequest",
                 "parameters": {"parameters": [{"type": "qs", "name": "page", "value": "={{ $pageCount + 1 }}"}]},
                 "paginationCompleteWhen": "other",
                 "completeExpression": "={{ ($response.body.data?.payload || []).length < 25 }}",
                 "limitPagesFetched": True, "maxRequests": 20}}}),
        code_node("Candidatos", code_wa("seguimiento_candidatos.js"), [400, 0]),
        pg_query("ApuntarSeguimiento", SQL_SEGUIDO, "={{ [ $json.evento_id, '%s' ] }}" % SEG_PLANTILLA,
                 [620, 0], onError="continueRegularOutput"),
        code_node("SoloLosNuevos", "const nuevos = new Set($input.all().map(i => String(i.json.evento_id ?? '')));\n"
                  "return $('Candidatos').all().filter(i => nuevos.has(String(i.json.evento_id)));", [840, 0]),
        http("PlantillaMeta", "GET", "%s/%s/message_templates" % (META_API, WABA_ID), [1060, 0],
             cred=CRED_META, query={"name": SEG_PLANTILLA}, executeOnce=True,
             onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Componer", code_wa("seguimiento_componer.js"), [1280, 0]),
        if_node("¿Aprobada?", "={{ $json.aprobada }}", "true", [1500, 0]),
        http("EnviarSeguimiento", "POST", "=" + CW_API + "/conversations/{{ $json.conversacion_id }}/messages",
             [1720, -80], cred=CRED_CHATWOOT, body="={{ $json.body_mensaje }}",
             onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Enviado?", "={{ Number($json.id || 0) }}", "gt", [1940, -80], der=0, tipo="number"),
        # Sara sabe que se le ha mandado el seguimiento (si pulsa un boton, lo entiende)
        pg_query("GuardarEnMemoriaAgente", "insert into n8n_chat_histories (session_id, message) values ($1, $2);",
                 "={{ [ %s.telefono, JSON.stringify({ type: 'ai', content: %s.contenido, tool_calls: [], "
                 "additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] }) ] }}" % (comp, comp),
                 [2160, -160], onError="continueRegularOutput"),
        # No ha salido (plantilla sin aprobar o error): se quita la marca y se reintenta
        pg_query("Desapuntar", "delete from wa_avisos where evento_id = $1 and tipo = $2;",
                 "={{ [ %s.evento_id, '%s' ] }}" % (comp, SEG_PLANTILLA), [2160, 160],
                 onError="continueRegularOutput"),
        nota("Nota", "## Seguimiento a quien no contesta\nCada 15 minutos, de 9:00 a 19:00 (hora de Espana), "
             "mira las conversaciones del panel con *%s*. Si lo ultimo es la plantilla de bienvenida y es "
             "de hace 12 h o mas, le manda *%s* ({{1}} = su nombre) por su conversacion. Si las 12 h se "
             "cumplen de noche, sale a las 9:00.\n\nNo sale si el cliente ha contestado, si alguien del "
             "equipo le ha escrito, con el bot en Off, con la conversacion resuelta ni si la bienvenida es "
             "de hace mas de 3 dias. Una sola vez por bienvenida (wa_avisos). Ajustes: SEGUIMIENTO en "
             "wa/config.js." % (ETQ_BIENVENIDA, SEG_PLANTILLA), [180, -380], 600, 300),
    ], conn(("Cada15MinEnHorario", 0, "SinContestar", 0), ("SinContestar", 0, "Candidatos", 0),
            ("Candidatos", 0, "ApuntarSeguimiento", 0), ("ApuntarSeguimiento", 0, "SoloLosNuevos", 0),
            ("SoloLosNuevos", 0, "PlantillaMeta", 0), ("PlantillaMeta", 0, "Componer", 0),
            ("Componer", 0, "¿Aprobada?", 0), ("¿Aprobada?", 0, "EnviarSeguimiento", 0),
            ("¿Aprobada?", 1, "Desapuntar", 0),
            ("EnviarSeguimiento", 0, "¿Enviado?", 0), ("¿Enviado?", 0, "GuardarEnMemoriaAgente", 0),
            ("¿Enviado?", 1, "Desapuntar", 0)))


def asignar(prefijo, conv_expr, agente_expr, asignado_expr, pos):
    """IF + POST de asignacion en Chatwoot. Solo asigna si hay comercial para la
    referencia y la conversacion no la tiene ya Carmen o Gisela (un cambio a mano
    entre ellas se respeta; si la tiene Laurence, pasa a la comercial).
    Devuelve (nodos, nombre_if, nombre_post)."""
    x, y = pos
    nif, npost = "¿%s?" % prefijo, prefijo
    return [
        if_node(nif, None, None, [x, y], conds=[
            ("={{ Number(%s || 0) }}" % conv_expr, "gt", 0, "number"),
            ("={{ Number(%s || 0) }}" % agente_expr, "gt", 0, "number"),
            ("={{ %s.includes(Number(%s || 0)) }}" % (json.dumps(ASESORAS_CW), asignado_expr),
             "false", None, "boolean")]),
        http(npost, "POST", "=" + CW_API + "/conversations/{{ Number(%s) }}/assignments" % conv_expr,
             [x + 220, y - 140], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ assignee_id: Number(%s) }) }}" % agente_expr,
             onError="continueRegularOutput", alwaysOutputData=True),
    ], nif, npost


# ===========================================================================
# [WA] 2 · Asistente de WhatsApp
# ===========================================================================
CTX = "$('ContextoDelLead').first().json"
TEL_CLIENTE = "={{ %s.telefono_e164 }}" % CTX
CONV = "={{ %s.conversacion_id }}" % CTX


def de_la_ia(nombre, desc, tipo="string"):
    return "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('%s', `%s`, '%s') }}" % (nombre, desc, tipo)


SUB_DE_HERRAMIENTA = {"avisarEquipo": "[WA][SUB] AvisoEquipo", "consultarCRM": "[EGO][SUB] FichaCRM"}


def herramienta(nombre, ids, desc, valores, pos, tipos=None):
    """Nodo toolWorkflow: el modelo ve el NOMBRE del nodo como nombre de la herramienta."""
    sub = SUB_DE_HERRAMIENTA.get(nombre, "[WA][SUB] " + nombre)
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


def herramientas(ids, x=1900, y=360):
    dx = 200
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
             "modalidad": de_la_ia("modalidad", "Solo en alquiler: larga_duracion si lo quiere para todo el ano "
                                   "(anual, permanente, para vivir); temporal si lo quiere por unos meses de invierno. "
                                   "Vacio si no lo ha dicho."),
             "municipio": de_la_ia("municipio", "Municipio tal como lo diga el cliente. Vacio si no lo ha dicho."),
             "zona": de_la_ia("zona", "Barrio o zona (centro, playa, Grao...). Vacio si no."),
             "tipo": de_la_ia("tipo", "piso, casa, atico, local, terreno, garaje o trastero. Vacio si le da igual."),
             "habitaciones_min": de_la_ia("habitaciones_min", "Habitaciones minimas. 0 si le da igual.", "number"),
             "banos_min": de_la_ia("banos_min", "Banos minimos. 0 si le da igual.", "number"),
             "precio_min": de_la_ia("precio_min", "Precio minimo en euros, entero. 0 si no lo ha dicho.", "number"),
             "precio_max": de_la_ia("precio_max", "Precio maximo en euros, entero, SOLO si el cliente ha dicho "
                                    "un presupuesto (nunca te lo inventes). 0 si no lo ha dicho.", "number"),
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
        herramienta("consultarCRM", ids,
            "Lo que dice el CRM (eGO) de un inmueble: si sigue DISPONIBLE o esta reservado, vendido, "
            "alquilado o retirado; si la agencia tiene las llaves; y las visitas que ha tenido (internas). "
            "Usala SIEMPRE antes de ofrecer o cerrar una visita, y cuando el cliente pregunte si sigue "
            "disponible.",
            {"referencia": de_la_ia("referencia", REF_DESC)}, [x + 4 * dx, y]),
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
             "resumen": de_la_ia("resumen", "UNA frase corta para el comercial (maximo 200 caracteres): "
                                 "cuanto lleva buscando, si necesita vender, como lo financia y que le ha interesado. "
                                 "Sin saltos de linea.")},
            [x + dx, y + 180], {"conversacion_id": "number"}),
        herramienta("buscarCitaPorTelefono", ids,
            "Busca las visitas que tiene este cliente en las agendas de Carmen y Gisela. Usala cuando "
            "pregunte cuando es su visita, si esta confirmada, o quiera cambiarla o anularla. No modifica nada.",
            {"telefono": TEL_CLIENTE}, [x + 2 * dx, y + 180]),
        herramienta("guardarCualificacion", ids,
            "Guarda las respuestas de cualificacion. COMPRA: cuando tengas las tres (tiempo buscando, si "
            "necesita vender -y si vende, la direccion o zona de esa vivienda- y la financiacion); despues "
            "ofrece la visita. Manda SOLO lo que el cliente te haya contestado: lo que aun no le has "
            "preguntado va vacio. Si mas tarde te da o te corrige un dato, vuelve a usarla solo con ese "
            "dato. ALQUILER: "
            "cuando tengas las cuatro (personas, ingresos, mascotas, entrada); avisa al comercial y pasa la "
            "conversacion a una persona.",
            {"telefono": TEL_CLIENTE, "conversacion_id": CONV,
             "nombre": de_la_ia("nombre", "Nombre del cliente. Vacio si no lo sabes."),
             "referencia": de_la_ia("referencia", REF_DESC),
             "operacion": de_la_ia("operacion", "venta o alquiler."),
             "tiempo_buscando": de_la_ia("tiempo_buscando", "Solo compra. Cuanto tiempo lleva buscando, con sus palabras. Vacio si no aplica."),
             "necesita_vender": de_la_ia("necesita_vender", "Solo compra. Si necesita vender para comprar, con sus palabras. Vacio si no aplica."),
             "es_vendedor": de_la_ia("es_vendedor", "Solo compra. true si necesita vender una vivienda para comprar; false si no o si no lo sabes.", "boolean"),
             "vivienda_a_vender": de_la_ia("vivienda_a_vender", "Solo compra y si necesita vender: direccion o zona (y municipio) de la vivienda que tiene que vender, con sus palabras. VACIO si todavia no se lo has preguntado; 'no facilitado' solo si se lo preguntaste y no quiso decirlo."),
             "financiacion": de_la_ia("financiacion", "Solo compra. Como lo va a pagar: hipoteca, recursos propios, hipoteca ya preconcedida, o lo que diga con sus palabras. VACIO si todavia no se lo has preguntado; 'no facilitado' solo si se lo preguntaste y no quiso decirlo."),
             "personas": de_la_ia("personas", "Solo alquiler. Para cuantas personas. 'no facilitado' si no quiso decirlo."),
             "ingresos": de_la_ia("ingresos", "Solo alquiler. Lo que dijo de ingresos fijos, nomina o contrato, sin valorarlo."),
             "mascotas": de_la_ia("mascotas", "Solo alquiler. Si conviven con mascotas y cuales."),
             "entrada": de_la_ia("entrada", "Solo alquiler. Para que fecha necesitan entrar."),
             "duracion": de_la_ia("duracion", "Solo alquiler. Todo el ano o temporada, si lo ha dicho."),
             "actividad": de_la_ia("actividad", "Solo locales, oficinas o traspasos: para que actividad."),
             "resumen": de_la_ia("resumen", "Resumen de la conversacion en UNA o dos frases cortas (maximo 200 "
                                 "caracteres), sin saltos de linea.")},
            [x + 3 * dx, y + 180], {"conversacion_id": "number", "es_vendedor": "boolean"}),
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
             "resumen": de_la_ia("resumen", "UNA frase corta (maximo 200 caracteres): que pide el cliente, "
                                 "de que inmueble y que queda pendiente. Sin saltos de linea. No inventes."),
             "detalle": de_la_ia("detalle", "El resumen con mas detalle (va al historial del cliente en el CRM, "
                                 "no al aviso)."),
             "conversacion_id": CONV,
             "pasar_a_humano": de_la_ia("pasar_a_humano", "true si a partir de ahora tiene que llevar la "
                                        "conversacion una persona y tu dejas de contestar.", "boolean"),
             "etiqueta": ""},
            [x, y + 360], {"conversacion_id": "number", "pasar_a_humano": "boolean"}),
    ]


def switch_por_tipo(name, expr, salidas, pos):
    """Switch v3.2 como el de Blue: una salida con nombre por cada valor."""
    reglas = [{"conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
        "conditions": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name + v)), "leftValue": expr,
                        "rightValue": v, "operator": {"type": "string", "operation": "equals"}}],
        "combinator": "and"}, "renameOutput": True, "outputKey": v} for v in salidas]
    return node(name, "n8n-nodes-base.switch", {"rules": {"values": reglas}, "options": {}}, pos, 3.2)


def descargar(name, pos):
    """Baja el adjunto que ha guardado Chatwoot (enlace publico firmado)."""
    return node(name, "n8n-nodes-base.httpRequest", {
        "url": "={{ $('EntradaMensaje').first().json.adjunto_url }}",
        "options": {"response": {"response": {"responseFormat": "file"}}, "timeout": 30000},
    }, pos, 4.2, onError="continueRegularOutput")


def redis(name, params, pos, **extra):
    return node(name, "n8n-nodes-base.redis", params, pos, 1, credentials=CRED_REDIS, **extra)


PROMPT_IMAGEN = (
    "Eres el asistente de una inmobiliaria. Un cliente ha mandado esta imagen por WhatsApp. "
    "Descríbela en español en una a tres frases, de forma objetiva y sin inventar. Si es una captura "
    "de un anuncio, de un portal o de un mapa, copia la referencia, el precio, la dirección, la zona y "
    "el texto importante que se lea. Si es una foto de una vivienda, di qué estancia es y lo que se ve. "
    "Si es un documento personal (DNI, nómina, contrato, extracto), di solo qué tipo de documento es y "
    "NO copies ningún dato personal.")


def wf_asistente(ids):
    """Misma estructura que el Asistente de Blue (el estandar de la agencia):
    1 Llega el mensaje · 2 Filtrar si el bot esta encendido o apagado ·
    3 Separar audio, texto e imagen · 4 Recolectar inputs (Redis) ·
    5 Calculo de la fecha actual · 6 Generar respuesta · 7 Enviar en varias partes."""
    ent = "$('EntradaMensaje').first().json"
    mensajes_url = "=" + CW_API + "/conversations/{{ %s.conversacion_id }}/messages" % CTX
    modelo = node("ModeloOpenAI", "@n8n/n8n-nodes-langchain.lmChatOpenAi", {
        "model": {"__rl": True, "value": MODELO, "mode": "list", "cachedResultName": MODELO},
        "options": {"temperature": 0.3},
    }, [6200, 420], 1.2, credentials=CRED_OPENAI)
    tools = herramientas(ids, x=6560, y=420)
    Y = 0
    nodos = [
        # --- 1. Llega el mensaje de WhatsApp ---------------------------------
        node("Webhook", "n8n-nodes-base.webhook", {"httpMethod": "POST", "path": "wa-asistente", "options": {}},
             [0, Y], 2.1, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/webhook"))),
        code_node("EntradaMensaje", code_wa("asistente_entrada.js"), [220, Y]),
        if_node("¿Es un mensaje del cliente?", "={{ $json.procesar }}", "true", [440, Y]),
        noop("NoEsDelCliente", [660, Y + 200]),
        # Chatwoot puede avisar dos veces del mismo mensaje: solo se trata una
        redis("Marca el mensaje", {"operation": "incr", "key": "={{ $json.clave_visto }}",
                                   "expire": True, "ttl": 86400}, [660, Y]),
        if_node("¿Es la primera vez?", "={{ $json[%s.clave_visto] }}" % ent, "equals", [880, Y],
                der=1, tipo="number"),
        noop("AvisoRepetido", [1100, Y + 200]),
        # --- 2. Filtrar si el bot esta encendido o apagado -------------------
        # Solo se para con bot = Off. Sin valor, On o con 4-intervenir, contesta.
        if_node("Bot on/off", "={{ %s.bot_encendido }}" % ent, "true", [1400, Y]),
        noop("BotApagado", [1620, Y + 200]),
        # --- 3. Separar audio, texto e imagen --------------------------------
        switch_por_tipo("Switch", "={{ %s.tipo }}" % ent, ["audio", "image", "text", "otro"], [1960, Y]),
        descargar("Descarga el audio", [2220, Y - 380]),
        node("Transcribe OpenAI", "@n8n/n8n-nodes-langchain.openAi", {
            "resource": "audio", "operation": "transcribe", "options": {"language": "es"},
        }, [2440, Y - 380], 1.7, credentials=CRED_OPENAI, onError="continueRegularOutput"),
        set_node("Variable Response", {"response": ("string",
            "={{ ($json.text && String($json.text).trim() ? '[nota de voz] ' + String($json.text).trim() "
            ": '[nota de voz: no se ha podido transcribir]') + (%s.contenido ? ' ' + %s.contenido : '') }}"
            % (ent, ent))}, [2660, Y - 380]),
        descargar("Descarga la imagen", [2220, Y - 160]),
        node("Analiza la imagen", "@n8n/n8n-nodes-langchain.openAi", {
            "resource": "image", "operation": "analyze",
            "modelId": {"__rl": True, "value": "gpt-4.1-mini", "mode": "id"},
            "text": PROMPT_IMAGEN, "inputType": "base64", "binaryPropertyName": "data",
            "simplify": True, "options": {"detail": "auto", "maxTokens": 400},
        }, [2440, Y - 160], 1.7, credentials=CRED_OPENAI, onError="continueRegularOutput"),
        set_node("Variable Imagen", {"response": ("string",
            "={{ '[imagen] ' + ($json.content && String($json.content).trim() ? String($json.content).trim() "
            ": 'no se ha podido ver') + (%s.contenido ? ' · Texto que la acompaña: ' + %s.contenido : '') }}"
            % (ent, ent))}, [2660, Y - 160]),
        set_node("Variable Response1", {"response": ("string", "={{ %s.contenido }}" % ent)}, [2440, Y + 60]),
        set_node("Variable Otro", {"response": ("string",
            "={{ %s.descripcion_adjunto + (%s.contenido ? ' ' + %s.contenido : '') }}" % (ent, ent, ent))},
            [2440, Y + 260]),
        # --- 4. Recolectar inputs (Redis) -------------------------------------
        set_node("Variable Mensaje", {
            "mensaje": ("string", "={{ $json.response }}"),
            "entrada_cola": ("string", "={{ JSON.stringify({ id: %s.mensaje_id, ts: %s.creado, t: $json.response }) }}"
                             % (ent, ent)),
        }, [2940, Y]),
        redis("Push Redis", {"operation": "push", "list": "={{ %s.clave_buffer }}" % ent,
                             "messageData": "={{ $json.entrada_cola }}"}, [3160, Y]),
        node("Espera 60 segundos", "n8n-nodes-base.wait", {"amount": ESPERA}, [3380, Y], 1.1,
             webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/espera"))),
        redis("Obtiene todos los Mensajes", {"operation": "get", "propertyName": "message",
                                             "key": "={{ %s.clave_buffer }}" % ent, "options": {}},
              [3600, Y], alwaysOutputData=True),
        if_node("¿Es el ultimo mensaje?", "={{ ($json.message || [])[0] ?? '' }}", "equals", [3820, Y],
                der="={{ $('Variable Mensaje').first().json.entrada_cola }}", tipo="string"),
        noop("OtroMensajeMasNuevo", [4040, Y + 200]),
        code_node("Uno por mensaje", code_wa("asistente_vaciar.js"), [4040, Y]),
        redis("Saca los mensajes de Redis", {"operation": "pop", "list": "={{ %s.clave_buffer }}" % ent,
                                             "tail": True, "propertyName": "entrada", "options": {}},
              [4260, Y], alwaysOutputData=True),
        http("MensajesDeLaConversacion", "GET",
             "=" + CW_API + "/conversations/{{ %s.conversacion_id }}/messages" % ent, [4480, Y],
             cred=CRED_CHATWOOT, onError="continueRegularOutput", alwaysOutputData=True, executeOnce=True),
        code_node("JuntarMensajes", code_wa("asistente_juntar.js"), [4700, Y]),
        # --- 5. Calculo de la fecha actual (y todo lo que sabemos del cliente) -
        code_node("CodeFechaHoraActual",
                  "const ahora = DateTime.now().setZone('Europe/Madrid').setLocale('es');\n"
                  "return [{ json: {\n"
                  "  fecha: ahora.toFormat(\"cccc d 'de' LLLL 'de' yyyy\"),\n"
                  "  hora: ahora.toFormat('HH:mm'),\n"
                  "  fecha_hora: ahora.toFormat('cccc dd/MM/yyyy HH:mm'),\n"
                  "  hoy: ahora.toISODate(),\n"
                  "} }];", [4980, Y]),
        pg_query("LeerFichaDelLead", SQL_FICHA, "={{ [ $('JuntarMensajes').first().json.telefono_wa ] }}",
                 [5200, Y], alwaysOutputData=True, onError="continueRegularOutput"),
        # La ficha completa del inmueble del lead va en el contexto de cada turno
        leer_cartera("LeerCartera", [5420, Y]),
        leer_hoja("LeerDirecciones", "Direcciones", [5640, Y], executeOnce=True),
        code_node("ContextoDelLead", code_wa("asistente_contexto.js", cartera=True), [5860, Y]),
        code_node("EstadoEnProceso", code_wa("estado_en_proceso.js"), [4980, Y - 300]),
        # --- El correo de la solicitud en el contacto del panel -----------------
        # Si el cliente dejo su correo en la solicitud y el contacto no lo tiene,
        # se le pone. Va por debajo: se hace despues de contestar.
        pg_query("CorreoDelLead", SQL_CORREO_DEL_LEAD, "={{ [ $json.telefono_wa ] }}", [4980, Y + 420],
                 onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Poner correo?", None, None, [5200, Y + 420], conds=[
            ("={{ Number($('EntradaMensaje').first().json.contacto_id || 0) }}", "gt", 0, "number"),
            ("={{ String($json.email || '') }}", "notEmpty", None, "string"),
            ("={{ String($('EntradaMensaje').first().json.contacto_email || '') }}", "empty", None, "string")]),
        http("PonerCorreo", "PUT", "=" + CW_API + "/contacts/{{ $('EntradaMensaje').first().json.contacto_id }}",
             [5420, Y + 360], cred=CRED_CHATWOOT, body="={{ JSON.stringify({ email: $json.email }) }}",
             onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Marcar en proceso?", "={{ $json.marcar }}", "true", [5200, Y - 300]),
        exec_sub("MarcarEnProceso", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $json.conversacion_id }}", "etiquetas": "={{ $json.etiquetas }}"},
                 [5420, Y - 360], {"conversacion_id": "number"}, onError="continueRegularOutput"),
        # --- 6. Generar respuesta del asistente -------------------------------
        node("Agente", "@n8n/n8n-nodes-langchain.agent", {
            "promptType": "define",
            "text": "=Datos del cliente:\n{{ $json.contexto }}\n"
                    "- Fecha y hora actual: {{ $('CodeFechaHoraActual').first().json.fecha_hora }}"
                    "\n\nMensaje del cliente:\n{{ $json.mensaje }}",
            "options": {"systemMessage": "=" + PROMPT, "maxIterations": 12},
        }, [6280, Y], 1.8, onError="continueErrorOutput"),
        modelo,
        node("MemoriaPostgres", "@n8n/n8n-nodes-langchain.memoryPostgresChat", {
            "sessionIdType": "customKey", "sessionKey": "={{ %s.telefono_e164 }}" % CTX, "contextWindowLength": 40,
        }, [6380, 420], 1.3, credentials=CRED_PG),
        http("AvisoDeFallo", "POST", mensajes_url, [6640, Y + 200], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ content: 'Te atendemos enseguida, dame un momento.', "
                  "message_type: 'outgoing', private: false }) }}", onError="continueRegularOutput"),
        # --- 7. Se estructura y envia en varias partes ------------------------
        code_node("DividirRespuesta", code_wa("asistente_dividir.js"), [7560, Y]),
        http("EnviarMensajes", "POST", mensajes_url, [7800, Y], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ content: $json.mensaje, message_type: 'outgoing', private: false }) }}",
             retryOnFail=True, waitBetweenTries=3000,
             options={"batching": {"batch": {"batchSize": 1, "batchInterval": 2500}}}),
        # --- Secciones (las mismas que el Asistente de Blue) ------------------
        nota("Llega el mensaje", "## Llega el mensaje de WhatsApp\nLa automatizacion de Chatwoot avisa de "
             "cada mensaje del cliente. No se atiende si lo escribio la agencia, esta vacio, la conversacion "
             "esta resuelta o escribe un movil del equipo (los avisos salen de esta misma linea).\n\n"
             "Chatwoot a veces avisa dos veces del mismo mensaje: Redis lo marca y solo pasa una vez.",
             [-60, -300], 1100, 620, color=6),
        nota("Filtrar bot", "## Filtrar si el bot esta encendido o apagado\nAtributo **bot** del contacto, "
             "como en Blue. **Off**: la IA se calla y lo lleva una persona. **On** o sin valor (*Select "
             "value*): contesta la IA, tambien con la etiqueta 4-intervenir.",
             [1220, -300], 660, 620),
        nota("Separar", "## Separar audio, texto e imagen\n- **Audio**: se baja de Chatwoot y lo transcribe "
             "OpenAI -> *[nota de voz] ...*\n- **Imagen**: la describe OpenAI (si es un anuncio, copia "
             "referencia, precio y direccion) -> *[imagen] ...*\n- **Texto**: tal cual.\n- **Otro** "
             "(video, documento, ubicacion, contacto): se le dice a Sara que ha llegado.",
             [1900, -620], 960, 1100, color=5),
        nota("Recolectar", "## Recolectar inputs\nComo en Blue: cada mensaje se apila en Redis (una cola por "
             "telefono), se esperan %d segundos y solo sigue el turno del MAS NUEVO, que contesta una vez "
             "a todo.\n\nMejoras: cada entrada lleva el id del mensaje (dos *ok* seguidos no se pisan y se "
             "ordenan como los escribio); los mensajes se SACAN de Redis uno a uno en vez de leer y borrar "
             "(no se pierde el que entra justo entonces); y se rescata de Chatwoot el que no llego a la "
             "cola." % ESPERA, [2880, -340], 1980, 660, color=4),
        nota("Fecha", "## Calculo de la fecha actual\nFecha y hora de Madrid, la ficha del lead (inmueble, "
             "comercial, preguntas pendientes, visita), la ficha COMPLETA del inmueble y las direcciones. "
             "Arriba, la conversacion pasa a *2-en_proceso*.",
             [4920, -560], 1180, 880, color=7),
        nota("Generar", "## Generar respuesta del asistente\nSara (gpt-5.1) con memoria en Postgres (sesion = "
             "telefono; el primer mensaje lo siembra la plantilla) y sus herramientas [WA][SUB]. Ninguna "
             "llama a un workflow [TEL]: leen los mismos datos y calendarios.\n\nLa base de conocimiento va "
             "dentro del prompt (Blue la tiene en Supabase).", [6160, -340], 1360, 1260, color=2),
        nota("Enviar", "## Se estructura y envia en varias partes\nLa respuesta se parte en mensajes cortos "
             "(como mucho 5) y se mandan por Chatwoot con 2,5 s entre uno y otro.",
             [7500, -340], 540, 660, color=3),
    ] + tools
    principal = conn(
        ("Webhook", 0, "EntradaMensaje", 0), ("EntradaMensaje", 0, "¿Es un mensaje del cliente?", 0),
        ("¿Es un mensaje del cliente?", 0, "Marca el mensaje", 0),
        ("¿Es un mensaje del cliente?", 1, "NoEsDelCliente", 0),
        ("Marca el mensaje", 0, "¿Es la primera vez?", 0),
        ("¿Es la primera vez?", 0, "Bot on/off", 0),
        ("¿Es la primera vez?", 1, "AvisoRepetido", 0),
        ("Bot on/off", 0, "Switch", 0), ("Bot on/off", 1, "BotApagado", 0),
        ("Switch", 0, "Descarga el audio", 0), ("Switch", 1, "Descarga la imagen", 0),
        ("Switch", 2, "Variable Response1", 0), ("Switch", 3, "Variable Otro", 0),
        ("Descarga el audio", 0, "Transcribe OpenAI", 0), ("Transcribe OpenAI", 0, "Variable Response", 0),
        ("Descarga la imagen", 0, "Analiza la imagen", 0), ("Analiza la imagen", 0, "Variable Imagen", 0),
        ("Variable Response", 0, "Variable Mensaje", 0), ("Variable Imagen", 0, "Variable Mensaje", 0),
        ("Variable Response1", 0, "Variable Mensaje", 0), ("Variable Otro", 0, "Variable Mensaje", 0),
        ("Variable Mensaje", 0, "Push Redis", 0), ("Push Redis", 0, "Espera 60 segundos", 0),
        ("Espera 60 segundos", 0, "Obtiene todos los Mensajes", 0),
        ("Obtiene todos los Mensajes", 0, "¿Es el ultimo mensaje?", 0),
        ("¿Es el ultimo mensaje?", 0, "Uno por mensaje", 0),
        ("¿Es el ultimo mensaje?", 1, "OtroMensajeMasNuevo", 0),
        ("Uno por mensaje", 0, "Saca los mensajes de Redis", 0),
        ("Saca los mensajes de Redis", 0, "MensajesDeLaConversacion", 0),
        ("MensajesDeLaConversacion", 0, "JuntarMensajes", 0),
        # primero la etiqueta (rapido) y luego el agente
        ("JuntarMensajes", 0, "EstadoEnProceso", 0), ("JuntarMensajes", 0, "CodeFechaHoraActual", 0),
        ("JuntarMensajes", 0, "CorreoDelLead", 0), ("CorreoDelLead", 0, "¿Poner correo?", 0),
        ("¿Poner correo?", 0, "PonerCorreo", 0),
        ("EstadoEnProceso", 0, "¿Marcar en proceso?", 0), ("¿Marcar en proceso?", 0, "MarcarEnProceso", 0),
        ("CodeFechaHoraActual", 0, "LeerFichaDelLead", 0),
        ("LeerFichaDelLead", 0, "LeerCartera", 0), ("LeerCartera", 0, "LeerDirecciones", 0),
        ("LeerDirecciones", 0, "ContextoDelLead", 0), ("ContextoDelLead", 0, "Agente", 0),
        ("Agente", 0, "DividirRespuesta", 0), ("Agente", 1, "AvisoDeFallo", 0),
        ("DividirRespuesta", 0, "EnviarMensajes", 0))
    ai = ai_conn("Agente", [("ModeloOpenAI", "ai_languageModel"), ("MemoriaPostgres", "ai_memory")]
                 + [(t["name"], "ai_tool") for t in tools])
    return wf("[WA] 2 · Asistente de WhatsApp", nodos, fusionar(principal, ai))



# ===========================================================================
# CONTACTO Y CONVERSACION EN EL PANEL (lo usan las llamadas del telefono)
# ===========================================================================
def wf_conversacion_contacto():
    """Busca (o crea) el contacto por su telefono y su conversacion del inbox de
    WhatsApp. Es la misma logica que la bienvenida (EnviarPlantilla)."""
    norm = "$('Normalizar').first().json"
    contacto = "$('ElegirContacto').first().json.payload[0]"
    nuevo = "$('CrearContacto').first().json.payload.contact"
    return wf("[WA][SUB] ConversacionDelContacto", [
        trigger_sub([("telefono", "string"), ("nombre", "string")]),
        code_node("Normalizar", CONFIG + "\n\nconst j = $('Start').first().json;\n"
                  "const t = normalizarTelefono(j.telefono);\n"
                  "return [{ json: { telefono_e164: t.e164, wa_id: t.wa_id, telefono_valido: t.valido, "
                  "nombre: String(j.nombre || '').trim() } }];", [200, 0]),
        if_node("¿Telefono valido?", "={{ $json.telefono_valido }}", "true", [420, 0]),
        set_node("SinTelefono", {"conversacion_id": ("number", "0")}, [640, 220]),
        http("BuscarContacto", "GET", "=" + CW_API + "/contacts/search?q=%2B{{ $json.wa_id }}", [640, 0],
             cred=CRED_CHATWOOT),
        code_node("ElegirContacto", code_wa("plantilla_elegir_contacto.js"), [860, 0]),
        if_node("¿Existe el contacto?", "={{ $json.payload }}", "notEmpty", [1080, 0], tipo="array"),
        code_node("¿PonerNombre?", code_wa("contacto_nombre.js"), [1300, -120]),
        if_node("¿Le falta el nombre?", "={{ $json.poner_nombre }}", "true", [1520, -120]),
        http("PonerNombre", "PUT", "=" + CW_API + "/contacts/{{ $json.contacto_id }}", [1740, -260],
             cred=CRED_CHATWOOT, body="={{ JSON.stringify({ name: $json.nombre }) }}",
             onError="continueRegularOutput", alwaysOutputData=True),
        http("ConversacionesDelContacto", "GET",
             "=" + CW_API + "/contacts/{{ %s.id }}/conversations" % contacto, [1960, -120], cred=CRED_CHATWOOT),
        if_node("¿Tiene conversacion?", "={{ $json.payload }}", "notEmpty", [2180, -120], tipo="array"),
        code_node("ElegirConversacion", code_wa("plantilla_elegir_conversacion.js"), [2400, -220]),
        http("CrearConversacion", "POST", "=" + CW_API + "/conversations", [2400, -40], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ source_id: %s.phone_number.replace('+',''), inbox_id: %s, "
                  "contact_id: %s.id }) }}" % (contacto, CW_INBOX, contacto)),
        set_node("IdConversacionCreada", {"conversacion_id": ("number", "={{ $json.id }}")}, [2620, -40]),
        http("CrearContacto", "POST", "=" + CW_API + "/contacts", [1300, 160], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ name: %s.nombre || %s.telefono_e164, phone_number: %s.telefono_e164, "
                  "identifier: %s.wa_id, inbox_id: %s, source_id: %s.wa_id }) }}"
                  % (norm, norm, norm, norm, CW_INBOX, norm)),
        node("EsperaAltaContacto", "n8n-nodes-base.wait", {"amount": 3}, [1520, 160], 1.1,
             webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/wa/espera-alta-contacto"))),
        http("CrearConversacionContactoNuevo", "POST", "=" + CW_API + "/conversations", [1740, 160],
             cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ source_id: %s.contact_inboxes[0].source_id, "
                  "inbox_id: %s.contact_inboxes[0].inbox.id, contact_id: %s.id }) }}" % (nuevo, nuevo, nuevo)),
        set_node("IdConversacionNueva", {"conversacion_id": ("number", "={{ $json.id }}")}, [1960, 160]),
        set_node("ConversacionLista", {"conversacion_id": ("number", "={{ $json.conversacion_id }}")}, [2840, 0]),
        http("LeerConversacion", "GET", "=" + CW_API + "/conversations/{{ $json.conversacion_id }}",
             [3060, 0], cred=CRED_CHATWOOT, onError="continueRegularOutput", alwaysOutputData=True),
        set_node("Resultado", {
            "conversacion_id": ("number", "={{ $('ConversacionLista').first().json.conversacion_id }}"),
            "contacto_id": ("number", "={{ $json.meta?.sender?.id || 0 }}"),
            "asignado": ("number", "={{ $json.meta?.assignee?.id || 0 }}"),
        }, [3280, 0]),
        nota("Nota", "## Contacto y conversacion del panel\nPor el telefono: si el contacto existe se usa "
             "(y si no tenia nombre, se le pone el que sepamos); si no, se crea. Despues, su conversacion "
             "abierta mas reciente del inbox de WhatsApp, o una nueva. Misma logica que la bienvenida.",
             [640, -460], 520, 230),
    ], conn(("Start", 0, "Normalizar", 0), ("Normalizar", 0, "¿Telefono valido?", 0),
            ("¿Telefono valido?", 0, "BuscarContacto", 0), ("¿Telefono valido?", 1, "SinTelefono", 0),
            ("BuscarContacto", 0, "ElegirContacto", 0), ("ElegirContacto", 0, "¿Existe el contacto?", 0),
            ("¿Existe el contacto?", 0, "¿PonerNombre?", 0), ("¿Existe el contacto?", 1, "CrearContacto", 0),
            ("¿PonerNombre?", 0, "¿Le falta el nombre?", 0),
            ("¿Le falta el nombre?", 0, "PonerNombre", 0), ("¿Le falta el nombre?", 1, "ConversacionesDelContacto", 0),
            ("PonerNombre", 0, "ConversacionesDelContacto", 0),
            ("ConversacionesDelContacto", 0, "¿Tiene conversacion?", 0),
            ("¿Tiene conversacion?", 0, "ElegirConversacion", 0),
            ("¿Tiene conversacion?", 1, "CrearConversacion", 0),
            ("CrearConversacion", 0, "IdConversacionCreada", 0),
            ("CrearContacto", 0, "EsperaAltaContacto", 0),
            ("EsperaAltaContacto", 0, "CrearConversacionContactoNuevo", 0),
            ("CrearConversacionContactoNuevo", 0, "IdConversacionNueva", 0),
            ("ElegirConversacion", 0, "ConversacionLista", 0),
            ("IdConversacionCreada", 0, "ConversacionLista", 0),
            ("IdConversacionNueva", 0, "ConversacionLista", 0),
            ("ConversacionLista", 0, "LeerConversacion", 0), ("LeerConversacion", 0, "Resultado", 0)))


DDL_LLAMADAS = DDL[DDL.index("create table if not exists tel_llamadas_panel"):]
DDL_LLAMADAS = DDL_LLAMADAS[:DDL_LLAMADAS.index("-- Avisos ya enviados (recordatorio")].strip()
assert "avisos_enviados_tel" in DDL_LLAMADAS and "wa_avisos" not in DDL_LLAMADAS

# Aviso que ya ha salido del telefono para este cliente durante esta llamada
# (recado o pre-reserva): entonces no se manda tambien el de LLAMADA.
SQL_AVISO_EN_LA_LLAMADA = """select count(*)::int as previos from avisos_enviados
 where telefono = $1 and origen = 'telefono' and accion <> 'LLAMADA'
   and enviado_en >= $2::timestamptz - interval '1 minute';"""
SQL_APUNTAR_AVISO = """insert into avisos_enviados (telefono, accion, origen, destinos)
values ($1, $2, $3, $4);"""

SQL_LLAMADA_NUEVA = """insert into tel_llamadas_panel (call_id, telefono_e164) values ($1, $2)
on conflict (call_id) do nothing
returning call_id;"""

PROMPT_NOMBRE = (
    "Te paso la transcripcion de una llamada a una inmobiliaria. 'Agent' es Sara, IA de Casagencia: NO es el "
    "cliente. Saca el nombre del CLIENTE que llama (nombre y apellido si los dice) y la referencia del "
    "inmueble si la menciona (formato como BN-1528-V). Responde solo con JSON: "
    '{"nombre": "", "referencia": ""}. Si no lo dice, deja la cadena vacia. No inventes.')


def wf_llamada_panel(ids):
    """Cada llamada del asistente telefonico, al panel de conversaciones."""
    l = "$('LeerLlamada').first().json"
    d = "$('DatosDelCliente').first().json"
    cv = "$('ConversacionDelContacto').first().json"
    nodos_asig, n_if, n_post = asignar("AsignarAsesora", "%s.conversacion_id" % cv, "%s.agente_id" % d,
                                       "%s.asignado" % cv, [2420, 0])
    return wf("[TEL] Llamada al panel", nodos_asig + [
        trigger_sub([("llamada", "string")]),
        code_node("LeerLlamada", code_wa("llamada_preparar.js"), [200, 0]),
        pg_query("CrearTablaSiFalta", DDL_LLAMADAS, None, [420, 0], executeOnce=True,
                 onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("¿Es nueva?", SQL_LLAMADA_NUEVA, "={{ [ %s.call_id, %s.telefono_e164 ] }}" % (l, l), [640, 0],
                 alwaysOutputData=True),
        if_node("¿Se pone en el panel?", None, None, [860, 0], conds=[
            ("={{ String($json.call_id || '') }}", "notEmpty", None, "string"),
            ("={{ %s.telefono_valido }}" % l, "true", None, "boolean")]),
        noop("YaEstabaOSinTelefono", [1080, 200]),
        http("NombreEnLaTranscripcion", "POST", "https://api.openai.com/v1/chat/completions", [1080, 0],
             cred=CRED_OPENAI, body="={{ JSON.stringify({ model: 'gpt-4.1-mini', temperature: 0, response_format: { type: "
                  "'json_object' }, messages: [ { role: 'system', content: %s }, { role: 'user', content: "
                  "%s.transcripcion || '(sin transcripcion)' } ] }) }}" % (json.dumps(PROMPT_NOMBRE), l),
             onError="continueRegularOutput", alwaysOutputData=True),
        code_node("DatosDelCliente", code_wa("llamada_nombre.js"), [1300, 0]),
        exec_sub("ConversacionDelContacto", ids.get("[WA][SUB] ConversacionDelContacto", ""),
                 "[WA][SUB] ConversacionDelContacto",
                 {"telefono": "={{ $json.telefono_e164 }}", "nombre": "={{ $json.nombre }}"}, [1540, 0]),
        exec_sub("EtiquetaLlamada", ids.get("[WA][SUB] Etiquetar", ""), "[WA][SUB] Etiquetar",
                 {"conversacion_id": "={{ $json.conversacion_id }}", "etiquetas": const("ETIQUETA_LLAMADA")},
                 [1760, 0], {"conversacion_id": "number"}, onError="continueRegularOutput", alwaysOutputData=True),
        node("DescargarGrabacion", "n8n-nodes-base.httpRequest", {
            "url": "={{ %s.grabacion }}" % l,
            "options": {"response": {"response": {"responseFormat": "file"}}, "timeout": 60000},
        }, [1980, 0], 4.2, onError="continueErrorOutput"),
        code_node("ComoAudio", code_wa("llamada_audio.js"), [2090, -120]),
        node("NotaConGrabacion", "n8n-nodes-base.httpRequest", {
            "method": "POST",
            "url": "=" + CW_API + "/conversations/{{ %s.conversacion_id }}/messages" % cv,
            "authentication": "predefinedCredentialType", "nodeCredentialType": "httpHeaderAuth",
            "sendBody": True, "contentType": "multipart-form-data",
            "bodyParameters": {"parameters": [
                {"name": "content", "value": "={{ %s.nota }}" % d},
                {"name": "private", "value": "true"},
                {"name": "message_type", "value": "outgoing"},
                {"parameterType": "formBinaryData", "name": "attachments[]", "inputDataFieldName": "data"},
            ]},
            "options": {},
        }, [2200, -120], 4.2, credentials=CRED_CHATWOOT, onError="continueErrorOutput"),
        http("NotaSinGrabacion", "POST", "=" + CW_API + "/conversations/{{ %s.conversacion_id }}/messages" % cv,
             [2200, 140], cred=CRED_CHATWOOT,
             body="={{ JSON.stringify({ content: %s.nota + (%s.grabacion ? '\\n\\nGrabacion: ' + %s.grabacion : ''), "
                  "private: true, message_type: 'outgoing' }) }}" % (d, d, d),
             onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("ApuntarConversacion", "update tel_llamadas_panel set conversacion_id = $2 where call_id = $1;",
                 "={{ [ %s.call_id, %s.conversacion_id ] }}" % (d, cv), [2860, 0], executeOnce=True,
                 onError="continueRegularOutput", alwaysOutputData=True),
        exec_sub("NotaEnEgo", ids.get("[EGO][SUB] NotaEnEgo", ""), "[EGO][SUB] NotaEnEgo",
                 {"telefono": "={{ %s.telefono_e164 }}" % d, "texto": "={{ %s.nota }}" % d, "tipo": "llamada"},
                 [3080, 0],
                 onError="continueRegularOutput", alwaysOutputData=True, sin_esperar=True),
        pg_query("¿Ya avisada en la llamada?", SQL_AVISO_EN_LA_LLAMADA,
                 "={{ [ %s.telefono_wa, %s.inicio_iso ] }}" % (l, l), [3300, 0],
                 executeOnce=True, onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Avisar a la comercial?", None, None, [3520, 0], conds=[
            ("={{ %s.avisar }}" % d, "true", None, "boolean"),
            ("={{ Number($json.previos || 0) }}", "equals", 0, "number")]),
        exec_sub("AvisoWhatsApp", ids.get("[WA][SUB] AvisoEquipo", ""), "[WA][SUB] AvisoEquipo",
                 {"accion": "LLAMADA", "destinatario": "={{ %s.asesora }}" % d,
                  "referencia": "={{ %s.referencia }}" % d, "municipio": "",
                  "cliente_nombre": "={{ %s.nombre }}" % d, "cliente_telefono": "={{ %s.telefono_e164 }}" % d,
                  "cita": "", "resumen": "={{ %s.resumen }}" % d, "detalle": "={{ %s.resumen }}" % d,
                  "conversacion_id": "={{ %s.conversacion_id }}" % cv, "pasar_a_humano": False, "etiqueta": "",
                  "origen": "telefono"},
                 [3740, -100], {"conversacion_id": "number", "pasar_a_humano": "boolean"},
                 onError="continueRegularOutput", alwaysOutputData=True),
        nota("Nota", "## Cada llamada del asistente telefonico, en el panel\nLa llama `[TEL] "
             "FinalizarLlamadaRetell` al terminar cada llamada (sin esperar: no le cambia nada).\n\n"
             "1. El contacto por su telefono (y su nombre, que OpenAI saca de la transcripcion si lo "
             "dijo), y su conversacion del inbox de WhatsApp.\n2. Etiqueta **0-llamada_telefonica**.\n3. "
             "Nota privada con el resumen, el tono y la **grabacion** (como audio: se escucha en el panel).\n4. Se asigna a la asesora de la "
             "llamada (si no la tiene ya una comercial).\n5. Aviso por WhatsApp a la asesora y a Paco (si ha "
             "durado al menos %d s); sustituye a los correos de cada llamada. Si en la llamada ya salio un recado o una "
             "pre-reserva, no se repite.\n6. La misma nota, en el historial de eGO (contacto o lead del cliente; solo "
             "con MODO_LEADS = 'real').\n\nCada llamada entra una sola vez (tabla tel_llamadas_panel)."
             % int(const("LLAMADA_AVISO_MIN_SEGUNDOS", "15")), [640, -520], 620, 360),
    ], conn(("Start", 0, "LeerLlamada", 0), ("LeerLlamada", 0, "CrearTablaSiFalta", 0),
            ("CrearTablaSiFalta", 0, "¿Es nueva?", 0), ("¿Es nueva?", 0, "¿Se pone en el panel?", 0),
            ("¿Se pone en el panel?", 0, "NombreEnLaTranscripcion", 0),
            ("¿Se pone en el panel?", 1, "YaEstabaOSinTelefono", 0),
            ("NombreEnLaTranscripcion", 0, "DatosDelCliente", 0),
            ("DatosDelCliente", 0, "ConversacionDelContacto", 0),
            ("ConversacionDelContacto", 0, "EtiquetaLlamada", 0),
            ("EtiquetaLlamada", 0, "DescargarGrabacion", 0),
            ("DescargarGrabacion", 0, "ComoAudio", 0), ("ComoAudio", 0, "NotaConGrabacion", 0), ("DescargarGrabacion", 1, "NotaSinGrabacion", 0),
            ("NotaConGrabacion", 0, n_if, 0), ("NotaConGrabacion", 1, "NotaSinGrabacion", 0),
            ("NotaSinGrabacion", 0, n_if, 0),
            (n_if, 0, n_post, 0), (n_if, 1, "ApuntarConversacion", 0), (n_post, 0, "ApuntarConversacion", 0),
            ("ApuntarConversacion", 0, "NotaEnEgo", 0), ("NotaEnEgo", 0, "¿Ya avisada en la llamada?", 0),
            ("¿Ya avisada en la llamada?", 0, "¿Avisar a la comercial?", 0),
            ("¿Avisar a la comercial?", 0, "AvisoWhatsApp", 0)))


# El unico cambio en el telefono: al terminar cada llamada, [TEL]
# FinalizarLlamadaRetell le pasa la llamada a "[TEL] Llamada al panel" SIN
# esperar (no cambia nada de lo que ya hace: Drive, correos...). Se coloca
# arriba del todo para que se ejecute primero aunque algo de lo demas falle.
GANCHO_LLAMADAS = "Llamada al panel"


def gancho_llamadas(sub_id):
    return {
        "parameters": {
            "workflowId": {"__rl": True, "value": sub_id, "mode": "list", "cachedResultName": "[TEL] Llamada al panel"},
            "workflowInputs": {"mappingMode": "defineBelow",
                               "value": {"llamada": "={{ JSON.stringify($('Webhook').item.json.body.call) }}"},
                               "matchingColumns": [], "schema": [
                                   {"id": "llamada", "displayName": "llamada", "required": False,
                                    "defaultMatch": False, "display": True, "canBeUsedToMatch": True,
                                    "type": "string"}],
                               "attemptToConvertTypes": False, "convertFieldsToString": False},
            "options": {"waitForSubWorkflow": False},
        },
        "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2,
        "position": [-1584, 720],
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "casagencia/tel/gancho-llamadas")),
        "name": GANCHO_LLAMADAS,
        "onError": "continueRegularOutput",
    }


def enganchar(w, sub_id, origen="Switch"):
    """Anade el gancho a un FinalizarLlamadaRetell (idempotente)."""
    w["nodes"] = [n for n in w["nodes"] if n["name"] != GANCHO_LLAMADAS] + [gancho_llamadas(sub_id)]
    salidas = w["connections"].setdefault(origen, {"main": [[]]})["main"]
    if not salidas:
        salidas.append([])
    salidas[0] = [c for c in salidas[0] if c["node"] != GANCHO_LLAMADAS]
    salidas[0].insert(0, {"node": GANCHO_LLAMADAS, "type": "main", "index": 0})
    return w


# ===========================================================================
# eGO (API de eGO Real Estate)
# ===========================================================================
def wf_ego_api():
    """Llama a cualquier operacion de la API de eGO. Hace el login (credencial
    "eGO API") y guarda la sesion en Redis para no repetirlo en cada llamada."""
    ses = "$('Sesion').first().json"
    pedir = lambda name, pos, cuerpo: node(name, "n8n-nodes-base.httpRequest", dict({
        "method": "={{ %s.metodo }}" % ses, "url": "={{ %s.url }}" % ses,
        "sendQuery": True, "specifyQuery": "json", "jsonQuery": "={{ JSON.stringify(%s.query) }}" % ses,
        "sendHeaders": True, "headerParameters": {"parameters": [
            {"name": "Authorization", "value": "=Bearer {{ %s.token }}" % ses},
            {"name": "Accept", "value": "application/json"}]},
        # eGO (ASP.NET) quiere las listas repetidas: ?realestateIds=1&realestateIds=2
        "options": {"response": {"response": {"fullResponse": True, "neverError": True, "responseFormat": "text"}},
                    "queryParameterArrays": "repeat", "timeout": 60000},
    }, **({"sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify(%s.cuerpo) }}" % ses}
          if cuerpo else {})), pos, 4.2, onError="continueRegularOutput")
    return wf("[EGO][SUB] Llamar a eGO", [
        trigger_sub([("metodo", "string"), ("ruta", "string"), ("query", "string"), ("cuerpo", "string")]),
        redis("LeerSesion", {"operation": "get", "key": "ego:sesion", "propertyName": "sesion", "options": {}},
              [200, 0], alwaysOutputData=True),
        if_node("¿Hay sesion?", "={{ String($json.sesion || '') }}", "notEmpty", [420, 0], tipo="string"),
        http("Login", "POST", "https://api.egocrm.com/authentication/Authentication/Login", [640, 160],
             cred=CRED_EGO, onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Elegir agencia?", None, None, [860, 160], conds=[
            ("={{ !!$json.token }}", "true", None, "boolean"),
            ("={{ $json.isLogOnApplication === false && ($json.applicationsAvailable || []).length > 0 }}",
             "true", None, "boolean")]),
        node("EntrarEnLaAgencia", "n8n-nodes-base.httpRequest", {
            "url": "https://api.egocrm.com/authentication/Authentication/LoginToApplication",
            "sendQuery": True, "queryParameters": {"parameters": [{"name": "applicationId", "value":
                "={{ (($json.applicationsAvailable || []).find(a => /casagencia/i.test(a.name || '')) "
                "|| $json.applicationsAvailable[0]).id }}"}]},
            "sendHeaders": True, "headerParameters": {"parameters": [
                {"name": "Authorization", "value": "=Bearer {{ $json.token }}"}]},
            "options": {},
        }, [1080, 100], 4.2, onError="continueRegularOutput", alwaysOutputData=True),
        code_node("Sesion", code_wa("ego_sesion.js"), [1300, 0]),
        if_node("¿Guardar sesion?", "={{ $json.sesion_nueva }}", "true", [1520, 0]),
        redis("GuardarSesion", {"operation": "set", "key": "ego:sesion", "value": "={{ $json.sesion_texto }}",
                                "keyType": "string", "expire": True, "ttl": 3000}, [1740, -120]),
        if_node("¿Con cuerpo?", "={{ %s.con_cuerpo }}" % ses, "true", [1960, 0]),
        pedir("LlamadaConCuerpo", [2180, -100], True),
        pedir("LlamadaSinCuerpo", [2180, 100], False),
        if_node("¿Sesion caducada?", "={{ Number($json.statusCode || 0) }}", "equals", [2400, 0], der=401,
                tipo="number"),
        redis("OlvidarSesion", {"operation": "delete", "key": "ego:sesion"}, [2620, -100]),
        code_node("Resultado", "let r = {};\n"
                  "try { r = $('LlamadaConCuerpo').first().json; } catch (e) {}\n"
                  "try { if (!r || !r.statusCode) r = $('LlamadaSinCuerpo').first().json; } catch (e) {}\n"
                  "r = r || {};\n"
                  "const s = $('Sesion').first().json;\n"
                  "const status = Number(r.statusCode || 0);\n"
                  "let datos = r.body ?? r.data ?? null;\n"
                  "if (typeof datos === 'string') { try { datos = JSON.parse(datos); } catch (e) {} }\n"
                  "return [{ json: { ok: status >= 200 && status < 300, status, datos, "
                  "error: !s.hay_sesion ? 'login: ' + s.login_error : (status >= 300 || !status ? String(r.statusMessage || "
                  "r.error || 'error ' + status) : '') } }];", [2840, 0]),
        nota("Nota", "## Llamar a la API de eGO\nEntrada: metodo (GET/POST/PUT), ruta (por ejemplo "
             "/lead/Lead/ListLeadByPage), query y cuerpo en JSON. La agencia (applicationId) se anade "
             "sola.\n\nLogin con la credencial **eGO API** (usuario y contrasena dentro, en el cuerpo del "
             "login). La sesion se guarda 50 minutos en Redis (*ego:sesion*); si eGO dice 401 se olvida y la "
             "siguiente llamada vuelve a entrar.", [200, -400], 560, 280),
    ], conn(("Start", 0, "LeerSesion", 0), ("LeerSesion", 0, "¿Hay sesion?", 0),
            ("¿Hay sesion?", 0, "Sesion", 0), ("¿Hay sesion?", 1, "Login", 0),
            ("Login", 0, "¿Elegir agencia?", 0), ("¿Elegir agencia?", 0, "EntrarEnLaAgencia", 0),
            ("¿Elegir agencia?", 1, "Sesion", 0), ("EntrarEnLaAgencia", 0, "Sesion", 0),
            ("Sesion", 0, "¿Guardar sesion?", 0), ("¿Guardar sesion?", 0, "GuardarSesion", 0),
            ("¿Guardar sesion?", 1, "¿Con cuerpo?", 0), ("GuardarSesion", 0, "¿Con cuerpo?", 0),
            ("¿Con cuerpo?", 0, "LlamadaConCuerpo", 0), ("¿Con cuerpo?", 1, "LlamadaSinCuerpo", 0),
            ("LlamadaConCuerpo", 0, "¿Sesion caducada?", 0), ("LlamadaSinCuerpo", 0, "¿Sesion caducada?", 0),
            ("¿Sesion caducada?", 0, "OlvidarSesion", 0), ("¿Sesion caducada?", 1, "Resultado", 0),
            ("OlvidarSesion", 0, "Resultado", 0)))


def ego(name, ids, metodo, ruta, pos, query="{}", cuerpo="{}", **extra):
    """Nodo que llama a la API de eGO a traves de [EGO][SUB] Llamar a eGO."""
    return exec_sub(name, ids.get("[EGO][SUB] Llamar a eGO", ""), "[EGO][SUB] Llamar a eGO",
                    {"metodo": metodo, "ruta": ruta, "query": query, "cuerpo": cuerpo}, pos,
                    onError="continueRegularOutput", alwaysOutputData=True, **extra)


# La ficha del inmueble del lead y, por si ya no esta, 3 viviendas parecidas
# (misma operacion y mismo prefijo de referencia = mismo municipio). Una fila siempre.
SQL_FICHA_CORREO = """select
  (select row_to_json(c) from wa_cartera c where upper(c.ref) = upper($1) limit 1) as ficha,
  coalesce((select json_agg(p) from (
     select ref, tipo_inmueble, municipio, zona, precio, habitaciones, banos, superficie, imagen, enlace, tipo_transaccion
       from wa_cartera
      where $1 <> '' and upper(left(ref, 2)) = upper(left($1, 2)) and upper(ref) <> upper($1)
        and (case when upper($1) like '%-A' then tipo_transaccion ilike '%alquil%' else tipo_transaccion not ilike '%alquil%' end)
        and tipo_inmueble ~* '(apartamento|piso|chalet|villa|d[uú]plex|town house|village house|casa|estudio|ground floor|[aá]tico|bungalow|adosad)'
      order by actualizado_en desc, precio limit 3) p), '[]'::json) as parecidos;"""
SQL_GUARDAR_CORREO = """update leads_entrantes set correo_html = $2, estado = $3, detalle = detalle || $4::jsonb
 where id = $1;"""


def wf_leads_ego(ids):
    """Todas las solicitudes de los portales, desde eGO. En modo 'preparado' solo
    manda a los telefonos de prueba; al resto lo apunta sin mandar."""
    d = "$('Decidir').item.json"
    entradas = {k: "={{ %s.%s }}" % (d, v) for k, v in (
        ("telefono", "telefono_e164"), ("nombre", "nombre"), ("plantilla", "plantilla"),
        ("param1", "param1"), ("param2", "param2"), ("referencia", "referencia"),
        ("operacion", "operacion"), ("portal", "portal"), ("email", "email_cliente"))}
    entradas["conversacion_id"] = 0
    registro = ("={{ [ 'ego', $json.lead_id, $json.telefono_e164, $json.nombre, $json.referencia, $json.tipo, "
                "$json.accion, $json.plantilla, $json.param2, $json.asesora, $json.se_puede_contactar ? "
                "($json.enviar ? 'enviando' : 'preparado') : ($json.por_correo ? 'correo_preparado' : 'sin_telefono'), "
                "JSON.stringify({ portal: $json.portal, email: $json.email_cliente, "
                "solicitud: $json.solicitud, estado_inmueble: $json.estado_inmueble, disponible: $json.disponible, "
                "contacto_creado: $json.contacto_creado, asignado_ego: $json.asignado_ego, asesora_por_referencia: "
                "$json.asesora_por_referencia, asignacion_coincide: $json.asignacion_coincide, notas: $json.notas }) ] }}")
    alta = ("={{ [ %s.telefono_wa, %s.telefono_e164, %s.referencia, %s.nombre, %s.email_cliente, %s.portal, "
            "%s.operacion, %s.es_alquiler, %s.asesora, %s.asunto, %s.enlace, %s.plantilla, %s.notas ] }}")
    alta = alta % tuple([d] * alta.count("%s"))
    return wf("[WA] 5 · Leads de eGO (portales)", [
        node("Cada5Minutos", "n8n-nodes-base.scheduleTrigger",
             {"rule": {"interval": [{"field": "minutes", "minutesInterval": 5}]}}, [-40, 0], 1.2),
        ego("ListarLeads", ids, "POST", "/lead/Lead/ListLeadByPage", [180, 0],
            # eGO guarda createDate en UTC (comprobado: un lead creado a las 11:53 UTC sale 11:53)
            cuerpo="={{ JSON.stringify({ minDateCreated: $now.toUTC().minus({ hours: 3 })"
                   ".toFormat(\"yyyy-MM-dd'T'HH:mm:ss\"), pageIndex: 0, numberOfRecords: 100 }) }}"),
        code_node("Separar", code_wa("ego_leads_separar.js"), [400, 0]),
        if_node("¿Hay leads?", "={{ $json.lead_id }}", "exists", [620, 0], tipo="string"),
        noop("NadaNuevo", [840, 200]),
        pg_query("YaVistos", "select coalesce(string_agg(id_origen, ','), '') as vistos from leads_entrantes "
                 "where fuente = 'ego' and id_origen = any(string_to_array($1, ','));",
                 "={{ [ $('Separar').all().map(i => i.json.lead_id).filter(Boolean).join(',') ] }}", [840, 0],
                 executeOnce=True, alwaysOutputData=True),
        code_node("SoloNuevos", "const vistos = new Set(String($input.first().json.vistos || '').split(',')"
                  ".filter(Boolean));\nreturn $('Separar').all().filter(i => i.json.lead_id && !vistos.has("
                  "i.json.lead_id)).slice(0, 25).map(i => ({ json: i.json }));", [1060, 0]),
        ego("EstadoDelInmueble", ids, "GET", "/realestate/Realestate/GetRealestate", [1280, 0],
            query="={{ JSON.stringify({ realestateId: $json.realestate_id || 0 }) }}", cada_uno=True),
        pg_query("LaCartera", "select coalesce(json_agg(json_build_object('ref', ref, 'enlace', enlace, "
                 "'tipo_transaccion', tipo_transaccion, 'municipio', municipio)), '[]'::json) as filas "
                 "from wa_cartera where upper(ref) = any(string_to_array(upper($1), ','));",
                 "={{ [ $('SoloNuevos').all().map(i => i.json.referencia).filter(Boolean).join(',') ] }}",
                 [1500, 0], executeOnce=True, alwaysOutputData=True, onError="continueRegularOutput"),
        code_node("Decidir", code_leads("ego_decidir.js"), [1720, 0]),
        pg_query("Registrar", SQL_REGISTRAR_ENTRANTE, registro, [1940, 0], alwaysOutputData=True),
        if_node("¿Se manda?", None, None, [2160, 0], conds=[
            ("={{ %s.enviar }}" % d, "true", None, "boolean"),
            ("={{ !!$json.id }}", "true", None, "boolean")]),
        noop("Preparado (no se manda)", [2380, 200]),
        pg_query("AltaDelLead", SQL_ALTA_LEAD_WEB, alta, [2380, -120], alwaysOutputData=True,
                 onError="continueRegularOutput"),
        if_node("¿Lead nuevo?", "={{ $json.id }}", "exists", [2600, -120], tipo="number"),
        exec_sub("EnviarPrimerWhatsApp", ids.get("[WA][SUB] EnviarPlantilla", ""), "[WA][SUB] EnviarPlantilla",
                 entradas, [2820, -220], {"conversacion_id": "number"}, cada_uno=True,
                 onError="continueRegularOutput"),
        pg_query("MarcarPlantillaEnviada", SQL_PLANTILLA_ENVIADA,
                 "={{ [ %s.telefono_wa, $json.conversacion_id || 0, %s.referencia ] }}" % (d, d),
                 [3040, -220], onError="continueRegularOutput", alwaysOutputData=True),
        pg_query("ApuntarEnviado", SQL_ENTRANTE_ESTADO, "={{ [ $('Registrar').item.json.id, 'enviado' ] }}",
                 [3260, -220], onError="continueRegularOutput", alwaysOutputData=True),
        # Sin telefono pero con correo: correo con la ficha y un boton de WhatsApp
        if_node("¿Por correo?", None, None, [2160, 320], conds=[
            ("={{ %s.por_correo }}" % d, "true", None, "boolean"),
            ("={{ !!$json.id }}", "true", None, "boolean")]),
        pg_query("FichaParaCorreo", SQL_FICHA_CORREO, "={{ [ %s.referencia || '' ] }}" % d, [2380, 320],
                 alwaysOutputData=True, onError="continueRegularOutput"),
        node("ComponerCorreo", "n8n-nodes-base.code", {"mode": "runOnceForEachItem",
             "jsCode": code_correo("ego_correo.js")}, [2600, 320], 2),
        pg_query("GuardarCorreo", SQL_GUARDAR_CORREO,
                 "={{ [ $json.registro_id, $json.html, 'correo_preparado', JSON.stringify({ correo_asunto: $json.asunto, "
                 "correo_para: $json.para, correo_modo: $json.modo, whatsapp: $json.whatsapp_url }) ] }}",
                 [2820, 320], onError="continueRegularOutput", alwaysOutputData=True),
        if_node("¿Se envia el correo?", "={{ $('ComponerCorreo').item.json.enviar }}", "true", [3040, 320]),
        # Sale del correo de su asesora (Gisela para CS/VR, Carmen para el resto)
        if_node("¿De Gisela?", "={{ $('ComponerCorreo').item.json.remitente }}", "equals", [3260, 240],
                der="Gisela", tipo="string"),
    ] + [node("EnviarCorreo" + quien, "n8n-nodes-base.gmail", {
            "sendTo": "={{ $('ComponerCorreo').item.json.para }}",
            "subject": "={{ $('ComponerCorreo').item.json.asunto }}",
            "emailType": "html",
            "message": "={{ $('ComponerCorreo').item.json.html }}",
            "options": {"appendAttribution": False, "senderName": "={{ $('ComponerCorreo').item.json.nombre_remitente }}",
                        "replyTo": "={{ $('ComponerCorreo').item.json.responder_a }}",
                        "ccList": "={{ $('ComponerCorreo').item.json.copia }}"}},
            [3480, y], 2.1, credentials=CRED_CORREO[quien], onError="continueRegularOutput", alwaysOutputData=True)
        for quien, y in (("Gisela", 160), ("Carmen", 320))] + [
        pg_query("ApuntarCorreoEnviado", "update leads_entrantes set estado = case when $2 then 'correo_enviado' "
                 "else 'correo_fallido' end where id = $1;",
                 "={{ [ $('Registrar').item.json.id, !!$json.id ] }}", [3700, 240],
                 onError="continueRegularOutput", alwaysOutputData=True),
        noop("Correo preparado (no se envia)", [3260, 420]),
        nota("NotaCorreo", "## Leads que solo dejan su correo\nSi el lead no trae telefono pero si email, "
             "se le prepara un correo (wa/correo_lead.js) en su idioma con la **ficha del inmueble** (foto, "
             "precio, habitaciones, banos, metros, lo destacado), un boton **Escribenos por WhatsApp** que abre "
             "el chat con Sara con la referencia ya escrita, y otro a la ficha de la web. Si ya no esta "
             "disponible: 3 parecidos.\n\nSe guarda en *leads_entrantes* (correo_html) y sale del **Gmail de su "
             "asesora** (Gisela para CS/VR, Carmen para el resto), con respuesta a ella. Queda apuntado como "
             "correo_enviado o correo_fallido.", [2380, 520], 640, 300),
        nota("Nota", "## Todas las solicitudes de los portales, desde eGO\nCada 5 minutos, los leads que han "
             "entrado en eGO en las ultimas 3 horas y vienen de un portal (Idealista, Fotocasa, "
             "Properstar...). Cada lead una sola vez (tabla *leads_entrantes*).\n\nEl lead ya trae el "
             "telefono, el inmueble, venta o alquiler y la comercial que ha puesto eGO. Del inmueble se pide "
             "el **estado** a eGO (GetRealestate). Comprobado: todo lo que llega al correo de los portales "
             "entra en eGO 1-3 minutos despues, y eGO lo asigna igual que nuestro reparto por referencia.",
             [180, -440], 620, 320),
        nota("Nota2", "## Que se le manda\n- Inmueble **Disponible** en eGO: **bienvenida_compra / "
             "_alquiler** con el enlace de la web (o la referencia si no esta en la web).\n- **Reservado, "
             "vendido, alquilado, retirado...**: **plantilla_abierta**: ya no esta disponible, Sara le "
             "ensena otros.\n\nModo **%s**: se apunta todo en *leads_entrantes* y solo se manda a los "
             "telefonos de prueba. Con 'real' (wa/config.js) se manda a todos." % const("MODO_LEADS"),
             [1500, -460], 600, 300),
    ], conn(("Cada5Minutos", 0, "ListarLeads", 0), ("ListarLeads", 0, "Separar", 0),
            ("Separar", 0, "¿Hay leads?", 0), ("¿Hay leads?", 0, "YaVistos", 0), ("¿Hay leads?", 1, "NadaNuevo", 0),
            ("YaVistos", 0, "SoloNuevos", 0), ("SoloNuevos", 0, "EstadoDelInmueble", 0),
            ("EstadoDelInmueble", 0, "LaCartera", 0), ("LaCartera", 0, "Decidir", 0),
            ("Decidir", 0, "Registrar", 0), ("Registrar", 0, "¿Se manda?", 0), ("Registrar", 0, "¿Por correo?", 0),
            ("¿Por correo?", 0, "FichaParaCorreo", 0), ("FichaParaCorreo", 0, "ComponerCorreo", 0),
            ("ComponerCorreo", 0, "GuardarCorreo", 0), ("GuardarCorreo", 0, "¿Se envia el correo?", 0),
            ("¿Se envia el correo?", 0, "¿De Gisela?", 0),
            ("¿De Gisela?", 0, "EnviarCorreoGisela", 0), ("¿De Gisela?", 1, "EnviarCorreoCarmen", 0),
            ("EnviarCorreoGisela", 0, "ApuntarCorreoEnviado", 0), ("EnviarCorreoCarmen", 0, "ApuntarCorreoEnviado", 0),
            ("¿Se envia el correo?", 1, "Correo preparado (no se envia)", 0),
            ("¿Se manda?", 0, "AltaDelLead", 0), ("¿Se manda?", 1, "Preparado (no se manda)", 0),
            ("AltaDelLead", 0, "¿Lead nuevo?", 0), ("¿Lead nuevo?", 0, "EnviarPrimerWhatsApp", 0),
            ("EnviarPrimerWhatsApp", 0, "MarcarPlantillaEnviada", 0),
            ("MarcarPlantillaEnviada", 0, "ApuntarEnviado", 0)))


def wf_ego_ficha(ids):
    """La ficha del CRM de un inmueble: estado, llaves y fichas de visita."""
    rid = "$('IdDeEgo').first().json.datos"
    return wf("[EGO][SUB] FichaCRM", [
        trigger_sub([("referencia", "string")]),
        ego("IdDeEgo", ids, "GET", "/realestate/Realestate/CheckRealestateReference", [200, 0],
            query="={{ JSON.stringify({ realestateReference: String($json.referencia || '').toUpperCase().trim() }) }}"),
        if_node("¿Esta en eGO?", "={{ Number($json.datos || 0) }}", "gt", [420, 0], der=0, tipo="number"),
        ego("Inmueble", ids, "GET", "/realestate/Realestate/GetRealestate", [640, -100],
            query="={{ JSON.stringify({ realestateId: %s }) }}" % rid),
        ego("Llaves", ids, "GET", "/realestate/RealestateKey/ListRealestateKeyGroup", [860, -100],
            query="={{ JSON.stringify({ realestateIds: [ %s ], applicationIds: [] }) }}" % rid),
        ego("FichasDeVisita", ids, "POST", "/realestate/Realestate/ListRealestateVisitFile", [1080, -100],
            cuerpo="={{ JSON.stringify({ realestateId: %s }) }}" % rid),
        code_node("Resumen", code_wa("ego_ficha.js"), [1300, 0]),
        nota("Nota", "## Ficha del CRM de un inmueble\nPor la referencia: el id de eGO "
             "(CheckRealestateReference), el **estado** (Disponible, Reservado, Vendido, Alquilado, "
             "Retirado...), las **llaves** (si hay un llavero del inmueble en la agencia) y las **fichas de "
             "visita** (hechas, programadas, interes, puntos positivos y negativos: internos).\n\nLa usa "
             "Sara (herramienta *consultarCRM*) antes de ofrecer visita, y la pre-reserva para decirle a la "
             "asesora el estado y las llaves.", [200, -420], 600, 280),
    ], conn(("Start", 0, "IdDeEgo", 0), ("IdDeEgo", 0, "¿Esta en eGO?", 0),
            ("¿Esta en eGO?", 0, "Inmueble", 0), ("¿Esta en eGO?", 1, "Resumen", 0),
            ("Inmueble", 0, "Llaves", 0), ("Llaves", 0, "FichasDeVisita", 0), ("FichasDeVisita", 0, "Resumen", 0)))


def wf_ego_nota(ids):
    """Deja en eGO una nota (historial) con el resumen de la conversacion o de la llamada."""
    return wf("[EGO][SUB] NotaEnEgo", [
        trigger_sub([("telefono", "string"), ("texto", "string"), ("tipo", "string")]),
        code_node("Preparar", code_wa("ego_nota_preparar.js"), [200, 0]),
        if_node("¿Se escribe?", "={{ $json.escribir }}", "true", [420, 0]),
        set_node("NoSeEscribe", {"resultado": ("string", "={{ 'No se escribe en eGO (modo ' + $json.modo + ')' }}")},
                 [640, 200]),
        ego("BuscarContacto", ids, "POST", "/entity/Entity/ListEntityByPageFastSearch", [640, -40],
            cuerpo="={{ JSON.stringify({ searchText: $json.nueve, pageIndex: 0, numberOfRecords: 5 }) }}"),
        ego("BuscarLead", ids, "POST", "/lead/Lead/ListLeadByPage", [860, -40],
            cuerpo="={{ JSON.stringify({ phone: $('Preparar').first().json.nueve, pageIndex: 0, numberOfRecords: 10 }) }}"),
        code_node("Destino", code_wa("ego_nota_destino.js"), [1080, -40]),
        if_node("¿Esta en eGO?", "={{ Number($json.objeto_id || 0) }}", "gt", [1300, -40], der=0, tipo="number"),
        set_node("NoEstaEnEgo", {"resultado": ("string", "No hay contacto ni lead con ese telefono en eGO")},
                 [1520, 120]),
        ego("InsertarNota", ids, "POST", "/note/Note/InsertNote", [1520, -120],
            # id: 0 = nota nueva (sin el, eGO falla con "Column 'ID' cannot be null")
            cuerpo="={{ JSON.stringify({ id: 0, objectId: $json.objeto_id, objectName: $json.objeto, "
                   "description: $json.texto, historicTypeId: $json.tipo_historial, securityUserId: 'SESION' }) }}"),
        set_node("Resultado", {"resultado": ("string", "={{ $json.ok ? 'Nota en ' + $('Destino').first().json.donde "
                                                       ": 'eGO no ha guardado la nota: ' + $json.error }}")},
                 [1740, -120]),
        nota("Nota", "## Nota en el historial de eGO\nBusca al cliente por su telefono: en su **contacto** "
             "si existe y, si no, en su **lead** mas reciente (los de los portales no traen contacto). "
             "Deja una nota con el resumen de la conversacion de WhatsApp o de la llamada.\n\nSolo con "
             "MODO_LEADS = 'real' (y siempre con los telefonos de prueba).", [200, -380], 560, 240),
    ], conn(("Start", 0, "Preparar", 0), ("Preparar", 0, "¿Se escribe?", 0),
            ("¿Se escribe?", 0, "BuscarContacto", 0), ("¿Se escribe?", 1, "NoSeEscribe", 0),
            ("BuscarContacto", 0, "BuscarLead", 0), ("BuscarLead", 0, "Destino", 0),
            ("Destino", 0, "¿Esta en eGO?", 0), ("¿Esta en eGO?", 0, "InsertarNota", 0),
            ("¿Esta en eGO?", 1, "NoEstaEnEgo", 0), ("InsertarNota", 0, "Resultado", 0)))


# ===========================================================================
# [WA] 4 · Cartera desde eGO
# ===========================================================================
FEED_EGO = "http://feeds.transporter.janeladigital.com/423E0F5F-30FC-4E01-8FE1-99BD7E14B021/0500013012.xml"


def wf_cartera_ego(ids):
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
        # Alquiler de larga duracion o temporal: el tipo de negocio de eGO (una llamada)
        ego("NegociosEgo", ids, "POST", "/realestate/Realestate/ListRealestateByPage", [1080, -80],
            cuerpo=json.dumps({"realestateStatus": [2], "pageIndex": 0, "numberOfRecords": 500})),
        code_node("Modalidad", code_wa("cartera_modalidad.js", cartera=True), [1300, -80]),
        pg_query("CrearTablasSiFaltan", DDL, None, [1520, -80], executeOnce=True),
        pg_query("GuardarCartera", SQL_GUARDAR_CARTERA,
                 "={{ [ JSON.stringify($('Modalidad').first().json.filas) ] }}", [1740, -80], executeOnce=True),
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
            ("Mapear", 0, "¿Feed correcto?", 0), ("¿Feed correcto?", 0, "NegociosEgo", 0),
            ("NegociosEgo", 0, "Modalidad", 0), ("Modalidad", 0, "CrearTablasSiFaltan", 0),
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
        ("operacion", "operacion"), ("portal", "portal"), ("email", "email_cliente"))}
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
    "[EGO][SUB] Llamar a eGO",
    "[EGO][SUB] FichaCRM",
    "[EGO][SUB] NotaEnEgo",
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
    "[WA][SUB] ConversacionDelContacto",
    "[WA][SUB] RecordatorioCliente",
    "[WA][SUB] LeadDeLaWeb",
    "[TEL] Llamada al panel",
    "[WA] 0 · Esquema de base de datos",
    "[WA] 1 · Leads de la web (correo)",
    "[WA] 2 · Asistente de WhatsApp",
    "[WA] 3 · Recordatorio 24 h al comercial",
    "[WA] 4 · Cartera desde eGO",
    "[WA] 5 · Leads de eGO (portales)",
    "[WA] 6 · Recordatorio de visita al cliente (24 h)",
    "[WA] 7 · Recordatorio de visita al cliente (2 h)",
    "[WA] 8 · Prueba sin IA (contexto)",
    "[WA] 9 · Lead a mano",
    "[WA] 10 · Seguimiento a quien no contesta",
]

# Workflows de la primera version que se reaprovechan con su nombre nuevo, para
# no dejar huerfanos en n8n (estan desactivados y nadie los usa).
RENOMBRADOS = {
    "[WA] 1 · Leads de portales por correo": "[WA] 1 · Leads de la web (correo)",
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
        "[EGO][SUB] Llamar a eGO": wf_ego_api(),
        "[EGO][SUB] FichaCRM": wf_ego_ficha(ids),
        "[EGO][SUB] NotaEnEgo": wf_ego_nota(ids),
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
        "[WA][SUB] ConversacionDelContacto": wf_conversacion_contacto(),
        "[WA][SUB] RecordatorioCliente": wf_recordatorio_cliente_sub(ids),
        "[WA][SUB] LeadDeLaWeb": wf_lead_web(ids),
        "[TEL] Llamada al panel": wf_llamada_panel(ids),
        "[WA] 0 · Esquema de base de datos": wf_esquema(),
        "[WA] 1 · Leads de la web (correo)": wf_leads(ids),
        "[WA] 2 · Asistente de WhatsApp": wf_asistente(ids),
        "[WA] 3 · Recordatorio 24 h al comercial": wf_recordatorio(ids),
        "[WA] 4 · Cartera desde eGO": wf_cartera_ego(ids),
        "[WA] 5 · Leads de eGO (portales)": wf_leads_ego(ids),
        "[WA] 6 · Recordatorio de visita al cliente (24 h)": wf_recordatorio_cliente(ids, "24h", "[WA] 6 · Recordatorio de visita al cliente (24 h)"),
        "[WA] 7 · Recordatorio de visita al cliente (2 h)": wf_recordatorio_cliente(ids, "2h", "[WA] 7 · Recordatorio de visita al cliente (2 h)"),
        "[WA] 8 · Prueba sin IA (contexto)": wf_prueba_contexto(),
        "[WA] 9 · Lead a mano": wf_lead_manual(ids),
        "[WA] 10 · Seguimiento a quien no contesta": wf_seguimiento(),
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
    activos = {w["id"]: w["active"] for w in api("GET", "/api/v1/workflows?limit=250")["data"]}
    for nombre, w in wfs.items():
        try:
            api("PUT", "/api/v1/workflows/%s" % ids[nombre], w)
        except urllib.error.HTTPError as e:
            raise SystemExit("ERROR en %s: %s" % (nombre, e.read().decode()[:600]))
        # Un sub-workflow tiene que estar publicado antes que los que lo llaman
        if "[SUB]" in nombre and not activos.get(ids[nombre]):
            api("POST", "/api/v1/workflows/%s/activate" % ids[nombre])
            print("  PUBLICADO   %-46s %s" % (nombre, ids[nombre]))
        print("  ACTUALIZADO %-46s %s" % (nombre, ids[nombre]))
    print("\nLos nuevos quedan desactivados; los que ya estaban activos se publican con la version nueva.")
    print("Numeros de prueba: %d %s" % (PRUEBAS_ACTIVAS,
          ("(con esos telefonos la agenda se escribe de verdad, con [PRUEBA] en el titulo)"
           if "PRUEBAS_AGENDA_REAL = true" in CONFIG else
           "(OJO: con esos telefonos no se escribe en la agenda real)") if PRUEBAS_ACTIVAS
          else "(todo en real: agenda y avisos de verdad para todos)"))


if __name__ == "__main__":
    main()
