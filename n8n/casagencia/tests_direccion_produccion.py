import json, re, urllib.request, time, sys
U = "https://n8n-casagencia.serversvisionarius.com/webhook"

def post(path, payload):
    r = urllib.request.Request(f"{U}/{path}", method="POST",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    for intento in range(3):
        try:
            with urllib.request.urlopen(r, timeout=45) as x:
                return json.loads(x.read().decode())
        except Exception as e:
            if intento == 2: return {"error": str(e)}
            time.sleep(2)

GENERICO = re.compile(r'plaza de (garaje|parking|aparcamiento)|urbanizaci[oó]n (residencial|muy conocida|en zona)|calle principal', re.I)
casos = [c for c in json.load(open('casos_direccion.json')) if not GENERICO.search(c['via'])]

print(f"CASOS DE PRUEBA: {len(casos)} inmuebles con calle real en su descripcion\n")
print(f"{'consulta':<42} {'esperado':<13} {'resultado':<13} {'pos':>4}  fiab")
print("-" * 88)
ok1 = okN = fallo = 0
for c in casos:
    q = c['via']
    r = post("buscarpordireccion", {"direccion": q})
    refs = [x['ref'] for x in r.get('coincidencias', [])] if r.get('encontrado') else []
    pos = refs.index(c['ref']) + 1 if c['ref'] in refs else 0
    if pos == 1: ok1 += 1
    elif pos > 1: okN += 1
    else: fallo += 1
    marca = {1: 'OK', 0: 'FALLA'}.get(pos, 'ok(N)')
    print(f"{q[:41]:<42} {c['ref']:<13} {(refs[0] if refs else '-'):<13} {marca:>5}  {r.get('fiabilidad','-')}")
print("-" * 88)
t = len(casos)
print(f"acierto en 1a posicion: {ok1}/{t} ({ok1*100//t}%)   en top-3: {ok1+okN}/{t} ({(ok1+okN)*100//t}%)   no encontrado: {fallo}/{t}")
