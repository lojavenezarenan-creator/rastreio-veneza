// SSW — rastreio por CPF do destinatário (ssw.inf.br/tracking/ssw_destinatario)
// Usado por várias transportadoras. POST InputCPF={cpf} devolve uma tabela com TODAS as
// entregas daquele CPF (N.F. | Unidade | Situação). Filtramos pela NF informada para o
// cliente ver só o pedido dele.
const cheerio = require('cheerio');
const { http, soDigitos, limpa, guardarCookies, cookieHeader } = require('./util');

const URL_SSW = 'https://ssw.inf.br/tracking/ssw_destinatario';
// Consulta pelo remetente (CNPJ da loja + NF): ssw.inf.br/2/rastreamento
const URL_REMETENTE = 'https://ssw.inf.br/2/resultSSW';

async function rastrear(doc, nf) {
  if (soDigitos(doc).length === 14) {
    const r = await http(URL_REMETENTE, {
      method: 'POST',
      body: new URLSearchParams({ cnpj: soDigitos(doc), NR: soDigitos(nf), chave: '' }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ssw.inf.br/2/rastreamento', Origin: 'https://ssw.inf.br' },
    });
    if (!r.ok) throw new Error(`SSW respondeu HTTP ${r.status}`);
    return comDetalhes(interpretar(await r.text(), nf));
  }
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
  return comDetalhes(interpretar(await res.text(), nf));
}

/** Busca o histórico completo ("Mais detalhes"). Se falhar, mantém a situação resumida. */
async function comDetalhes(r) {
  if (r.status !== 'encontrado' || !r.det) return limparDet(r);
  try {
    const res = await http(new URL(r.det, 'https://ssw.inf.br').toString(), { headers: { Referer: 'https://ssw.inf.br/2/rastreamento' } });
    if (!res.ok) return limparDet(r);
    const d = interpretarDetalhes(await res.text());
    if (d.eventos.length) {
      const ev = [...d.eventos].reverse(); // mais recente primeiro
      r.dados.resumo = ev[0].texto;
      r.dados.tabelas = [{ titulo: 'Histórico da entrega', linhas: [['Evento', 'Data e local'], ...ev.map((e) => [e.texto, e.meta])] }];
      if (d.transportadora) r.dados.transportadora = d.transportadora;
    }
  } catch (e) {
    console.error('[ssw detalhes]', e.message);
  }
  return limparDet(r);
}
const limparDet = (r) => { delete r.det; return r; };

function interpretarDetalhes(html) {
  const $ = cheerio.load(html);
  $('script, style').remove();
  $('br').replaceWith('\n');
  $('p').each((_, p) => $(p).append('\n'));
  const linhasDe = (el) => $(el).text().split('\n').map(limpa).filter(Boolean);
  const eventos = [];
  $('tr').each((_, tr) => {
    const td = $(tr).children('td');
    if (td.length < 3) return;
    const data = linhasDe(td[0]);
    if (!/^\d{2}\/\d{2}\/\d{2,4}$/.test(data[0] || '')) return;
    const unidade = linhasDe(td[1]);
    const titulo = limpa($(td[2]).find('.titulo').text()) || linhasDe(td[2])[0] || '';
    const desc = linhasDe(td[2]).filter((t) => t !== titulo).join(' ');
    const tituloBonito = titulo.charAt(0) + titulo.slice(1).toLowerCase();
    eventos.push({
      titulo: tituloBonito,
      texto: desc ? `${tituloBonito}. ${desc}` : tituloBonito,
      meta: [data.join(' '), unidade[0]].filter(Boolean).join(' · '),
    });
  });
  let transportadora = '';
  $('tr').each((_, tr) => {
    if (/transportando a sua mercadoria/i.test($(tr).text())) transportadora = limpa($(tr).children('td').last().text());
  });
  return { eventos, transportadora };
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

    // Últimas colunas: "Unidade / data" e "Situação" (mesmo layout nas duas consultas do SSW)
    const unidade = $(td[td.length - 2]).text().split('\n').map(limpa).filter(Boolean);
    let situacao = limpa($(td[td.length - 1]).text())
      .replace(/Mais detalhes/gi, '')
      .replace(/CO2 emitido[^.]*\.\s*/gi, '')
      .trim();
    if (!situacao || /informa[çc][ãa]o n[ãa]o dispon/i.test(situacao + unidade.join(' '))) return;
    // Link "Mais detalhes": opx('/2/ssw_SSWDetalhado?id=...&md=...')
    const oc = ($(tr).attr('onclick') || '') + ' ' + $(tr).find('[onclick]').map((_, e) => $(e).attr('onclick')).get().join(' ');
    const det = (oc.match(/opx\('([^']+)'\)/) || [])[1];
    linhas.push({ unidade, situacao, det });
  });

  if (!linhas.length) return { status: 'nao_encontrado' };

  const atual = linhas[0];
  const det = atual.det;
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
  return { status: 'encontrado', dados, det };
}

module.exports = { id: 'ssw', nome: 'Transportadoras SSW', link: URL_SSW, rastrear, interpretar };
