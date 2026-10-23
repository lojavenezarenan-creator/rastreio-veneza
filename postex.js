// Postex Express — rastreamento público (postexexpress.com.br/rastreamento)
// A página usa um iframe (gestao.postexexpress.com.br/embed/rastreamento/?token=...) que chama:
//   GET /api/public/webservice/rastreamento/?codigo=&cnpjcpf={doc}&nf={nf}
//   Header: Authorization: {token público da página}
// Resposta: [] = não encontrado; senão lista de { DataHora, Descricao, ... }
const { http, soDigitos, limpa } = require('./util');

const SITE = 'https://www.postexexpress.com.br/rastreamento';
const API = 'https://gestao.postexexpress.com.br/api/public/webservice/rastreamento/';

let tokenCache = { valor: process.env.POSTEX_TOKEN || '', em: 0 };

/** Lê o token público que o próprio site da Postex usa no iframe de rastreio (cache de 6h). */
async function token() {
  if (tokenCache.valor && Date.now() - tokenCache.em < 6 * 3600_000) return tokenCache.valor;
  try {
    const r = await http(SITE);
    const html = await r.text();
    const m = html.match(/embed\/rastreamento\/?\?token=([A-Za-z0-9]+)/);
    if (m) tokenCache = { valor: m[1], em: Date.now() };
  } catch (e) {
    console.error('[postex token]', e.message);
  }
  if (!tokenCache.valor) throw new Error('Postex: token não encontrado');
  return tokenCache.valor;
}

// "21/10/2026 13:24" ou "2026-10-21T13:24" -> número para ordenar
function ordem(d) {
  const s = String(d || '');
  let m = s.match(/(\d{2})\/(\d{2})\/(\d{2,4})\D*(\d{2})?:?(\d{2})?/);
  if (m) return Number((m[3].length === 2 ? '20' + m[3] : m[3]) + m[2] + m[1] + (m[4] || '00') + (m[5] || '00'));
  m = s.match(/(\d{4})-(\d{2})-(\d{2})\D*(\d{2})?:?(\d{2})?/);
  if (m) return Number(m[1] + m[2] + m[3] + (m[4] || '00') + (m[5] || '00'));
  return 0;
}

async function rastrear(doc, nf) {
  const tk = await token();
  const url = `${API}?codigo=&cnpjcpf=${encodeURIComponent(soDigitos(doc))}&nf=${encodeURIComponent(soDigitos(nf))}`;
  let res = await http(url, { headers: { Authorization: tk, 'Content-Type': 'application/json', Referer: 'https://gestao.postexexpress.com.br/' } });
  if (res.status === 401 || res.status === 403) {
    tokenCache = { valor: '', em: 0 }; // token pode ter mudado: busca de novo
    const tk2 = await token();
    res = await http(url, { headers: { Authorization: tk2, 'Content-Type': 'application/json', Referer: 'https://gestao.postexexpress.com.br/' } });
  }
  if (!res.ok) throw new Error(`Postex respondeu HTTP ${res.status}`);
  const lista = JSON.parse(await res.text());
  return interpretar(lista);
}

function interpretar(lista) {
  if (!Array.isArray(lista) || !lista.length) return { status: 'nao_encontrado' };
  const eventos = lista
    .map((e, i) => ({
      desc: limpa(e.Descricao ?? e.descricao ?? ''),
      data: limpa(e.DataHora ?? e.dataHora ?? e.data ?? ''),
      i,
    }))
    .filter((e) => e.desc);
  if (!eventos.length) return { status: 'nao_encontrado' };
  // mais recente primeiro (se não der para ler a data, mantém a ordem da Postex invertida)
  const temData = eventos.every((e) => ordem(e.data) > 0);
  eventos.sort((a, b) => (temData ? ordem(b.data) - ordem(a.data) : b.i - a.i));
  return {
    status: 'encontrado',
    dados: {
      resumo: eventos[0].desc,
      textos: [],
      tabelas: [{ titulo: 'Histórico da entrega', linhas: [['Evento', 'Data e hora'], ...eventos.map((e) => [e.desc, e.data])] }],
    },
  };
}

module.exports = { id: 'postex', nome: 'Postex Express', link: SITE, rastrear, interpretar };
