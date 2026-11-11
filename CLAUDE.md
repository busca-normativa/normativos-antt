# Sistema de Busca Normativa · Rodovias — guia de continuidade

Leia isto antes de mexer em qualquer coisa. Resume o que o sistema é, como funciona, as regras combinadas com o usuário e o que está pendente. Detalhes de uso estão no `README.md`.

## O que é
Painel web de busca de normas e documentos de rodovias (ANTT, DNIT, DUPs, uso da faixa de domínio, documentos das concessões) + mapa das poligonais das DUPs. Site estático no GitHub Pages, atualizado todo dia por um robô (GitHub Actions). O usuário trabalha com faixa de domínio na concessionária **Via Brasil BR-163**, que por isso aparece sempre primeiro nos filtros e nos avisos.

- Site: https://busca-normativa.github.io/normativos-antt/ · Mapa: `.../mapa.html`
- Repositório: `busca-normativa/normativos-antt` (organização, público). Quem faz os pushes: a conta GitHub pessoal `carloseduardosnp01-art`.
- Existe um repositório só de redirecionamento, `carloseduardosnp01-art/normativos-antt` (o endereço antigo do site). **Não apagar.**
- O funcionamento diário não depende de nenhuma conta do Claude: roda sozinho no GitHub.

## REGRA CRÍTICA: qual pasta usar
A pasta correta é **a da rede** (unidade `F:`, `FAIXA_DE_DOMINIO › 05 - MANUAIS & PROCESSOS - analisar › Sistema consulta ANTT`), onde este arquivo está. Existe uma cópia antiga em `Downloads` do computador: **nunca alterar nada nela** nem em outras cópias. Se a sessão abrir numa pasta que não seja a da rede, pare e avise o usuário.

## Como o sistema atualiza
- `.github/workflows/atualizar.yml`: seg–sáb 07:30 (BRT) coleta incremental; domingo coleta completa (revogações). Na prática o GitHub atrasa e roda entre 11h e 17h; leva ~40 min (completa ~65).
- Etapas: coleta (`scripts/coletar.mjs`) → aviso de novidades da Via Brasil (issue no GitHub, menciona o usuário) → commit dos dados `site/data/*` pelo bot → carimba `?v=<sha>` nos links de scripts/CSS (os arquivos usam `?v=dev` no código) → publica no Pages.
- A publicação tem 2ª tentativa automática (em 04/11/2026 o `deploy-pages` travou por incidente do GitHub e o site ficou um dia com dados velhos). Essa 2ª tentativa **ainda não foi exercitada de verdade**.
- Avisos por e-mail **não estão ativos** (exigiriam Secrets SMTP; o usuário preferiu o aviso via GitHub). Nunca pedir senha/SMTP no chat.
- `config/alertas.json`: `concessoes` = só Via Brasil; `emails` vazio; `mencionar` = usuário do GitHub.

## Estrutura
- `scripts/coletar.mjs` — orquestra tudo. Opções úteis: `--completo`, `--sem-temas`, `--sem-govbr`, `--sem-relatorios`, `--sem-dnit`, `--sem-concessoes`, `--sem-fichas`, `--sem-mapa`, `--refazer-mapa[=todos]`, `--refazer-dups`.
- `scripts/lib/`: `anttlegis.mjs` (raspagem do ANTTlegis, ISO-8859-1, sessão PHPSESSID), `govbr.mjs` + `relatorios.mjs` (gov.br), `fichas.mjs` (extrai DUP/uso da faixa do texto integral), `poligonais.mjs` (quadros de coordenadas → lat/lon, validação), `classificar.mjs` (tipos/setores/temas), `http.mjs`, `texto.mjs`.
- `scripts/importar-coordenadas.mjs` — inclui no mapa DUPs cujo quadro só existe no processo SEI (ver abaixo).
- `config/`: `concessoes.json` (padrões por concessão; a primeira que casar vence; `destaque: true` = Via Brasil), `temas.json`, `fontes.json`, `municipios.json` (sedes IBGE, para validar o mapa), `coordenadas.json` (quadros importados à mão), `alertas.json`.
- `site/`: `index.html` + `assets/app.js` (painel), `mapa.html` + `assets/mapa.js` (Leaflet), `assets/combobox.js` (filtros digitáveis), `data/` (gerado pelo robô: `atos.json`, `mapa.json`, `poligonais.json` cache, `meta.json`).

