# Normativos ANTT · Rodovias

Painel web para **encontrar normas da ANTT por assunto**. Digite, por exemplo, *desapropriação* e ele traz, de uma vez, resoluções, deliberações, portarias, instruções normativas, decisões e documentos relacionados, com filtros, gráficos e exportação para planilha.

A base é montada automaticamente a partir de fontes públicas e é atualizada todo dia:

| Fonte | O que vem dela |
|---|---|
| **ANTTlegis** (anttlegis.antt.gov.br), listagens por ano | Resoluções, Deliberações, Instruções Normativas, Portarias (SUROD, SUINF, SUFIS, DG…), Portarias Conjuntas, Decisões SUROD, Notas Técnicas, Instruções de Serviço, Audiências e Consultas Públicas, Tomadas de Subsídios |
| **ANTTlegis**, busca no texto integral | Para cada tema (ex.: desapropriação), os atos em que o termo aparece **no texto completo**, não só na ementa |
| **gov.br/antt**, "Normativos de Rodovias" | Destaques curados (RCR, POPs, INs, manuais, PAF, ofícios circulares, portarias do Ministério dos Transportes, normas das OIAs) |
| **gov.br/antt**, páginas de cada concessão | Relatórios de Monitoração, do Verificador Independente (inclusive o acompanhamento mensal), de Acompanhamento das Principais Obras e financeiros — título, concessão, ano e link do PDF |

> Não é um canal oficial da ANTT. Confira sempre o texto vigente no ANTTlegis ou no DOU.

---

## O plano

1. **Coleta** (`scripts/coletar.mjs`, Node.js, sem dependências): lê as listagens do ANTTlegis ano a ano (ementa, situação vigente/revogado, datas), roda a busca no texto integral para cada tema configurado e rastreia as páginas curadas do gov.br. Descarta atos de pessoal (nomeações, exonerações…) e classifica cada ato por **setor** (rodovias, ferrovias, passageiros, cargas, geral) e por **tema**.
2. **Base estática** (`site/data/atos.json` + `meta.json`): um ato por linha, para o histórico do Git mostrar exatamente o que mudou em cada atualização.
3. **Painel** (`site/`): HTML/CSS/JS puros. A busca roda no navegador, ignora acentos, entende variações de palavras (desapropriar/desapropriação), números de atos (6.054, 5819/2018) e expressões entre aspas.
4. **Atualização automática** (`.github/workflows/atualizar.yml`): GitHub Actions coleta de segunda a sábado (incremental) e faz uma recoleta completa aos domingos, grava os dados no repositório e publica o painel no **GitHub Pages**.

## Como usar o painel

- **Busca**: digite o assunto, um número de ato ou uma expressão. Ao reconhecer um tema (ex.: *desapropriação*, *faixa de domínio*, *pedágio*), o painel inclui os atos do tema encontrados no texto integral.
- **Conteúdo**: escolha entre tudo, só normas e atos, ou só os relatórios das concessões. Combine com o filtro "Órgão ou concessão" para ver os relatórios de uma concessão específica (ex.: *monitoração faixa de domínio* + Via Brasil).
- **Temas**: os cartões no topo filtram por assunto. Os temas ficam em `config/temas.json` e são editáveis.
- **Filtros**: tipo de ato, órgão (SUROD, DG, SUINF…), período, "ocultar revogados", "só destaques do gov.br". Por padrão ficam ocultos atos exclusivos de ferrovias, passageiros ou cargas (o painel avisa quantos e permite mostrar).
- **Gráficos**: clique em uma barra de ano ou de tipo para filtrar.
- **Planilha**: baixa todos os resultados da consulta em CSV (abre no Excel).
- **Texto integral**: pesquisa o termo dentro do conteúdo completo dos atos no ANTTlegis. Rodando localmente (`npm start`), a busca acontece ao vivo dentro do painel; no GitHub Pages, o botão abre a Busca Livre do ANTTlegis com o termo copiado.
- **Links**: a URL do navegador guarda a busca e os filtros — copie e mande para a equipe.

## Rodar no computador

Requer [Node.js](https://nodejs.org) 20 ou mais recente (não há `npm install`: o projeto não usa bibliotecas externas).

```bash
npm start
```

Abra http://localhost:8080. Para atualizar a base manualmente:

```bash
npm run coletar
```

| Comando | O que faz | Tempo aproximado |
|---|---|---|
| `npm run coletar` | Incremental: ano atual e anterior, temas e gov.br | 5 a 10 min |
| `npm run coletar:completo` | Recoleta todos os anos (capta revogações de atos antigos) | 15 a 25 min |
| `npm run coletar:rapido` | Incremental sem a busca por temas | 1 a 2 min |

Outras opções: `--sem-relatorios` pula os relatórios das concessões; `--sem-govbr` pula as páginas curadas do gov.br.

## Publicar no GitHub (recomendado)

1. Crie um repositório no GitHub (pode ser privado se sua conta/organização permitir Pages privado; caso contrário, público).
2. Nesta pasta, envie o projeto:
   ```bash
   git init -b main
   git add .
   git commit -m "Painel de normativos ANTT"
   git remote add origin https://github.com/SEU-USUARIO/normativos-antt.git
   git push -u origin main
   ```
3. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Não use "Deploy from a branch": nesse modo o GitHub publica este README no lugar do painel.
4. Em **Actions**, abra "Atualizar normativos" e clique em **Run workflow** para a primeira publicação. O endereço do painel aparece no resumo da execução (algo como `https://SEU-USUARIO.github.io/normativos-antt/`).

A partir daí o painel se atualiza sozinho todo dia às 07:30 (Brasília).

**Se a coleta falhar no GitHub** (os servidores do GitHub ficam fora do Brasil e sites do governo às vezes bloqueiam acessos estrangeiros), o painel continua no ar com a última base e mostra um aviso. Alternativas: rodar `npm run coletar` em um computador da rede e fazer `git push`, ou cadastrar um *self-hosted runner* do GitHub Actions numa máquina no Brasil (troque `runs-on: ubuntu-latest` por `runs-on: self-hosted`).

## Personalizar

- **Novos temas**: copie um bloco em `config/temas.json`. `busca` são expressões pesquisadas no texto integral do ANTTlegis; `palavras` são trechos procurados em título/ementa (sem acento, minúsculas, aceitam expressão regular); `sinonimos` são os termos que ativam o tema quando digitados na busca.
- **Novas listagens do ANTTlegis**: adicione em `config/fontes.json` usando `cod_modulo` e `cod_menu` do link da listagem no ANTTlegis.

## Estrutura

```
config/            fontes (listagens do ANTTlegis) e temas
scripts/
  coletar.mjs      coleta e gera site/data
  servir.mjs       servidor local + busca integral ao vivo
  lib/             http (sessão/cookies/ISO-8859-1), anttlegis, govbr, classificação
site/              painel publicado (index.html, assets/, data/)
.github/workflows/ atualização diária e publicação no GitHub Pages
```

## Limitações conhecidas

- Fora dos temas, a busca do painel olha título, ementa e descrição do gov.br — não o texto completo de cada ato. Dos relatórios das concessões, o painel conhece título, categoria, concessão e ano; o conteúdo dos PDFs não é lido. Para isso use o botão **Texto integral** ou crie um tema.
- A classificação por setor e tema é automática (por palavras e órgão emissor) e pode ter falsos positivos.
- Mudanças no layout do ANTTlegis ou do gov.br podem exigir ajuste nos coletores (`scripts/lib/`). As falhas ficam registradas em `site/data/meta.json` e o painel exibe um aviso.
