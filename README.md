# Rastreio Loja Veneza

Página única em que o cliente informa **CPF/CNPJ + nº da nota fiscal**. O sistema consulta ao mesmo tempo **LDB**, **Movvi** e **Minuano** e mostra onde a carga foi encontrada.

## Como funciona

| Transportadora | Consulta usada | Observação |
|---|---|---|
| LDB | Formulário "Consulta pública" em `http://179.190.43.254:9091/` (ASP.NET) | Envia CNPJ + NFe |
| Movvi | API do site: `apimovvi.meridionalcargas.com.br/api/rastrear-carga/{doc}/{nf}` | Retorna JSON |
| Minuano | `transminuano.com.br/servicos/rastrear/{nf}/{doc}` | Retorna HTML |

O servidor converte tudo em texto e tabelas antes de mostrar. Nenhum HTML das transportadoras é exibido diretamente, o que evita riscos de segurança. Também há cache de 5 minutos e limite de 20 consultas por minuto por IP.

## Rodar no computador

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes dos interpretadores
```

Exige Node.js 18 ou mais recente.

## Publicar (ex.: Render.com, gratuito)

1. Suba esta pasta para um repositório no GitHub.
2. No Render: **New → Web Service**, escolha o repositório.
3. Build command: `npm install` · Start command: `npm start`.
4. Para usar um endereço próprio, aponte `rastreio.lojaveneza.com.br` para o Render.

Railway, Fly.io ou uma VPS também funcionam, porque é um app Node comum.

## Link pronto para o cliente

`https://SEU-ENDERECO/?doc=12345678900&nf=123456` já abre a página com a consulta feita. Pode ser enviado por WhatsApp ou e-mail.

## Se uma transportadora mudar o site

Cada uma tem seu arquivo em `transportadoras/`. Se uma delas parar de responder, o cartão aparece como "Indisponível" e as outras continuam funcionando.
