import json, urllib.request, time
U = "https://n8n-casagencia.serversvisionarius.com/webhook"
def post(p, d):
    r = urllib.request.Request(f"{U}/{p}", method="POST", data=json.dumps(d).encode(),
                               headers={"Content-Type": "application/json"})
    time.sleep(1.2)
    for i in range(3):
        try:
            with urllib.request.urlopen(r, timeout=45) as x:
                b = x.read().decode()
                try: return json.loads(b)
                except: return {"_texto": b}
        except Exception as e:
            if i == 2: return {"error": str(e)}
            time.sleep(2)

fallos = []
def check(nombre, cond, detalle=''):
    print(f"  {'OK   ' if cond else 'FALLA'}  {nombre}" + (f"   -> {detalle}" if detalle else ""))
    if not cond: fallos.append(nombre)

print("=== A) COMO HABLA UN CLIENTE DE VERDAD (busqueda por direccion) ===")
frases = [
    ("es el piso de la calle Alloza",                      ['CS-G-227-V','CS-1248-A']),
    ("llamo por el de la avenida Lidón",                   ['CS-G-387-A']),
    ("el apartamento del paseo Bernat Artola numero 12",   ['BN-1551-A']),
    ("vi uno en la plaza Fadrell de Castellon",            ['CS-1479-A']),
    ("el chalet de la urbanizacion Torrebellver",          ['BN-1534-V']),
    ("calle Tombatossals, en Oropesa",                     ['OR-1513-V']),
    ("avenida pio doce de villarreal",                     ['VR-C-102-V']),
    ("plaza huerto sogueros",                              ['CS-G-365-V']),
]
for frase, esperados in frases:
    r = post("buscarpordireccion", {"direccion": frase})
    refs = [x['ref'] for x in r.get('coincidencias', [])] if r.get('encontrado') else []
    check(f'"{frase[:46]}"', bool(set(refs) & set(esperados)), f"{refs or 'no encontrado'}")

print("\n=== B) CALLES REALES DE LA CARTERA (deben encontrarse) ===")
for frase, esp in [("calle del Mestre Falla 39", "CS-1479-A"), ("gran via 55", None)]:
    r = post("buscarpordireccion", {"direccion": frase})
    refs = [x['ref'] for x in r.get('coincidencias', [])] if r.get('encontrado') else []
    check(f'"{frase}" -> encontrado', bool(refs) and (esp is None or esp in refs), str(refs))

print("\n=== B2) NEGATIVOS: calles que NO estan en la cartera ===")
for frase in ["avenida de Roma 4", "calle Inventada del Sol 200", "plaza Mayor de Madrid",
              "calle Ficticia de los Pinares 88"]:
    r = post("buscarpordireccion", {"direccion": frase})
    check(f'"{frase}" -> no encontrado', r.get('encontrado') is False, r.get('motivo'))

print("\n=== C) CONSULTAS DEMASIADO VAGAS ===")
for frase in ["calle", "el centro", "una calle", "aaaa bbbb cccc"]:
    r = post("buscarpordireccion", {"direccion": frase})
    check(f'"{frase}" -> no devuelve listado', r.get('encontrado') is False,
          f"{r.get('motivo')} ({len(r.get('coincidencias',[]))} resultados)")

print("\n=== D) BUSQUEDA POR REFERENCIA (formatos) ===")
for ref, debe in [("CS-1479-A", True), ("cs-1479-a", True), ("CS1479A", True),
                  ("CS-G-403-V", True), ("csg403v", True), ("BN-1547-V", True),
                  ("ZZ-9999-X", False), ("CS-9999-V", False)]:
    r = post("buscardisponibilidadporreferencia", {"referencia": ref})
    t = r.get("_texto", json.dumps(r))
    enc = "He encontrado" in t
    check(f'referencia "{ref}"', enc == debe, t[:90].replace('\n',' '))

print("\n=== E) BUSQUEDA POR MUNICIPIO Y CARACTERISTICAS ===")
casos = [
    ({"operacion":"alquiler","municipio":"Castellón de la Plana / Castelló de la Plana","habitaciones":4,"precio_min":0}, True),
    ({"operacion":"venta","municipio":"Benicasim / Benicàssim","habitaciones":3,"precio_min":0}, True),
    ({"operacion":"venta","municipio":"Benicasim / Benicàssim","habitaciones":3,"precio_min":250000}, True),
    ({"operacion":"venta","municipio":"Oropesa del Mar / Orpesa","habitaciones":0,"precio_min":0}, True),
    ({"operacion":"alquiler","municipio":"Vilafamés","habitaciones":5,"precio_min":0}, False),
    ({"operacion":"venta","municipio":"Benicasim / Benicàssim","habitaciones":3,"precio_min":9000000}, False),
]
for body, debe in casos:
    r = post("buscarinmuebles", body)
    t = r.get("_texto", json.dumps(r))
    enc = t.startswith("He encontrado")
    n = t.split()[2] if enc and t.startswith("He encontrado") else "0"
    check(f"{body['operacion']:9} {body['municipio'].split(' / ')[0]:22} hab>={body['habitaciones']} precio>={body['precio_min']}",
          enc == debe, f"{n} inmuebles")

print("\n" + ("*** " + str(len(fallos)) + " FALLOS: " + "; ".join(fallos) if fallos else "*** TODO CORRECTO ***"))
