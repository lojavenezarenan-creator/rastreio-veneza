// Total Express — API oficial "Status de Entrega" (apis-docs.totalexpress.com.br)
// POST https://apis.totalexpress.com.br/ics-tracking-encomenda-lv/v1/tracking
// Body: { "notasFiscais": ["12345"], "comprovanteEntrega": false }
// Auth: Basic (usuário e senha fornecidos pela Total Express)
// 404 = encomenda não encontrada. 200 = { data: [ { notaFiscal, tracking: [ {status, descricao, data} ] } ] }
//
// Credenciais: variáveis de ambiente TOTAL_USUARIO e TOTAL_SENHA (configure no Render).
// Sem elas, a Total Express simplesmente não é consultada.
const { http, soDigitos, limpa } = require('./util');

const URL_API = process.env.TOTAL_URL || 'https://apis.totalexpress.com.br/ics-tracking-encomenda-lv/v1/tracking';
const configurado = () => !!(process.env.TOTAL_USUARIO && process.env.TOTAL_SENHA);

// "2025-03-31T09:33:13" -> "31/03/2025 09:33"
function formatar(d) {
  const m = String(d || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : limpa(d);
}

async function consultar(nfTexto) {
  const auth = Buffer.from(`${process.env.TOTAL_USUARIO}:${process.env.TOTAL_SENHA}`).toString('base64');
  const res = await http(URL_API, {
    method: 'POST',
    body: JSON.stringify({ notasFiscais: [nfTexto], comprovanteEntrega: false }),
    headers: { 'Content-Type': 'application/json', Accept: '*/*', Authorization: `Basic ${auth}` },
  });
  if (res.status === 404) return null;
  const texto = await res.text();
  if (!res.ok) throw new Error(`Total Express respondeu HTTP ${res.status}: ${texto.slice(0, 120)}`);
  return JSON.parse(texto);
}

async function rastrear(_doc, nf) {
  if (!configurado()) return { status: 'nao_encontrado' };
  const n = soDigitos(nf);
  // tenta o número como digitado e, se não achar, com zeros à esquerda (ex.: 000011324)
  let json = await consultar(n);
  if (!json && n.length < 9) json = await consultar(n.padStart(9, '0'));
  return interpretar(json, n);
}

function interpretar(json, nf) {
  const lista = (json && Array.isArray(json.data) ? json.data : []).filter(
    (e) => Number(soDigitos(e.notaFiscal)) === Number(soDigitos(nf))
  );
  if (!lista.length) return { status: 'nao_encontrado' };
  const enc = lista[0];
  const eventos = (enc.tracking || [])
    .map((t) => ({ desc: limpa(t.descricao), data: String(t.data || '') }))
    .filter((t) => t.desc)
    .sort((a, b) => b.data.localeCompare(a.data)); // ISO: ordena pelo texto
  if (!eventos.length) return { status: 'nao_encontrado' };
  return {
    status: 'encontrado',
    dados: {
      resumo: eventos[0].desc,
      textos: [`Nota fiscal: ${Number(soDigitos(enc.notaFiscal)) || nf}`].concat(enc.awb ? [`Código de rastreio: ${enc.awb}`] : []),
      tabelas: [{ titulo: 'Histórico da entrega', linhas: [['Evento', 'Data e hora'], ...eventos.map((e) => [e.desc, formatar(e.data)])] }],
    },
  };
}

module.exports = { id: 'totalexpress', nome: 'Total Express', link: 'https://totalconecta.totalexpress.com.br/rastreamento', rastrear, interpretar, configurado };
