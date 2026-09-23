#!/usr/bin/env python3
"""Actualiza el LLM y el agente de Retell de Casagencia.

  python3 retell/update_retell.py            -> muestra el diff, no toca nada
  python3 retell/update_retell.py --apply    -> aplica y publica
"""
import json, os, sys, pathlib, urllib.request, urllib.error

BASE = pathlib.Path(__file__).parent
API = "https://api.retellai.com"
LLM_ID = "llm_1a81c0ae161db34f33a2ae20375d"
AGENT_ID = "agent_56db2b3a1d32800c9734bb59f9"
N8N = "https://n8n-casagencia.serversvisionarius.com/webhook"

# Las referencias reales tienen formatos variables (BN-1442, CS-G-397-V,
# BN-G-342-A). El patron antiguo ^(BN|OR|CS|VR)-\d+(-[A-Z])?$ los rechazaba y,
# con tool_call_strict_mode activo, obligaba al modelo a mutilar la referencia.
REF_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9\-]{2,24}$"
REF_DESC = ("Referencia del inmueble tal y como la ha dicho el cliente, con TODAS las letras y "
            "numeros en el mismo orden. No quites letras intermedias ni finales. Los guiones y "
            "las mayusculas dan igual. Ejemplos validos: BN-1442, BN-1442-A, CS-G-397-V, BNG342A.")
TEL_DESC = ("Telefono de contacto. Manda las cifras tal y como las haya dicho el cliente; si es "
            "extranjero, conserva el prefijo internacional. El sistema lo normaliza solo.")


def call(method, path, payload=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": "Bearer " + os.environ["RETELL_API_KEY"],
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code} en {method} {path}: {e.read().decode()[:500]}")
        raise


def tool_http(name, path, description, props, required, msg):
    return {
        "type": "custom", "name": name,
        "url": f"{N8N}/{path}",
        "description": description,
        "speak_during_execution": True, "speak_after_execution": True,
        "execution_message_description": msg,
        "timeout_ms": 15000,
        "response_variables": {"call_id": "{{call_id}}"},
        "parameters": {"type": "object", "additionalProperties": False,
                       "properties": props, "required": required},
    }


