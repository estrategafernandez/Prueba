/**
 * Parser de los listados de inmobiliariaceballos.com
 *
 * Este fichero es la COPIA DE REFERENCIA del nodo Code "ParsearListados" del
 * workflow ceballos_inmuebles.json. Se mantiene aquí aparte para poder probarlo
 * con Node sin tener que abrir n8n. Si tocas uno, toca el otro.
 *
 * El sitio es una app ASP.NET que sirve HTML plano: no hace falta navegador.
 * Cada inmueble es un bloque  <div id="{idFicha}" class="row property-row" ...>
 * y la cabecera del listado lleva el total en  <span id="sTotInm">141</span>,
 * que usamos como suma de control del parseo.
 */

const ENTIDADES = {
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
  '&ntilde;': 'ñ', '&Ntilde;': 'Ñ', '&uuml;': 'ü', '&nbsp;': ' ',
  '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
};

function decodificar(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;/g, (e) => ENTIDADES[e] ?? e)
    .replace(/&amp;/g, '&'); // siempre el último, si no se re-decodifican entidades
}

const texto = (s) => decodificar(String(s ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** "665.000 €" -> 665000 · "1.200,50 €" -> 1200.5 · "Consultar" -> null */
function aNumero(s) {
  const m = String(s ?? '').replace(/\./g, '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "224 m²" -> 224 · "5 Hab." -> 5 · "" -> null */
function aEntero(s) {
  const m = String(s ?? '').replace(/\./g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

const BASE = 'https://www.inmobiliariaceballos.com';

/**
 * La agencia publica 99.999.999 € cuando el precio es "a consultar" (visto en
 * la ficha C-849 / id 695169, un chalet real). Si se guardase tal cual
 * envenenaría cualquier media, máximo o filtro por precio, así que se guarda
 * como precio nulo con la marca precio_a_consultar.
 */
const PRECIO_CENTINELA = 99999999;

function parsearListado(html, { operacion, provincia }) {
  const totalWeb = aEntero((html.match(/id="sTotInm"[^>]*>(\d+)</) || [])[1]);

  // Cada bloque empieza en el <div id="NNN" class="row property-row">
  const bloques = String(html).split(/(?=<div id="\d+" class="row property-row)/).slice(1);

  const inmuebles = [];
  for (const b of bloques) {
    const idFicha = aEntero((b.match(/^<div id="(\d+)"/) || [])[1]);
    if (!idFicha) continue;

    const saca = (re) => { const m = b.match(re); return m ? texto(m[1]) : ''; };

    // El alt de la foto trae "TIPO. ZONA" de forma consistente; el <h2> a veces
    // es un titular comercial, así que el tipo NO se puede sacar de ahí.
    const alt = saca(/alt="([^"]*)"/);
    const corte = alt.indexOf('.');
    const tipo = corte === -1 ? alt : alt.slice(0, corte).trim();
    const zona = corte === -1 ? '' : alt.slice(corte + 1).trim();

    const precioTexto = saca(/<div class="col-sm-5"><strong class="txt15">([\s\S]*?)<\/strong>/);
    let precio = aNumero(precioTexto);
    const aConsultar = precio !== null && precio >= PRECIO_CENTINELA;
    if (aConsultar) precio = null;

    inmuebles.push({
      id_ficha: idFicha,
      operacion,
      provincia,
      referencia: saca(/PropertyDetail\/\d+"><strong>([^<]+)<\/strong>/) || null,
      tipo: tipo || null,
      zona: zona || null,
      titulo: saca(/<h2>([\s\S]*?)<\/h2>/) || null,
      precio,
      precio_texto: precioTexto || null,
      precio_a_consultar: aConsultar,
      superficie_m2: aEntero(saca(/fa-square"><\/i>\s*([^<]*)</)),
      habitaciones: aEntero(saca(/fa-bed"><\/i>\s*([^<]*)</)),
      banos: aEntero(saca(/fa-bath"><\/i>\s*([^<]*)</)),
      url: `${BASE}/es-ES/Content/PropertyDetail/${idFicha}`,
    });
  }

  return { operacion, provincia, totalWeb, inmuebles };
}

module.exports = { parsearListado, decodificar, texto, aNumero, aEntero, BASE, PRECIO_CENTINELA };
