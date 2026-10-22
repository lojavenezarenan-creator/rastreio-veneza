const express = require('express');
const path = require('path');
const { soDigitos } = require('./util');

const TRANSPORTADORAS = [
  require('./ldb'),
  require('./movvi'),
  require('./minuano'),
  require('./ssw'),
];

const app = express();
app.set('trust proxy', 1);
// Modo privado (testes): se a variável SENHA_ACESSO existir no Render, o site pede
// usuário/senha (qualquer usuário + essa senha). Para liberar ao público, apague a variável.
const crypto = require('crypto');
const SENHA = process.env.SENHA_ACESSO;
if (SENHA) {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  app.use((req, res, next) => {
    if (req.path === '/saude') return next();
    const [tipo, valor] = (req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const senha = Buffer.from(valor, 'base64').toString().split(':').slice(1).join(':');
      if (crypto.timingSafeEqual(hash(senha), hash(SENHA))) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Rastreio Loja Veneza (em testes)", charset="UTF-8"');
    res.status(401).send('Acesso restrito: página em testes.');
  });
}
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Limite simples: 20 consultas por minuto por IP (protege as transportadoras e o servidor)
const acessos = new Map();
function limitar(req, res, next) {
  const agora = Date.now();
  const lista = (acessos.get(req.ip) || []).filter((t) => agora - t < 60_000);
  if (lista.length >= 20) return res.status(429).json({ erro: 'Muitas consultas. Aguarde um minuto e tente de novo.' });
  lista.push(agora);
  acessos.set(req.ip, lista);
  next();
}
setInterval(() => acessos.clear(), 10 * 60_000).unref();

// Cache de 5 minutos para não repetir a mesma consulta
const cache = new Map();
const CACHE_MS = 5 * 60_000;

// CNPJ(s) da loja usados como remetente: o cliente só precisa informar a nota fiscal.
// Para mais de um CNPJ (ex.: Loja do Modulado), defina LOJA_CNPJS no Render separado por vírgula.
const LOJA_CNPJS = (process.env.LOJA_CNPJS || '32386240000162').split(',').map(soDigitos).filter((d) => d.length === 14);

// Dados pessoais não aparecem quando a consulta é só pela nota
const semDadosPessoais = (r) => {
  if (!r.dados) return r;
  const textos = (r.dados.textos || []).filter((t) => !/^(remetente|destinat[áa]rio)\b/i.test(t));
  return { ...r, dados: { ...r.dados, textos } };
};

app.get('/api/rastreio', limitar, async (req, res) => {
  const nf = soDigitos(req.query.nf);
  if (!nf || nf.length > 12) return res.status(400).json({ erro: 'Informe o número da nota fiscal.' });

  const chave = `loja:${nf}`;
  const emCache = cache.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_MS) return res.json(emCache.dados);

  const resultados = await Promise.all(
    TRANSPORTADORAS.map(async (t) => {
      const base = { id: t.id, nome: t.nome, link: t.link };
      let ultimo = { status: 'nao_encontrado' };
      for (const doc of LOJA_CNPJS) {
        try {
          const r = await t.rastrear(doc, nf);
          if (r.status === 'encontrado') return semDadosPessoais({ ...base, ...r });
          ultimo = r;
        } catch (e) {
          console.error(`[${t.id}]`, e.message);
          ultimo = { status: 'erro', mensagem: 'Não foi possível consultar esta transportadora agora.' };
        }
      }
      return { ...base, ...ultimo };
    })
  );

  const dados = { nf, consultadoEm: new Date().toISOString(), resultados };
  cache.set(chave, { em: Date.now(), dados });
  res.json(dados);
});

app.get('/saude', (_, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Rastreio Veneza rodando em http://localhost:${PORT}`));
}
module.exports = app;
