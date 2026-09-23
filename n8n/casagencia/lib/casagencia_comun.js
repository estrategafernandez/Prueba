// ===========================================================================
// CASAGENCIA · LIBRERIA COMUN DEL ASISTENTE TELEFONICO
// ---------------------------------------------------------------------------
// Este bloque se inyecta automaticamente al principio de los nodos Code de
// los workflows BuscarDisponibilidadCalendario, ConfirmarCitaCalendario y
// BuscarCitaPorTelefono.
//
// NO editar a mano dentro de n8n: editar este fichero y volver a desplegar
// con  python3 n8n/casagencia/build_workflows.py --deploy
// ===========================================================================

const ZONA = 'Europe/Madrid';

// --- Horario de oficina de cada asesora ------------------------------------
// La visita dura 1 hora y tiene que caber ENTERA dentro de un bloque.
const HORARIOS = {
  Carmen: { lv: [['09:30', '14:00'], ['16:00', '19:30']], sab: [['10:00', '14:00']], dom: null },
  Gisela: { lv: [['09:00', '14:00'], ['16:00', '19:00']], sab: null,                 dom: null }
};

// --- Festivos ---------------------------------------------------------------
// GUARDAFUEGOS: no depende de que la comercial bloquee nada en su calendario.
// TODOS  = festivos nacionales y de la Comunitat Valenciana (fecha fija).
// BN/OR/CS/VR = fiestas locales de cada zona. RELLENAR CADA ANO.
const FESTIVOS = {
  TODOS: [
    '2026-10-09', // Dia de la Comunitat Valenciana
    '2026-10-12', // Fiesta Nacional
    '2026-11-01', // Todos los Santos
    '2026-12-06', // Constitucion
    '2026-12-08', // Inmaculada
    '2026-12-25', // Navidad
    '2027-01-01', '2027-01-06', '2027-05-01', '2027-08-15',
    '2027-10-09', '2027-10-12', '2027-11-01', '2027-12-06', '2027-12-08', '2027-12-25'
  ],
  BN: [], // Benicasim  -> fiestas locales: ANADIR
  OR: [], // Oropesa    -> fiestas locales: ANADIR
  CS: [], // Castellon  -> fiestas locales (Magdalena, etc.): ANADIR
  VR: []  // Vila-real  -> fiestas locales: ANADIR
};

// --- Routing de asesora (ARREGLO #7: mapeo explicito, sin fallback silencioso)
const ASESORA_POR_PREFIJO = { BN: 'Carmen', OR: 'Carmen', CS: 'Gisela', VR: 'Gisela' };
const CALENDARIO_POR_ASESORA = {
  Carmen: 'carmen@casagencia.com',
  Gisela: 'gisela@casagencia.com'
};
const CALENDARIO_POR_DEFECTO = 'gisela@casagencia.com'; // solo para que el nodo no reviente

// --- Titulos de eventos de dia completo que SI bloquean el dia (ARREGLO #8) --
const RE_DIA_BLOQUEANTE = /vacacion|vacanc|baja|festiv|cerrad|ausent|no disponible|libranza|asuntos propios/i;

// ---------------------------------------------------------------------------
// Telefonos (ARREGLO #12)
// ---------------------------------------------------------------------------
function normalizarTelefono(raw) {
  let s = String(raw ?? '').trim();
  const teniaMas = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!teniaMas && s.startsWith('00')) s = s.slice(2);
  if (/^[6789]\d{8}$/.test(s)) s = '34' + s;          // movil/fijo espanol sin prefijo
  const nacional = s.startsWith('34') ? s.slice(2) : s;
  return {
    e164: s ? '+' + s : '',
    nacional,
    digitos: s,
    valido: s.length >= 8 && s.length <= 15,
    original: String(raw ?? '')
  };
}

// ---------------------------------------------------------------------------
// Referencias y asesora
// ---------------------------------------------------------------------------
function prefijoDeReferencia(ref) {
  const m = String(ref ?? '').toUpperCase().match(/[A-Z]{2}/);
  return m ? m[0] : '';
}

function resolverAsesora(ref) {
  const prefijo = prefijoDeReferencia(ref);
  const asesora = ASESORA_POR_PREFIJO[prefijo] || null;
  return {
    prefijo,
    asesora,
    conocida: !!asesora,
    calendario: asesora ? CALENDARIO_POR_ASESORA[asesora] : CALENDARIO_POR_DEFECTO
  };
}

// ---------------------------------------------------------------------------
// Alquiler: NO se agenda visita (peticion de Casagencia, sept. 2026)
// ---------------------------------------------------------------------------
// El mercado de alquiler esta muy tensionado y la mitad de los interesados no
// pasa la criba de la asesora. Si Sara agendase todas las visitas, el calendario
// se llenaria de citas que luego hay que deshacer. Asi que en alquiler Sara
// cualifica al cliente y pasa el aviso: la asesora llama y agenda ella.
//
// Las referencias de alquiler acaban en -A y las de venta en -V, pero hay algun
// caso suelto (un traspaso de local marcado como alquiler con referencia -V).
// Por eso basta con que CUALQUIERA de las dos senales diga alquiler.
function esPeticionAlquiler(referencia, tipoTransaccion) {
  const t = String(tipoTransaccion ?? '').toLowerCase();
  if (t.includes('alquiler') || t.includes('traspaso') || t.includes('rent')) return true;
  return /-A$/i.test(String(referencia ?? '').trim());
}