def construir_tools(actuales):
    por_nombre = {t.get("name"): t for t in actuales}
    out = []

    out.append(por_nombre["end_call"])

    # --- referencia: patron permisivo en las tres herramientas que la usan ---
    for nombre in ("buscarPorReferencia", "BuscarDisponibilidadCalendario", "confirmarCitaCalendario"):
        t = json.loads(json.dumps(por_nombre[nombre]))
        props = t["parameters"]["properties"]
        props["referencia"]["pattern"] = REF_PATTERN
        props["referencia"]["description"] = REF_DESC
        if "telefono" in props:
            props["telefono"]["description"] = TEL_DESC
        t["timeout_ms"] = 15000
        out.append(t)

    # --- descripciones con el contrato nuevo --------------------------------
    for t in out:
        if t.get("name") == "BuscarDisponibilidadCalendario":
            t["description"] = (
                "Comprueba si se puede hacer una visita de una hora a un inmueble en una fecha y hora "
                "concretas. Valida el horario de oficina, los festivos y la agenda real de la asesora. "
                "Usala solo cuando el cliente haya elegido un inmueble y ya sepas su nombre, telefono, la "
                "referencia, el tipo de transaccion y una fecha y hora concretas. Solo consulta: no crea la "
                "cita. Devuelve 'disponible' (true/false), 'alternativas' con las horas libres reales y "
                "'mensaje_para_sara' con lo que tienes que hacer. Si 'disponible' es false, ofrece unicamente "
                "las horas de 'alternativas'. NO la uses para inmuebles en ALQUILER o traspaso: en alquiler "
                "no se agenda visita, se cualifica al cliente y llama la asesora (flujo 8-TER).")
        if t.get("name") == "confirmarCitaCalendario":
            t["description"] = (
                "Crea la cita de visita en el Google Calendar de la asesora. Usala solo despues de que "
                "BuscarDisponibilidadCalendario haya dicho que hay hueco y el cliente haya aceptado esa fecha "
                "y hora. Vuelve a validar horario, festivo y ocupacion antes de guardar. Devuelve "
                "'cita_confirmada' (true/false) y 'mensaje_para_sara'. Solo puedes decirle al cliente que la "
                "visita ha quedado registrada si 'cita_confirmada' es true. NO la uses para inmuebles en "
                "ALQUILER o traspaso: esas visitas las agenda la asesora (flujo 8-TER).")

    # registrarMensaje: se anade la cualificacion de los leads de alquiler
    rm = json.loads(json.dumps(por_nombre["registrarMensaje"]))
    props = rm["parameters"]["properties"]
    props["tipo_llamada"]["enum"] = ["consulta_info", "venta_en_curso", "alquiler_en_curso",
                                     "queja_problema", "derivacion_asesora",
                                     "visita_pendiente_agendar", "lead_alquiler", "otro"]
    props["tipo_llamada"]["description"] = (
        "Clasificacion principal de la llamada. Usa 'lead_alquiler' siempre que el cliente quiera "
        "ver un inmueble en alquiler o traspaso: en alquiler no se agenda visita, se cualifica y "
        "llama la asesora.")
    props["alquiler_personas"] = {"type": "string", "maxLength": 80,
        "description": "Solo en lead_alquiler. Para cuantas personas seria la vivienda. Si no lo facilita, pon 'no facilitado'."}
    props["alquiler_ingresos"] = {"type": "string", "maxLength": 200,
        "description": "Solo en lead_alquiler. Si cuenta con ingresos fijos demostrables, nomina o contrato de trabajo, tal y como lo haya dicho el cliente. Si no lo facilita, pon 'no facilitado'. No valores ni juzgues la respuesta."}
    props["alquiler_mascotas"] = {"type": "string", "maxLength": 120,
        "description": "Solo en lead_alquiler. Si conviven con mascotas y cuales. Si no lo facilita, pon 'no facilitado'."}
    props["alquiler_entrada"] = {"type": "string", "maxLength": 120,
        "description": "Solo en lead_alquiler. Para que fecha necesitaria entrar a vivir. Si no lo facilita, pon 'no facilitado'."}
    props["alquiler_duracion"] = {"type": "string", "maxLength": 120,
        "description": "Solo en lead_alquiler. Si lo quiere para todo el ano o por temporada, y cuanto tiempo."}
    rm["description"] = (
        "Registra un aviso y envia una notificacion a Laurence, Carmen o Gisela. Usala siempre que "
        "Sara diga que va a tomar nota, avisar o pedir que devuelvan la llamada, y SIEMPRE al cerrar "
        "un lead de alquiler (tipo_llamada 'lead_alquiler') con los datos de cualificacion. Antes de "
        "usarla, obten al menos el telefono y, si es posible, el nombre. Devuelve 'mensaje_registrado' "
        "y 'mensaje_para_sara': solo di que el aviso se ha enviado si es true.")
    rm["timeout_ms"] = 15000
    out.append(rm)

    bi = json.loads(json.dumps(por_nombre["buscarInmuebles"]))
    bi["description"] = (
        "Busca en el CRM inmuebles reales disponibles por municipio y caracteristicas. Es una busqueda "
        "APROXIMADA: usala solo cuando ya le hayas preguntado UNA vez por la referencia del anuncio y no la "
        "tenga, y cuando ya conozcas la operacion, un municipio valido y el numero minimo de habitaciones. "
        "Si al cliente le da igual el numero de habitaciones, envia 0. No usar cuando el cliente "
        "proporciona una referencia: en ese caso usa buscarPorReferencia. Si el cliente ha dado una calle o "
        "una direccion, usa antes buscarPorDireccion. No envies otros filtros.")
    out.append(bi)

    # --- NUEVA: busqueda por direccion --------------------------------------
    out.append(tool_http(
        "buscarPorDireccion", "buscarpordireccion",
        "Busca un inmueble a partir de la direccion o la calle que dice el cliente. Usala cuando el cliente "
        "identifique el inmueble por una calle, plaza, avenida o direccion Y ya le hayas preguntado UNA vez "
        "por la referencia del anuncio sin que la tenga. La referencia es exacta y la direccion es "
        "aproximada, asi que la referencia siempre va primero. Devuelve 'encontrado', 'fiabilidad' y "
        "'mensaje_para_sara'. Si 'encontrado' es false, NO le leas al cliente un listado de inmuebles.",
        {"direccion": {"type": "string", "minLength": 2, "maxLength": 200,
                       "description": "La direccion tal y como la ha dicho el cliente, con el numero si lo ha dado. Ejemplo: calle del Mestre Falla 39."},
         "municipio": {"type": "string", "maxLength": 80,
                       "description": "Municipio, solo si ya lo sabes. No lo preguntes antes de buscar."},
         "operacion": {"type": "string", "enum": ["venta", "alquiler"],
                       "description": "Operacion, solo si ya la sabes."}},
        ["direccion"],
        "Estoy buscando ese inmueble por la direccion... Un momento"))

    # --- NUEVA: consultar cita por telefono ---------------------------------
    out.append(tool_http(
        "buscarCitaPorTelefono", "buscarcitaportelefono",
        "Busca en las agendas de Carmen y Gisela las visitas concertadas a nombre del telefono del cliente. "
        "Usala cuando el cliente pregunte cuando tiene la visita, si esta confirmada, o quiera cambiarla o "
        "anularla. Devuelve 'encontrado', la lista de 'citas' y 'mensaje_para_sara'. No modifica ni borra "
        "nada: para cambiar o anular hay que registrar un mensaje para la asesora.",
        {"telefono": {"type": "string", "minLength": 6, "maxLength": 30, "description": TEL_DESC}},
        ["telefono"],
        "Estoy mirando su cita en la agenda... Un momento"))

    return out


