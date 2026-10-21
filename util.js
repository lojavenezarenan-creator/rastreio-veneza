const cheerio = require('cheerio');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'manual',
      ...opts,
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Junta os Set-Cookie de uma resposta num "jar" simples (objeto nome->valor). */
function guardarCookies(res, jar) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of lista) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    if (i > 0) jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const limpa = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/(\s*·\s*)+/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();

/**
 * Transforma HTML em dados seguros (só texto): tabelas viram linhas/células
 * e o restante vira parágrafos. Nada de HTML da transportadora chega ao cliente.
 */
function htmlParaDados(html, { ignorar = [] } = {}) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, form input[type=hidden], head').remove();
  ignorar.forEach((sel) => $(sel).remove());
  $('br').replaceWith(' · ');

  const tabelas = [];
  const BLOCOS = 'h1,h2,h3,h4,h5,h6,p,li,div,caption,table';
  // Título da tabela: <caption> ou o texto curto que vem logo antes dela (ex.: <h6>Eventos</h6>)
  const tituloDe = (tb) => {
    const cap = limpa($(tb).children('caption').text());
    if (cap) return { texto: cap };
    for (let el = $(tb); el.length && !el.is('body'); el = el.parent()) {
      const ant = el.prevAll().filter((__, e) => limpa($(e).text())).first();
      if (ant.length) {
        const t = limpa(ant.text());
        return t.length <= 40 && !ant.find('table').length ? { texto: t, el: ant } : { texto: '' };
      }
    }
    return { texto: '' };
  };
  // Só tabelas "folha" (sem tabela dentro) para evitar layout antigo em tabelas aninhadas
  $('table').each((_, tb) => {
    if ($(tb).find('table').length) return;
    const { texto: titulo, el: elTitulo } = tituloDe(tb);
    if (elTitulo) elTitulo.remove();
    const linhas = [];
    $(tb)
      .find('tr')
      .each((__, tr) => {
        const cel = $(tr)
          .children('th,td')
          .map((___, td) => limpa($(td).text()))
          .get();
        if (cel.some((c) => c)) linhas.push(cel);
      });
    if (linhas.length) tabelas.push({ titulo, linhas });
    $(tb).remove();
  });

  // Textos: só blocos "folha" (sem outros blocos dentro), para não repetir trechos
  const textos = [];
  $('body')
    .find(BLOCOS)
    .each((_, el) => {
      if ($(el).find(BLOCOS).length) return;
      const t = limpa($(el).text());
      if (t && t.length < 400 && !textos.includes(t)) textos.push(t);
    });
  // Texto solto direto no body (fragmentos sem blocos)
  if (!textos.length) {
    const t = limpa($('body').text());
    if (t) textos.push(t.slice(0, 400));
  }

  return { tabelas, textos };
}

function soDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

module.exports = { http, guardarCookies, cookieHeader, htmlParaDados, soDigitos, limpa, UA };
