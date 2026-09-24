// ===== ENTRADA =====
const raw  = ($('Webhook').first().json.body.referencia || '').toString();
const rows = $('BuscarInmueblesTodos').all().map(i => i.json).filter(r => r && r.ref);

// Direcciones puestas a mano por la agencia (pestana "Direcciones"). Si la
// pestana falla o esta vacia, el resto sigue funcionando igual que antes.
const dirs = {};
try {
  for (const it of $('LeerDirecciones').all()) {
    const j = (it && it.json) ? it.json : {};
    if (j.ref && j.direccion) dirs[String(j.ref).trim().toUpperCase()] = String(j.direccion).trim();
  }
} catch (e) { /* sin pestana de direcciones */ }

// Si no hay cartera, NO es que la referencia no exista: es una incidencia.
if (!rows.length) {
  return [{ json: { result: 'No he podido consultar la cartera por un problema tecnico. NO le digas al cliente que ese inmueble no existe: discupate, explica que ha habido una incidencia y ofrece registrar un mensaje para que la asesora le llame.' } }];
}

// ===== HELPERS =====
const norm = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Extrae prefijo (2 primeras letras) y el grupo de digitos mas largo.
// Agnostico al formato: vale para BN-1543-V y para CS-G-397-V.
const partes = s => {
  const n = norm(s);
  const pref = (n.match(/^[A-Z]{2}/) || [''])[0];
  const nums = (n.match(/\d+/g) || []).sort((a, b) => b.length - a.length);
  return { n, pref, num: nums[0] || '' };
};

// Formatea una fila del Sheet al mismo estilo que buscarInmuebles
const fmt = r => {
  const partesTxt = [
    `${r.tipo_inmueble || 'Inmueble'} en ${r.zona || r.municipio || ''}`.trim(),
    `referencia ${r.ref}`,
    r.habitaciones ? `${r.habitaciones} habitaciones` : '',
    r.banos ? `${r.banos} baños` : '',
    r.precio ? `${r.precio}€` : '',
    r.tipo_transaccion ? `operación ${r.tipo_transaccion}` : '',
  ].filter(Boolean);
  let out = partesTxt.join(', ') + '.';
  const dir = dirs[String(r.ref).trim().toUpperCase()];
  if (dir) out += ` Direccion: ${dir}.`;
  if (r.caracteristicas) out += ` Características: ${r.caracteristicas}.`;
  if (r.descripcion)     out += ` Descripción: ${r.descripcion}`;
  return out;
};

const salida = ms => ms.length === 1
  ? { result: `He encontrado el inmueble. ${fmt(ms[0])}` }
  : { result: `He encontrado ${ms.length} inmuebles que encajan. ` +
      ms.slice(0, 3).map((r, i) => `Opción ${i + 1}: ${fmt(r)}`).join(' | ') +
      ' Pregunta al cliente por algún detalle que las distinga para saber cuál es la suya.' };

// ===== LOGICA =====
const q = partes(raw);
if (!q.n) {
  return [{ json: { result: 'No he recibido ninguna referencia. Pide al cliente que la dicte despacio.' } }];
}

const idx = rows.map(r => ({ r, p: partes(r.ref) }));

// 1) Exacta (ignorando guiones, espacios y mayusculas)
let m = idx.filter(x => x.p.n === q.n);

// 2) Prefijo + numero: es unico en toda la cartera.
//    Ignora la letra intermedia (C/G/M) y la final (V/A), que son las que se pierden por telefono.
if (!m.length && q.pref && q.num) {
  m = idx.filter(x => x.p.pref === q.pref && x.p.num === q.num);
}

// 3) Solo numero (el cliente no dio prefijo o se entendio mal)
if (!m.length && q.num) {
  m = idx.filter(x => x.p.num === q.num);
}

if (m.length) return [{ json: salida(m.map(x => x.r)) }];

// 4) Numero parecido dentro del mismo prefijo (un digito bailado)
if (q.pref && q.num) {
  const cerca = idx
    .filter(x => x.p.pref === q.pref && x.p.num.length === q.num.length &&
                 [...x.p.num].filter((c, i) => c !== q.num[i]).length === 1)
    .slice(0, 3)
    .map(x => x.p.num);
  if (cerca.length) {
    return [{ json: { result: `No localizo esa referencia. En la cartera hay números parecidos con ese prefijo: ${cerca.join(', ')}. Pregunta al cliente si su número puede ser alguno de esos, mencionando solo el número, nunca la referencia completa.` } }];
  }
}

return [{ json: { result: `No localizo la referencia ${raw}. Pide al cliente que te diga solo el número de la referencia, despacio, cifra a cifra: es la parte que la identifica.` } }];