## Regras de negócio já decididas (não desfazer sem combinar)
- **Concessão de um ato**: concessionária citada no texto/ementa > lista curada do ANTTlegis **só se a concessão já tem atos naquela rodovia** > nome/rodovia da ficha > concessão "dona" da rodovia. A lista do ANTTlegis tem erros.
- **Mapa das DUPs**: coordenadas UTM/SIRGAS 2000. O fuso do anexo costuma vir errado: valida pela UF e pela sede do município citado, corrige o fuso e, se continuar longe, mostra "⚠ Atenção" no popup (não esconde). Áreas isoladas/pontos soltos são descartados (`limparArea`). Zoom do satélite limitado ao que a Esri tem (consulta `tilemap`).
- **DUPs sem quadro publicado** ("poligonais descritas no Processo", ~84): o usuário baixa o PDF no SEI e você roda `node scripts/importar-coordenadas.mjs "<pdf>" DCS-NNN-AAAA`. Só os vértices vão ao repositório; **o PDF assinado não** (tem dados do responsável técnico).
- **Remoção de itens**: um item que some de uma fonte só sai da base após 5 coletas seguidas sem aparecer (as listagens às vezes vêm incompletas sem dar erro).
- **Falha de página do gov.br** vira uma nota em "Sobre"; o alerta amarelo fica para falha do ANTTlegis ou base parada > 3 dias.
- **Filtro "Publicado em"** (de/até, ?pub= ou ?pubde=&pubate=): usa a data do DOU nos atos e a de publicação no site nos relatórios/DNIT. Por padrão o painel mostra só rodovias e normas gerais ("Mostrar também" revela ferrovia etc.).
- Concessão filtrável digitando; "Limpar tudo" e etiquetas removíveis devem continuar funcionando com qualquer filtro novo.

## Como trabalhar aqui
- **Git na rede** exige `git -c safe.directory='*' ...`. O bot publica dados todo dia: faça `pull --rebase` antes de `push`. Dados regenerados localmente (`site/data/*`) só entram no commit se forem parte da mudança; senão `git checkout -- site/data`.
- Commits terminam com a linha `Co-Authored-By` indicada pelo ambiente do Claude Code.
- **Testar antes de publicar**: servir a pasta da rede com `node scripts/servir.mjs --porta=8091` (em segundo plano) e abrir `http://localhost:8091/`. Não usar o `preview_start name=painel`: ele serve a cópia errada (Downloads). Pare o servidor ao terminar.
- Regerar mapa/concessões sem baixar tudo: `node scripts/coletar.mjs --fontes=nenhuma --sem-temas --sem-govbr --sem-concessoes --sem-relatorios --sem-fichas --sem-dnit`.
- **Publicar**: commit → push → acompanhar `https://api.github.com/repos/busca-normativa/normativos-antt/actions/runs` até `completed success` → conferir o arquivo no ar (o `?v=` do HTML muda a cada deploy). Avisar o usuário para dar Ctrl+F5.
- Armadilhas: heredocs no Git Bash do Windows **perdem barras invertidas** → escreva JS/regex com a ferramenta de arquivos (Write/Edit) ou um script `.cjs`. Screenshots do navegador embutido às vezes dão timeout: use `javascript_tool`/`find`.
- Em dúvida entre ações irreversíveis (apagar repositório, mudar visibilidade, enviar e-mail), perguntar antes.

## Estilo com o usuário
Português, linguagem simples (não é programador): explicar o que mudou e por quê, sem jargão; mostrar o que foi testado; dizer com franqueza o que **não** foi testado. Ele costuma mandar prints e pedir ajustes pequenos; atender, testar, publicar e dar o link.

## Estado em 11/11/2026 e pendências
- Base: ~43.900 itens; 1.047 DUPs (635 no mapa; 292 sem quadro, mais antigas; 84 só no processo; 18 fora da UF; 3 divergentes); ~6.200 fichas de uso da faixa.
- DUPs conhecidamente problemáticas na origem (anexo com coordenadas erradas): EPR Iguaçu 972/2026 (perto de Curitiba, ato cita Ampére/PR), ViaCosteira 659/2023, Via Brasil 948/2026 e 58/2026. Via Brasil 1169 e 1163/2025 estão "só no processo" (aguardam PDF do SEI).
- Ofereci adiantar o agendamento para a madrugada (ex.: 03:00 BRT) para os dados saírem de manhã; o usuário não respondeu.
- Ideias já mencionadas e não feitas: e-mail direto (precisa de SMTP), mais filtros/relatórios conforme o usuário pedir.
