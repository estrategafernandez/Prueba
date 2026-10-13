// [TEL] EnviarPorWhatsApp · ComponerMensaje
// Con los inmuebles que ha devuelto wa_cartera, monta el texto de la plantilla
// abierta que recibe el cliente por WhatsApp. Los enlaces salen SIEMPRE de la
// cartera, nunca de lo que diga el modelo: asi la direccion web es la de verdad.
const p = $('LeerPeticion').first().json;
const encontrados = $input.all().map(i => i.json).filter(r => r && r.ref && r.enlace);

// En el mismo orden en el que los ha dicho Sara por telefono
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const porRef = new Map(encontrados.map(r => [norm(r.ref), r]));
const inmuebles = p.refs.map(r => porRef.get(norm(r))).filter(Boolean);
const sinEnlace = p.refs.filter(r => !porRef.has(norm(r)));

const t = TEXTOS_ENLACES_TEL[p.idioma] || TEXTOS_ENLACES_TEL.es;
// En la plantilla solo va el nombre de pila, como en la bienvenida
const dePila = String(p.nombre ?? '').trim().split(/\s+/)[0];
const nombre = /^[\p{L}][\p{L}'-]*$/u.test(dePila) ? dePila : '';
const precioTexto = (r) => {
  const n = Math.round(Number(r.precio) || 0);
  if (!n) return '';
  const alquiler = String(r.tipo_transaccion || '').toLowerCase().includes('alquil');
  return `${n.toLocaleString('es-ES')} €${alquiler ? t.al_mes : ''}`;
};
// "El piso de Benicasim por 185.000 €: https://..."
const uno = (r) => {
  const sitio = [r.tipo_inmueble, r.zona || municipioCorto(r.municipio)].filter(Boolean).join(' en ');
  const precio = precioTexto(r);
  return [sitio + (precio ? ` ${t.por} ${precio}` : ''), r.enlace].filter(Boolean).join(': ');
};

const texto = !inmuebles.length ? ''
  : inmuebles.length === 1
    ? `${t.uno} ${uno(inmuebles[0])}${t.cierre_uno}`
    : `${t.varios} ${inmuebles.map((r, i) => `${i + 1}) ${uno(r)}`).join(' · ')}${t.cierre_varios}`;

// Lo que Sara tiene que hacer segun como haya ido
const mensaje = !p.puede
  ? (p.motivos.includes('telefono_invalido')
      ? 'No tengo un numero de WhatsApp valido: pideselo y vuelve a intentarlo.'
      : 'No me has dicho de que inmuebles mandar el enlace: dime las referencias.')
  : !inmuebles.length
    ? 'No he podido encontrar esos inmuebles en la cartera, asi que NO se ha mandado nada. No le digas al cliente que se lo has mandado.'
    : `Mandado por WhatsApp al ${p.telefono_e164}. Diselo al cliente ("ya te lo he mandado por WhatsApp a este mismo numero") y preguntale si quiere verlo con la asesora.`
      + (sinEnlace.length ? ` OJO: de ${sinEnlace.join(', ')} no habia enlace, asi que ese no ha ido.` : '');

const enviar = p.puede && inmuebles.length > 0;

return [{ json: {
  ...p,
  enviar,
  // El primero es el inmueble que queda como "el que pidio" para Sara (WhatsApp)
  referencia: inmuebles.length ? inmuebles[0].ref : '',
  enlace: inmuebles.length ? inmuebles[0].enlace : '',
  operacion: inmuebles.length ? String(inmuebles[0].tipo_transaccion || '') : '',
  es_alquiler: inmuebles.length ? String(inmuebles[0].tipo_transaccion || '').toLowerCase().includes('alquil') : false,
  asesora: inmuebles.length ? resolverAsesora(inmuebles[0].ref).destinatario : '',
  referencias_enviadas: enviar ? inmuebles.map(r => r.ref) : [],
  sin_enlace: sinEnlace,
  // El nombre de la plantilla y su {{2}}
  plantilla: PLANTILLAS.abierta.nombre,
  param1: paramPlantilla(nombre || '-', 60),
  param2: paramPlantilla(texto, 900),
  respuesta: {
    enviado: enviar,
    inmuebles_enviados: enviar ? inmuebles.length : 0,
    mensaje_para_sara: mensaje,
  },
} }];