const MSG_ALQUILER_SIN_AGENDA =
  'En alquiler NO se agenda la visita desde aqui. Explicale al cliente con naturalidad que, ' +
  'por la cantidad de solicitudes que hay, es la asesora de la zona quien organiza las visitas ' +
  'de alquiler y le va a llamar para concretarla. Antes de despedirte, hazle las preguntas de ' +
  'cualificacion de alquiler y registra el aviso con registrarMensaje.';

// ---------------------------------------------------------------------------
// Horario / festivos
// ---------------------------------------------------------------------------
function esFestivo(fecha, prefijo) {
  const lista = [].concat(FESTIVOS.TODOS || [], FESTIVOS[prefijo] || []);
  return lista.includes(fecha);
}

function bloquesDelDia(fecha, asesora) {
  const h = HORARIOS[asesora] || HORARIOS.Gisela;
  const wd = DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: ZONA }).weekday;
  if (wd === 7) return h.dom;
  if (wd === 6) return h.sab;
  return h.lv;
}

// Devuelve { valido, motivo } para una fecha+hora concretas.
// motivo: ok | formato | pasado | cerrado | festivo | fuera_horario
function validarFranja(fecha, hora, asesora, prefijo, ahora) {
  const ini = DateTime.fromFormat(`${fecha} ${hora}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
  if (!ini.isValid) return { valido: false, motivo: 'formato' };
  if (ini < ahora) return { valido: false, motivo: 'pasado' };
  if (esFestivo(fecha, prefijo)) return { valido: false, motivo: 'festivo' };

  const bloques = bloquesDelDia(fecha, asesora);
  if (!bloques || !bloques.length) return { valido: false, motivo: 'cerrado' };

  const fin = ini.plus({ hours: 1 });
  const cabe = bloques.some(([a, b]) => {
    const ba = DateTime.fromFormat(`${fecha} ${a}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
    const bb = DateTime.fromFormat(`${fecha} ${b}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
    return ini >= ba && fin <= bb;
  });
  return cabe ? { valido: true, motivo: 'ok' } : { valido: false, motivo: 'fuera_horario' };
}

// ---------------------------------------------------------------------------
// Ocupacion del calendario (ARREGLO #8)
// ---------------------------------------------------------------------------
// Un evento de dia completo (cumpleanos, recordatorio, calendario de festivos
// importado...) ya NO borra el dia entero. Solo bloquea si su titulo indica
// ausencia real. Tambien se respeta transparency='transparent' (marcado Libre).
function rangosOcupados(items) {
  const out = [];
  for (const it of items) {
    const j = (it && it.json) ? it.json : it;
    if (!j || !j.start) continue;
    if (j.status === 'cancelled') continue;
    if (j.transparency === 'transparent') continue;

    if (!j.start.dateTime) {
      if (!RE_DIA_BLOQUEANTE.test(String(j.summary || ''))) continue; // no bloquea
      const d0 = DateTime.fromISO(j.start.date, { zone: ZONA }).startOf('day');
      const d1 = j.end && j.end.date
        ? DateTime.fromISO(j.end.date, { zone: ZONA }).startOf('day')
        : d0.plus({ days: 1 });
      out.push({ start: d0, end: d1, titulo: j.summary || '', diaCompleto: true });
      continue;
    }

    const s = DateTime.fromISO(j.start.dateTime, { zone: ZONA });
    const e = j.end && j.end.dateTime
      ? DateTime.fromISO(j.end.dateTime, { zone: ZONA })
      : s.plus({ hours: 1 });
    out.push({ start: s, end: e, titulo: j.summary || '', diaCompleto: false });
  }
  return out;
}

function estaLibre(fecha, hora, ocupados) {
  const ini = DateTime.fromFormat(`${fecha} ${hora}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
  const fin = ini.plus({ hours: 1 });
  return !ocupados.some(o => ini < o.end && fin > o.start);
}

// Huecos validos de un dia (respeta horario, festivos y ocupacion)
function huecosDelDia(fecha, asesora, prefijo, ocupados, ahora) {
  if (esFestivo(fecha, prefijo)) return [];
  const bloques = bloquesDelDia(fecha, asesora);
  if (!bloques || !bloques.length) return [];
  const huecos = [];
  for (const [a, b] of bloques) {
    let cursor = DateTime.fromFormat(`${fecha} ${a}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
    const finBloque = DateTime.fromFormat(`${fecha} ${b}`, 'yyyy-MM-dd HH:mm', { zone: ZONA });
    while (cursor.plus({ hours: 1 }) <= finBloque) {
      if (cursor >= ahora && estaLibre(fecha, cursor.toFormat('HH:mm'), ocupados)) {
        huecos.push(cursor.toFormat('HH:mm'));
      }
      cursor = cursor.plus({ minutes: 30 });
    }
  }
  return huecos;
}

const DIAS = ['', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreDia(fecha) {
  const d = DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: ZONA });
  if (!d.isValid) return fecha;
  return `${DIAS[d.weekday]} ${d.day} de ${MESES[d.month]}`;
}
// ======================= FIN LIBRERIA COMUN ================================
