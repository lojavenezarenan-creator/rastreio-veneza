// Movvi — página "Rastreio de carga" (movvi.com.br/ferramentas/rastreio)
// O site chama a API: GET https://apimovvi.meridionalcargas.com.br/api/rastrear-carga/{doc}/{nf}
//   O {doc} vai sem "." e "/", mas mantém o "-" (ex.: 112223330001-81). 404 = não encontrado.
const { http, soDigitos, limpa } = require('./util');

const API = 'https://apimovvi.meridionalcargas.com.br/api/rastrear-carga';
const LINK = 'https://www.movvi.com.br/ferramentas/rastreio';

function formatosDoc(doc) {
  const d = soDigitos(doc);
  const comHifen = d.length > 2 ? `${d.slice(0, -2)}-${d.slice(-2)}` : d;
  return [...new Set([comHifen, d])];
}

async function rastrear(doc, nf) {
  let ultimoStatus;
  for (const d of formatosDoc(doc)) {
    const res = await http(`${API}/${encodeURIComponent(d)}/${encodeURIComponent(soDigitos(nf))}`, {
      headers: { Accept: 'application/json', Origin: 'https://www.movvi.com.br', Referer: LINK },
    });
    ultimoStatus = res.status;
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Movvi respondeu HTTP ${res.status}`);

    const texto = await res.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error('Movvi retornou um formato inesperado');
    }
    const vazio = json == null || (Array.isArray(json) && !json.length) || (typeof json === 'object' && !Object.keys(json).length);
    if (vazio || json.success === false || json.erro || json.error) continue;
    return { status: 'encontrado', dados: interpretar(json) };
  }
  if (ultimoStatus === 404 || ultimoStatus === 200) return { status: 'nao_encontrado' };
  throw new Error(`Movvi respondeu HTTP ${ultimoStatus}`);
}

/**
 * O formato exato do JSON de sucesso não é documentado. Convertemos qualquer JSON em
 * { textos, tabelas }: campos simples viram "Rótulo: valor" e listas de objetos viram tabelas
 * (normalmente o histórico de ocorrências).
 */
function interpretar(json) {
  const textos = [];
  const tabelas = [];
  const rotulo = (k) => limpa(String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')).replace(/^./, (c) => c.toUpperCase());
  const simples = (v) => v == null || ['string', 'number', 'boolean'].includes(typeof v);

  (function andar(obj, prefixo) {
    if (Array.isArray(obj)) {
      if (obj.length && obj.every((o) => o && typeof o === 'object' && !Array.isArray(o))) {
        const cols = [...new Set(obj.flatMap((o) => Object.keys(o).filter((k) => simples(o[k]))))];
        if (cols.length) {
          tabelas.push({ titulo: prefixo, linhas: [cols.map(rotulo), ...obj.map((o) => cols.map((c) => limpa(o[c] ?? '')))] });
        }
        obj.forEach((o) => Object.entries(o).forEach(([k, v]) => !simples(v) && andar(v, rotulo(k))));
      } else {
        obj.forEach((v) => (simples(v) ? v !== '' && v != null && textos.push(limpa(v)) : andar(v, prefixo)));
      }
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (simples(v)) {
          if (v !== '' && v != null) textos.push(`${rotulo(k)}: ${limpa(v)}`);
        } else andar(v, rotulo(k));
      }
    } else if (simples(obj) && obj !== '') textos.push(limpa(obj));
  })(json, '');

  return { textos, tabelas };
}

module.exports = { id: 'movvi', nome: 'Movvi', link: LINK, rastrear, interpretar, formatosDoc };
