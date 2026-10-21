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

app.get('/api/rastreio', limitar, async (req, res) => {
  const doc = soDigitos(req.query.doc);
  const nf = soDigitos(req.query.nf);
  if (![11, 14].includes(doc.length)) return res.status(400).json({ erro: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).' });
  if (!nf || nf.length > 12) return res.status(400).json({ erro: 'Informe o número da nota fiscal.' });

  const chave = `${doc}:${nf}`;
  const emCache = cache.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_MS) return res.json(emCache.dados);

  const resultados = await Promise.all(
    TRANSPORTADORAS.map(async (t) => {
      const base = { id: t.id, nome: t.nome, link: t.link };
      try {
        return { ...base, ...(await t.rastrear(doc, nf)) };
      } catch (e) {
        console.error(`[${t.id}]`, e.message);
        return { ...base, status: 'erro', mensagem: 'Não foi possível consultar esta transportadora agora.' };
      }
    })
  );

  const dados = { doc, nf, consultadoEm: new Date().toISOString(), resultados };
  cache.set(chave, { em: Date.now(), dados });
  res.json(dados);
});

app.get('/saude', (_, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Rastreio Veneza rodando em http://localhost:${PORT}`));
}
module.exports = app;
