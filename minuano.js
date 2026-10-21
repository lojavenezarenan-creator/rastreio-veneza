// Transportadora Minuano — consulta pública "Rastrear NF"
// O site chama: GET /servicos/rastrear/{NF}/{CPF/CNPJ}
//   200 -> fragmento HTML com: status ("ENTREGA REALIZADA: 19/10/2026"), Remetente,
//          Destinatário, "Nota #… CT-e: …", tabela "Eventos" (# | Descrição) e
//          tabela "Ocorrências" (# | Data | Descrição | Complemento)
//   502 -> JSON "Nada encontrado com os dados informados."
const { http, htmlParaDados, soDigitos } = require('./util');

const BASE = 'https://www.transminuano.com.br';
const LINK = `${BASE}/public-from-consulta-nf`;

async function rastrear(doc, nf) {
  const url = `${BASE}/servicos/rastrear/${encodeURIComponent(soDigitos(nf))}/${encodeURIComponent(soDigitos(doc))}`;
  const res = await http(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: LINK, Accept: 'text/html, */*; q=0.01' },
  });
  const corpo = await res.text();

  if (res.status !== 200) {
    if (/nada encontrado/i.test(corpo) || res.status === 404 || res.status === 502) {
      return { status: 'nao_encontrado' };
    }
    throw new Error(`Minuano respondeu HTTP ${res.status}`);
  }
  return { status: 'encontrado', dados: interpretar(corpo) };
}

function interpretar(html) {
  const dados = htmlParaDados(html, { ignorar: ['button', '.modal-footer', 'a', 'h5'] });
  dados.textos = dados.textos.filter((t) => !/^(comprovante|expresso minuano)$/i.test(t));

  // Resumo: linha de status ("ENTREGA REALIZADA: 19/10/2026") ou o evento mais recente
  const iStatus = dados.textos.findIndex((t) => /^[A-ZÀ-Ú][A-ZÀ-Ú ]+:\s*\d{2}\/\d{2}\/\d{4}/.test(t));
  if (iStatus >= 0) dados.resumo = dados.textos.splice(iStatus, 1)[0];
  else {
    const ev = dados.tabelas.find((t) => /evento/i.test(t.titulo)) || dados.tabelas[0];
    if (ev && ev.linhas[1]) dados.resumo = ev.linhas[1][ev.linhas[1].length - 1];
  }

  // Organiza "Remetente FULANO ..." em "Remetente: FULANO ..."
  dados.textos = dados.textos.map((t) => t.replace(/^(Remetente|Destinatário)\s*(·\s*)?/i, '$1: '));
  // O site da Minuano às vezes gruda palavras: "PORTO ALEGREem 19/10" -> "PORTO ALEGRE em 19/10"
  const desgruda = (t) => t.replace(/([A-ZÀ-Ú]{2,})(em|às)(?=\s)/g, '$1 $2');
  dados.tabelas = dados.tabelas.map((tb) => ({ ...tb, linhas: tb.linhas.map((l) => l.map(desgruda)) }));
  dados.textos = dados.textos.map(desgruda);
  return dados;
}

module.exports = { id: 'minuano', nome: 'Transportadora Minuano', link: LINK, rastrear, interpretar };
