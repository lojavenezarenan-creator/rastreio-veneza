// SSW — rastreio por CPF do destinatário (ssw.inf.br/tracking/ssw_destinatario)
// Usado por várias transportadoras. POST InputCPF={cpf} devolve uma tabela com TODAS as
// entregas daquele CPF (N.F. | Unidade | Situação). Filtramos pela NF informada para o
// cliente ver só o pedido dele.
const cheerio = require('cheerio');
const { http, soDigitos, limpa, guardarCookies, cookieHeader } = require('./util');

const URL_SSW = 'https://ssw.inf.br/tracking/ssw_destinatario';

async function rastrear(doc, nf) {
  // Abre a página antes (pega cookie de sessão, como um navegador faria)
  const jar = {};
  const r0 = await http(URL_SSW);
  guardarCookies(r0, jar);
  await r0.text();
  const res = await http(URL_SSW, {
    method: 'POST',
    body: new URLSearchParams({ InputCPF: soDigitos(doc) }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: URL_SSW, Origin: 'https://ssw.inf.br', Cookie: cookieHeader(jar) },
  });
  if (!res.ok) throw new Error(`SSW respondeu HTTP ${res.status}`);
  return interpretar(await res.text(), nf);
}

const mesmoNumero = (a, b) => soDigitos(a) !== '' && Number(soDigitos(a)) === Number(soDigitos(b));

function interpretar(html, nf) {
  const $ = cheerio.load(html);
  $('script, style').remove();
  $('br').replaceWith('\n');
  $('p').each((_, p) => $(p).append('\n'));

  const linhas = [];
  $('table tr').each((_, tr) => {
    const td = $(tr).children('th,td');
    if (td.length < 3) return;
    const colNF = $(td[0]).text().split('\n').map(limpa).filter(Boolean);
    // A 1ª linha da coluna N.F. traz o número da nota (às vezes junto de outro número)
    const tokens = (colNF[0] || '').split(' ');
    if (!tokens.some((t) => mesmoNumero(t, nf))) return;

    const unidade = $(td[1]).text().split('\n').map(limpa).filter(Boolean);
    let situacao = limpa($(td[2]).text())
      .replace(/Mais detalhes/gi, '')
      .replace(/CO2 emitido[^.]*\.\s*/gi, '')
      .trim();
    linhas.push({ unidade, situacao });
  });

  if (!linhas.length) return { status: 'nao_encontrado' };

  const atual = linhas[0];
  const fim = atual.situacao.indexOf('.') > 0 ? atual.situacao.indexOf('.') + 1 : atual.situacao.length;
  const dados = {
    resumo: atual.situacao.slice(0, fim),
    textos: [`Nota fiscal: ${soDigitos(nf)}`],
    tabelas: [
      {
        titulo: 'Situação',
        linhas: [['Local', 'Data', 'Situação'], ...linhas.map((l) => [l.unidade[0] || '', l.unidade[1] || '', l.situacao])],
      },
    ],
  };
  return { status: 'encontrado', dados };
}

module.exports = { id: 'ssw', nome: 'Transportadoras SSW', link: URL_SSW, rastrear, interpretar };
