#!/usr/bin/env python3
"""Lee las direcciones de los inmuebles desde el CRM de eGO y las vuelca en la
pestana "Direcciones" de la hoja de calculo.

Ni el feed XML de Janela ni la web publica de casagencia.com traen la calle:
solo municipio, zona, codigo postal y coordenadas. El CRM si la tiene.

SOLO HACE LECTURAS (GET) sobre eGO. No modifica nada alli.

  export EGO_USER=...  EGO_PASS=...  N8N_API_KEY=...
  python3 ego_direcciones.py            # solo muestra lo que encuentra
  python3 ego_direcciones.py --escribir # ademas reescribe la pestana
"""
import html, json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

EGO = "https://admin.egorealestate.com/egocore"
N8N = "https://n8n-casagencia.serversvisionarius.com"
SHEET = "1cB2UI-ScDI34QS57k-UD2ZE79P5XhpyPJu78A5zPs3Q"
CRED_SHEETS = {"googleSheetsOAuth2Api": {"id": "TPExRnq8a9FlEXAh", "name": "Google Sheets account"}}
COOKIES = os.path.join(tempfile.gettempdir(), "ego_cookies.txt")

VIAS = ('calle', 'avenida', 'avda', 'plaza', 'paseo', 'camino', 'bulevar', 'via', 'vía',
        'partida', 'carrer', 'avinguda', 'placa', 'plaça', 'ronda', 'travesia', 'travesía',
        'urbanizacion', 'urbanización', 'poligono', 'polígono', 'grupo', 'sector',
        'cami', 'camí', 'passeig')


def curl(args, timeout=150):
    return subprocess.run(["curl", "-sSL", "--compressed", "--max-time", "120"] + args,
                          capture_output=True, text=True, timeout=timeout).stdout


def login():
    curl(["-c", COOKIES, "-o", os.devnull, EGO])
    cuerpo = urllib.parse.urlencode({"username": os.environ["EGO_USER"],
                                     "password": os.environ["EGO_PASS"],
                                     "remember_me": "false"})
    fd, tmp = tempfile.mkstemp()
    try:
        os.write(fd, cuerpo.encode()); os.close(fd)
        out = curl(["-b", COOKIES, "-c", COOKIES,
                    "-H", "Content-Type: application/x-www-form-urlencoded",
                    "-H", "Referer: " + EGO, "--data", "@" + tmp,
                    "-w", "\n%{url_effective}", EGO])
    finally:
        os.unlink(tmp)
    if "dashboard" not in out[-200:]:
        sys.exit("No he podido entrar en eGO: revisa EGO_USER / EGO_PASS.")
    print("  sesion iniciada en eGO")


def mapa_ref_id():
    """Pagina el listado del CRM para sacar referencia -> id interno."""
    mapa = {}
    for pagina in range(1, 80):
        out = curl(["-b", COOKIES, "-H", "X-Requested-With: XMLHttpRequest",
                    "-H", "Referer: " + EGO + "/realestates",
                    "-H", "Content-Type: application/x-www-form-urlencoded",
                    "--data", "typeSearch=1&page=%d" % pagina,
                    EGO + "/search/realestatesearch"])
        try:
            h = json.loads(out).get("replaces", {}).get("#RealestateListResults", "")
        except Exception:
            break
        items = re.split(r'class="listItem propertyItem"', h)[1:]
        if not items:
            break
        for it in items:
            mid = re.search(r'/egocore/realestate/(\d+)', it)
            mref = re.search(r'\b([A-Z]{2}-(?:[A-Z]-)?\d+(?:-[A-Z])?)\b', it)
            if mid and mref:
                mapa.setdefault(mref.group(1), mid.group(1))
        print(f"\r  listado: pagina {pagina}, {len(mapa)} referencias", end="", flush=True)
        if len(items) < 15:
            break
        time.sleep(0.3)
    print()
    return mapa


def _input(h, nombre):
    m = re.search(r'<input[^>]*name="' + re.escape(nombre) + r'"[^>]*>', h)
    if not m:
        return ""
    v = re.search(r'value="([^"]*)"', m.group(0))
    return html.unescape(v.group(1)).strip() if v else ""


def _select(h, nombre):
    m = re.search(r'<select[^>]*name="' + re.escape(nombre) + r'"[^>]*>(.*?)</select>', h, re.S)
    if not m:
        return ""
    s = re.search(r'<option[^>]*selected[^>]*>(.*?)</option>', m.group(1), re.S)
    return html.unescape(re.sub(r'<[^>]+>', '', s.group(1))).strip() if s else ""


