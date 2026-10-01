// [EGO][SUB] Llamar a eGO · Sesion
// La sesion de eGO (token JWT + agencia) dura un rato: se guarda en Redis y se
// reutiliza. Si no hay, se hace login con la credencial "eGO API" (usuario y
// contrasena van en la credencial, no aqui) y, si el usuario tiene varias
// agencias, se entra en la de Casagencia.
const start = $('Start').first().json;
const parse = (v) => {
  if (v == null || v === '') return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return {}; }
};
let sesion = {};
try { sesion = parse($('LeerSesion').first().json.sesion); } catch (e) { sesion = {}; }
let login = {};
try { login = $('Login').first().json || {}; } catch (e) { login = {}; }
let entrar = {};
try { entrar = $('EntrarEnLaAgencia').first().json || {}; } catch (e) { entrar = {}; }

const elegida = (login.applicationsAvailable || []).find(a => /casagencia/i.test(String(a.name || '')))
  || (login.applicationsAvailable || [])[0] || {};
const nueva = entrar.token ? entrar : login;
if (!sesion.token && nueva.token) {
  sesion = {
    token: nueva.token,
    applicationId: nueva.applicationId || elegida.id || login.applicationId || null,
    securityUserId: nueva.securityUserId || login.securityUserId || null,
  };
}

const query = parse(start.query);
if (sesion.applicationId && query.applicationId == null) query.applicationId = sesion.applicationId;
const cuerpo = parse(start.cuerpo);
if (sesion.applicationId && cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
    && Object.keys(cuerpo).length && cuerpo.applicationId == null) cuerpo.applicationId = sesion.applicationId;

return [{ json: {
  hay_sesion: !!sesion.token,
  sesion_nueva: !!(nueva.token && !$('LeerSesion').first().json.sesion),
  sesion_texto: JSON.stringify(sesion),
  token: sesion.token || '',
  metodo: String(start.metodo || 'GET').toUpperCase(),
  url: 'https://api.egocrm.com' + String(start.ruta || '').replace(/^([^/])/, '/$1'),
  query,
  cuerpo,
  con_cuerpo: String(start.metodo || 'GET').toUpperCase() !== 'GET',
  login_error: !sesion.token ? String(login.title || login.message || login.error?.message || 'sin token') : '',
} }];
