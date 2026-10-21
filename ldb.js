// LDB Transporte de Cargas — "Consulta pública" do sistema em http://179.190.43.254:9091/
// É um formulário ASP.NET: precisa ler __VIEWSTATE/__EVENTVALIDATION e reenviar com
// txtCnpj, txtNumero e o clique no botão-imagem btnConsultar.
// Não encontrado -> a mesma página volta com "Conhecimento não encontrado."
const cheerio = require('cheerio');
const { http, guardarCookies, cookieHeader, htmlParaDados, soDigitos } = require('./util');

const BASE = process.env.LDB_URL || 'http://179.190.43.254:9091/';
const LINK = 'https://ldbcargas.com.br/';

async function rastrear(doc, nf) {
  const jar = {};

  // 1) Abre a página para pegar os campos ocultos e o cookie de sessão
  const r1 = await http(BASE);
  guardarCookies(r1, jar);
  if (!r1.ok) throw new Error(`LDB respondeu HTTP ${r1.status}`);
  const $ = cheerio.load(await r1.text());

  const form = new URLSearchParams();
  $('input[type=hidden]').each((_, el) => {
    const n = $(el).attr('name');
    if (n) form.append(n, $(el).attr('value') || '');
  });
  form.set('txtUsuario', '');
  form.set('txtSenha', '');
  form.set('txtCnpj', soDigitos(doc));
  form.set('txtNumero', soDigitos(nf));
  form.set('btnConsultar.x', '12');
  form.set('btnConsultar.y', '8');

  // 2) Envia a consulta
  let res = await http(BASE, {
    method: 'POST',
    body: form.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
      Referer: BASE,
      Origin: new URL(BASE).origin,
    },
  });
  guardarCookies(res, jar);

  // 3) Segue redirecionamentos (o resultado costuma abrir em outra página)
  for (let i = 0; i < 5 && res.status >= 300 && res.status < 400; i++) {
    const destino = new URL(res.headers.get('location'), BASE).toString();
    res = await http(destino, { headers: { Cookie: cookieHeader(jar), Referer: BASE } });
    guardarCookies(res, jar);
  }
  if (!res.ok) throw new Error(`LDB respondeu HTTP ${res.status}`);

  // A LDB responde em ISO-8859-1/Windows-1252: decodifica certo para não quebrar acentos
  const html = await lerTexto(res);
  return interpretar(html);
}

async function lerTexto(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const utf8 = buf.toString('utf8');
  if (/charset=utf-?8/.test(ct) && !utf8.includes('\uFFFD')) return utf8;
  if (/charset=/.test(ct) && !/utf-?8/.test(ct)) return new TextDecoder('windows-1252').decode(buf);
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

// Nome amigável de cada etapa da LDB
const ETAPAS = [
  [/emiss/i, 'Documento de transporte emitido'],
  [/coleta/i, 'Coleta realizada'],
  [/embarque/i, 'Mercadoria embarcada para o destino'],
  [/chegada/i, 'Chegada na unidade de destino'],
  [/entrega/i, 'Entrega realizada'],
];
// 30/12/1899 (ou anos absurdos) = etapa ainda não aconteceu
const dataValida = (d) => {
  const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m && Number(m[3]) >= 2000 ? m : null;
};

function organizar(bruto) {
  const textos = bruto.textos || [];
  const valor = (re) => {
    const t = textos.find((x) => re.test(x));
    return t ? t.replace(/^[^:]*:\s*/, '').trim() : '';
  };
  const dados = { textos: [], tabelas: [] };

  const situacao = valor(/^Situa[çc][ãa]o Atual/i);
  if (situacao) dados.resumo = situacao.charAt(0).toUpperCase() + situacao.slice(1).toLowerCase();

  const conhecimento = valor(/^Conhecimento/i);
  if (conhecimento) dados.textos.push(`Conhecimento (CT-e): ${conhecimento.split(/[;\s]/).filter(Boolean).pop()}`);
  for (const rot of ['Remetente', 'Destinatário']) {
    const v = valor(new RegExp('^' + rot + '\\s*:', 'i'));
    if (v) dados.textos.push(`${rot}: ${v}`);
  }

  // Linha do tempo: só etapas com data real, da mais recente para a mais antiga
  const eventos = [];
  for (const tb of bruto.tabelas || []) {
    for (const linha of tb.linhas.slice(1)) {
      const rotulo = linha.find((c) => !dataValida(c) && !/\d{2}\/\d{2}\/\d{4}/.test(c)) || '';
      const dataTxt = linha.find((c) => /\d{2}\/\d{2}\/\d{4}/.test(c)) || '';
      const m = dataValida(dataTxt);
      if (!m) continue;
      const etapa = ETAPAS.find(([re]) => re.test(rotulo));
      const recebido = (rotulo.match(/Recebido por:\s*(.+)$/i) || [])[1];
      eventos.push({
        ordem: Number(m[3] + m[2] + m[1]),
        desc: (etapa ? etapa[1] : rotulo) + (recebido ? ` (recebido por ${recebido})` : ''),
        data: dataTxt.trim(),
      });
    }
  }
  eventos.sort((a, b) => b.ordem - a.ordem);
  if (eventos.length) dados.tabelas.push({ titulo: 'Histórico da entrega', linhas: [['Evento', 'Data'], ...eventos.map((e) => [e.desc, e.data])] });
  if (!dados.resumo && eventos[0]) dados.resumo = eventos[0].desc;
  return dados;
}

function interpretar(html) {
  if (/n[ãa]o\s+encontrad/i.test(html)) return { status: 'nao_encontrado' };
  const $ = cheerio.load(html);
  // Se voltou a tela de login/consulta sem mensagem, também tratamos como não encontrado
  if ($('#txtCnpj').length && $('#btnConsultar').length) return { status: 'nao_encontrado' };
  return { status: 'encontrado', dados: organizar(htmlParaDados(html, { ignorar: ['img', 'input', 'select', 'button'] })) };
}

module.exports = { id: 'ldb', nome: 'LDB Transporte de Cargas', link: LINK, rastrear, interpretar };