def ficha(par):
    ref, pid = par
    tmp = os.path.join(tempfile.gettempdir(), f"ego_{pid}.html")
    try:
        curl(["-b", COOKIES, "-o", tmp, f"{EGO}/realestate/{pid}/edit"])
        h = open(tmp, encoding="utf-8", errors="replace").read()
    except Exception as e:
        return {"ref": ref, "error": str(e)}
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return {"ref": ref, "ref_ego": _input(h, "Reference"),
            "tipo_via": _select(h, "location[roadtype]"),
            "direccion": _input(h, "location[address]"),
            "numero": _input(h, "realestate[details][building_number]"),
            "cp": _input(h, "location[zipcode]")}


def direccion_legible(e):
    d = re.sub(r'\s+', ' ', (e.get("direccion") or "").strip()).strip(" ,")
    via = e.get("tipo_via") or ""
    if via and d and not d.lower().startswith(VIAS):
        d = f"{via} {d}"
    num = str(e.get("numero") or "").strip()
    if num and d and not re.search(r'[,\s]' + re.escape(num) + r'$', d):
        d = f"{d}, {num}"
    return d


def n8n(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(N8N + ruta, method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode() or "{}")


def escribir_pestana(filas):
    """Escribe la pestana via un workflow temporal de n8n (que tiene la credencial
    de Google Sheets). Se crea, se usa y se borra."""
    OPT = {"response": {"response": {"neverError": True, "fullResponse": True}}}
    nodos = [
        {"parameters": {"httpMethod": "POST", "path": "tmpescribirdirecciones",
                        "responseMode": "responseNode", "options": {}},
         "type": "n8n-nodes-base.webhook", "typeVersion": 2.1, "position": [0, 0],
         "id": "w", "name": "Webhook", "webhookId": "7a7a7a7a-1b1b-2c2c-3d3d-4e4e4e4e4e4e"},
        {"parameters": {"jsCode": "return [{ json: { cuerpo: JSON.stringify({ values: "
                                  "$input.first().json.body.values }) } }];"},
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [200, 0],
         "id": "p", "name": "Preparar"},
        {"parameters": {"method": "PUT",
                        "url": f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET}"
                               f"/values/Direcciones!A1?valueInputOption=RAW",
                        "authentication": "predefinedCredentialType",
                        "nodeCredentialType": "googleSheetsOAuth2Api",
                        "sendBody": True, "specifyBody": "json",
                        "jsonBody": "={{ $json.cuerpo }}", "options": OPT},
         "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [400, 0],
         "id": "h", "name": "Escribir", "onError": "continueRegularOutput",
         "credentials": CRED_SHEETS},
        {"parameters": {"respondWith": "text",
                        "responseBody": "={{ JSON.stringify($json.body || $json) }}",
                        "options": {"responseCode": 200}},
         "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.5,
         "position": [600, 0], "id": "r", "name": "Respond"},
    ]
    conex = {"Webhook": {"main": [[{"node": "Preparar", "type": "main", "index": 0}]]},
             "Preparar": {"main": [[{"node": "Escribir", "type": "main", "index": 0}]]},
             "Escribir": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]}}
    wf = n8n("POST", "/api/v1/workflows", {"name": "TMP_EscribirDirecciones",
             "settings": {"executionOrder": "v1", "timezone": "Europe/Madrid"},
             "nodes": nodos, "connections": conex})
    try:
        n8n("POST", f"/api/v1/workflows/{wf['id']}/activate")
        time.sleep(4)
        req = urllib.request.Request(N8N + "/webhook/tmpescribirdirecciones", method="POST",
                                     data=json.dumps({"values": filas}).encode(),
                                     headers={"Content-Type": "application/json"})
        print("  ", urllib.request.urlopen(req, timeout=180).read().decode()[:200])
    finally:
        n8n("DELETE", f"/api/v1/workflows/{wf['id']}")


def main():
    escribir = "--escribir" in sys.argv
    login()
    mapa = mapa_ref_id()

    print(f"  leyendo {len(mapa)} fichas del CRM...")
    objetivo = mapa
    with ThreadPoolExecutor(max_workers=5) as ex:
        fichas = list(ex.map(ficha, objetivo.items()))

    con = [f for f in fichas if f.get("direccion")]
    print(f"  fichas leidas: {len(fichas)} | con direccion: {len(con)}")

    filas = [["ref", "direccion", "numero", "cp", "origen"]]
    for f in sorted(fichas, key=lambda x: x["ref"]):
        d = direccion_legible(f)
        if d:
            filas.append([f["ref"], d, str(f.get("numero") or ""), str(f.get("cp") or ""), "eGO CRM"])

    print(f"  filas a escribir: {len(filas) - 1}")
    for f in filas[1:6]:
        print(f"     {f[0]:12} {f[1]}")
    if escribir:
        escribir_pestana(filas)
        print("  pestana Direcciones actualizada")
    else:
        print("\n  (sin --escribir: no se ha tocado la hoja)")


if __name__ == "__main__":
    main()