# Ajustes de conversacion. Se mantiene el sonido ambiente a peticion del cliente.
AGENTE = {
    "responsiveness": 0.55,          # antes 0.85: arrancaba antes de que el cliente terminara
    "interruption_sensitivity": 0.45,  # antes 0.7: cualquier ruido la cortaba
    "reminder_trigger_ms": 10000,    # antes 5000: insistia a los 5 segundos
    "reminder_max_count": 1,         # antes 2
    "enable_dynamic_responsiveness": True,
    "boosted_keywords": [
        "Casagencia", "Benicasim", "Benicassim", "Benicàssim", "Oropesa", "Orpesa",
        "Torreblanca", "Borriol", "Vilafamés", "Vilafames", "Onda", "Castellón", "Castello",
        "Vila-real", "Villarreal", "Burriana", "Borriana", "Almazora", "Almassora",
        "Alquerías del Niño Perdido", "Les Alqueries",
        "Carmen", "Gisela", "Laurence", "referencia", "alquiler", "venta", "visita",
    ],
}


def main():
    apply = "--apply" in sys.argv
    prompt = (BASE / "general_prompt.md").read_text(encoding="utf-8")

    llm = call("GET", f"/get-retell-llm/{LLM_ID}")
    tools = construir_tools(llm["general_tools"])

    print(f"  prompt      {len(llm['general_prompt'])} -> {len(prompt)} caracteres")
    print(f"  tools       {[t['name'] for t in llm['general_tools']]}")
    print(f"           -> {[t['name'] for t in tools]}")
    for k, v in AGENTE.items():
        print(f"  {k:32} -> {json.dumps(v)[:90]}")

    if not apply:
        print("\n(sin --apply: no se ha tocado nada)")
        return

    nuevo_llm = call("PATCH", f"/update-retell-llm/{LLM_ID}",
                     {"general_prompt": prompt, "general_tools": tools})
    v = nuevo_llm["version"]
    print(f"\n  LLM actualizado -> version {v}")

    ag = call("PATCH", f"/update-agent/{AGENT_ID}",
              {**AGENTE, "response_engine": {"type": "retell-llm", "llm_id": LLM_ID, "version": v}})
    av = ag["version"]
    print(f"  Agente actualizado -> version {av}")

    call("POST", f"/publish-agent/{AGENT_ID}", {"version": av})
    print(f"  Agente PUBLICADO -> version {av} (el numero de telefono usa 'latest_published')")


if __name__ == "__main__":
    main()
