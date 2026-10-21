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

  const html = await res.text();
  return interpretar(html);
}

function interpretar(html) {
  if (/n[ãa]o\s+encontrad/i.test(html)) return { status: 'nao_encontrado' };
  const $ = cheerio.load(html);
  // Se voltou a tela de login/consulta sem mensagem, também tratamos como não encontrado
  if ($('#txtCnpj').length && $('#btnConsultar').length) return { status: 'nao_encontrado' };
  return { status: 'encontrado', dados: htmlParaDados(html, { ignorar: ['img', 'input', 'select', 'button'] }) };
}

module.exports = { id: 'ldb', nome: 'LDB Transporte de Cargas', link: LINK, rastrear, interpretar };
