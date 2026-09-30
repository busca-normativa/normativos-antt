#!/usr/bin/env node
// Coleta os normativos da ANTT e gera os arquivos de dados do painel (site/data).
//
// Uso:
//   node scripts/coletar.mjs               atualização incremental (ano atual e anterior + temas + gov.br)
//   node scripts/coletar.mjs --completo    recoleta todos os anos (recomendado 1x por semana)
//   node scripts/coletar.mjs --sem-temas   pula a busca no texto integral por tema
//   node scripts/coletar.mjs --sem-govbr   pula as páginas curadas do gov.br
//   node scripts/coletar.mjs --sem-relatorios   pula os relatórios das páginas das concessões
//   node scripts/coletar.mjs --fontes=res,dlb   coleta só as listagens indicadas (ids de config/fontes.json; "nenhuma" pula todas)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarSessaoLegis, coletarListagem, buscarTextoIntegral, idAto, urlAto, coletarDecisoesPorConcessionaria, chaveDoTitulo } from './lib/anttlegis.mjs';
import { coletarGovBr } from './lib/govbr.mjs';
import { coletarRelatorios, tipoDoRelatorio } from './lib/relatorios.mjs';
import { setoresDoAto, ehAtoDePessoal, ehAdministrativo, nomeDoTipo, compilarTemas, temasPorPalavras } from './lib/classificar.mjs';
import { normalizar } from './lib/texto.mjs';
import { ehDup, ehUsoDaFaixa, fichaDaDup, fichaDaFaixa } from './lib/fichas.mjs';
import { carregarPdfjs, linhasDoPdf, linhasDoHtml, interpretarQuadro, poligonosValidados } from './lib/poligonais.mjs';
import { Sessao } from './lib/http.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_DADOS = path.join(RAIZ, 'site', 'data');
const ARQ_ATOS = path.join(DIR_DADOS, 'atos.json');
const ARQ_META = path.join(DIR_DADOS, 'meta.json');

const args = process.argv.slice(2);
const opt = (nome) => args.includes(`--${nome}`);
const valor = (nome) => (args.find((a) => a.startsWith(`--${nome}=`)) || '').split('=')[1];

const COMPLETO = opt('completo');
const SEM_TEMAS = opt('sem-temas');
const SEM_GOVBR = opt('sem-govbr');
const SEM_RELATORIOS = opt('sem-relatorios');
const FILTRO_FONTES = valor('fontes') ? valor('fontes').split(',') : null;
const ANO_ATUAL = new Date().getFullYear();
const ANO_MINIMO = COMPLETO ? 0 : ANO_ATUAL - 1;

const lerJSON = (arq) => JSON.parse(fs.readFileSync(arq, 'utf8'));
const cfgFontes = lerJSON(path.join(RAIZ, 'config', 'fontes.json')).anttlegis;
const cfgTemas = lerJSON(path.join(RAIZ, 'config', 'temas.json')).temas;
const cfgConcessoes = lerJSON(path.join(RAIZ, 'config', 'concessoes.json')).concessoes.map((c) => ({ ...c, re: new RegExp(c.padroes.join('|')) }));
const SEM_FICHAS = opt('sem-fichas') || opt('sem-dups');
const SEM_CONCESSOES = opt('sem-concessoes');
const SEM_MAPA = opt('sem-mapa');
const SEM_DNIT = opt('sem-dnit');
const MAX_FICHAS = +valor('max-fichas') || 2500;
const temasCompilados = compilarTemas(cfgTemas);

const inicio = Date.now();
const log = (...m) => console.log(`[${((Date.now() - inicio) / 1000).toFixed(0).padStart(4)}s]`, ...m);

// ---------- formato compacto em disco ----------
const CHAVES = { i: 'id', t: 'tipo', tn: 'tipoNome', n: 'numero', a: 'ano', o: 'orgao', q: 'seq', ti: 'titulo', e: 'ementa', si: 'situacao', d: 'data', p: 'publicado', u: 'url', f: 'fontes', tm: 'temas', tb: 'temasBusca', se: 'setores', g: 'destaque', nt: 'nota', dp: 'dup', fa: 'faixa', cc: 'concessao', cl: 'concessaoLegis', mp: 'noMapa' };
const CHAVES_INV = Object.fromEntries(Object.entries(CHAVES).map(([k, v]) => [v, k]));

function paraDisco(a) {
  const o = {};
  for (const [longo, curto] of Object.entries(CHAVES_INV)) {
    const v = a[longo];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    o[curto] = v;
  }
  return o;
}
function doDisco(o) {
  const a = {};
  for (const [curto, v] of Object.entries(o)) a[CHAVES[curto] || curto] = v;
  return a;
}

function carregarExistentes() {
  if (!fs.existsSync(ARQ_ATOS)) return new Map();
  try {
    return new Map(lerJSON(ARQ_ATOS).map((o) => { const a = doDisco(o); return [a.id, a]; }));
  } catch (e) {
    log('! não foi possível ler atos.json existente:', e.message);
    return new Map();
  }
}

// ---------- mesclagem ----------
const atos = COMPLETO ? new Map() : carregarExistentes();
const anteriores = COMPLETO ? carregarExistentes() : atos;
const erros = [];
const fontesOk = new Set();

function unir(lista = [], extra = []) {
  return [...new Set([...(lista || []), ...extra])];
}

// Fontes que esta execução vai recoletar (as demais são preservadas como estão)
const fontesDaExecucao = new Set([
  ...cfgFontes.filter((f) => !FILTRO_FONTES || FILTRO_FONTES.includes(f.id)).map((f) => f.id),
  ...(SEM_TEMAS ? [] : ['busca']),
  ...(SEM_GOVBR ? [] : ['govbr']),
  ...(SEM_RELATORIOS ? [] : ['relatorios']),
  ...(SEM_DNIT ? [] : ['dnit']),
]);

function copiaDoAnterior(id) {
  const prev = anteriores.get(id);
  if (!prev) return null;
  return {
    ...prev,
    fontes: (prev.fontes || []).filter((f) => !fontesDaExecucao.has(f)),
    temasBusca: SEM_TEMAS ? prev.temasBusca : [],
  };
}

function registrar(novo, fonteId) {
  const ex =atos.get(novo.id) || (COMPLETO ? copiaDoAnterior(novo.id) : null);
  if (!ex) {
    atos.set(novo.id, { ...novo, fontes: [fonteId] });
    return atos.get(novo.id);
  }
  for (const campo of ['tipo', 'numero', 'ano', 'orgao', 'seq', 'titulo', 'ementa', 'situacao', 'data', 'publicado', 'url']) {
    if (novo[campo] !== undefined && novo[campo] !== null && novo[campo] !== '') ex[campo] = novo[campo];
  }
  ex.fontes = unir(ex.fontes, [fonteId]);
  atos.set(novo.id, ex);
  return ex;
}

// ---------- 1. listagens do ANTTlegis ----------
async function etapaListagens() {
  const sessao = criarSessaoLegis({ pausaMs: 350 });
  for (const fonte of cfgFontes) {
    if (FILTRO_FONTES && !FILTRO_FONTES.includes(fonte.id)) continue;
    log(`ANTTlegis: ${fonte.nome}${COMPLETO ? ' (todos os anos)' : ` (desde ${ANO_MINIMO})`}`);
    try {
      const r = await coletarListagem(sessao, fonte, { anoMinimo: ANO_MINIMO, log: () => {} });
      let n = 0;
      for (const a of r.atos) {
        if (fonte.orgaos && !fonte.orgaos.includes(a.orgao.split('/')[0])) continue;
        if (fonte.semPessoal && ehAtoDePessoal(a)) continue;
        registrar(a, fonte.id);
        n++;
      }
      erros.push(...r.erros);
      if (!r.erros.length) fontesOk.add(fonte.id);
      log(`   ${n} atos (${r.anos.length} ano(s))${r.erros.length ? `, ${r.erros.length} erro(s)` : ''}`);
    } catch (e) {
      erros.push(`${fonte.nome}: ${e.message}`);
      log(`   ! erro: ${e.message}`);
    }
  }
}

// ---------- 2. busca no texto integral por tema ----------
async function etapaTemas() {
  const sessao = criarSessaoLegis({ pausaMs: 350 });
  const acertos = new Map(); // id -> Set(tema)
  let falhou = false;
  for (const tema of cfgTemas) {
    for (const termo of tema.busca || []) {
      try {
        // A busca exata do ANTTlegis não encontra expressões com "e"/"ou" (ex.: "parada e descanso")
        const exato = !/\s(e|ou)\s/i.test(termo);
        const r = await buscarTextoIntegral(sessao, termo, { exato, maxPaginas: 20 });
        let n = 0;
        for (const a of r.atos) {
          if (ehAtoDePessoal(a)) continue;
          registrar(a, 'busca');
          if (!acertos.has(a.id)) acertos.set(a.id, new Set());
          acertos.get(a.id).add(tema.id);
          n++;
        }
        log(`Tema ${tema.nome} · "${termo}": ${r.total} no ANTTlegis, ${n} aproveitados`);
      } catch (e) {
        falhou = true;
        erros.push(`Busca "${termo}": ${e.message}`);
        log(`   ! busca "${termo}": ${e.message}`);
      }
    }
  }
  // Refaz as marcações de tema vindas da busca (se a busca rodou sem falhas). Atos que só estavam
  // na base por causa de um termo que saiu de config/temas.json deixam de aparecer.
  if (!falhou) {
    fontesOk.add('busca');
    for (const [id, a] of atos) {
      a.temasBusca = [];
      if (!acertos.has(id) && a.fontes?.length === 1 && a.fontes[0] === 'busca') atos.delete(id);
    }
  }
  for (const [id, set] of acertos) {
    const a = atos.get(id);
    if (a) a.temasBusca = unir(a.temasBusca, [...set]);
  }
}

// ---------- 3. páginas curadas do gov.br ----------
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

function emissorGovBr(titulo) {
  const t = normalizar(titulo);
  if (/inmetro/.test(t)) return 'INMETRO';
  if (/abnt|nbr/.test(t)) return 'ABNT';
  if (/dnit/.test(t)) return 'DNIT';
  if (/confea/.test(t)) return 'CONFEA';
  if (/interministerial/.test(t)) return 'Interministerial';
  return null;
}

// Reconhece "Resolução ANTT nº 5.819/2018" ou "Portaria SUROD nº 12, de 26 de março de 2025" num título do gov.br
// que aponta para o DOU/PDF, para ligar o item ao ato do ANTTlegis em vez de duplicá-lo.
const TIPO_POR_PALAVRA = [[/^resolu/, 'RES'], [/^delibera/, 'DLB'], [/^instrucao normativa/, 'INM'], [/^portaria/, 'POR']];
function atoCitadoNoTitulo(titulo, indice) {
  const t = normalizar(titulo).replace(/(\d)\.(?=\d{3}\b)/g, '$1');
  const tipo = (TIPO_POR_PALAVRA.find(([re]) => re.test(t)) || [])[1];
  const m = t.match(/\bn[oº°.]?\s*(\d+)\s*(?:\/\s*(\d{4})|,?\s*de\s+\d{1,2}[oº°]?\s+de\s+[a-z]+\s+(?:de\s+)?(\d{4}))/);
  if (!tipo || !m || /inmetro|confea|ministerio|interministerial|mt\b/.test(t)) return null;
  const orgao = (t.match(/\b(surod|suinf|sufis|suexe|dg)\b/) || [])[1];
  if (tipo === 'POR' && !orgao) return null; // portarias repetem número entre órgãos
  const candidatos = (indice.get(`${tipo}-${+m[1]}-${+(m[2] || m[3])}`) || []).filter(
    (a) => a.seq !== 'RET' && (orgao ? a.orgao.toLowerCase().startsWith(orgao + '/') : /^(DG|DC)\//.test(a.orgao))
  );
  return candidatos.length === 1 ? candidatos[0] : null;
}

async function etapaGovBr() {
  log('gov.br: páginas "Normativos de Rodovias"');
  const r = await coletarGovBr({ log: () => {} });
  erros.push(...r.erros);
  if (!r.erros.length) fontesOk.add('govbr');
  // limpa marcações antigas
  for (const a of atos.values()) {
    if (a.destaque) { a.destaque = null; a.nota = null; }
  }
  const indice = new Map();
  for (const a of atos.values()) {
    if (a.tipo === 'GOV') continue;
    const k = `${a.tipo}-${a.numero}-${a.ano}`;
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(a);
  }
  let ligados = 0;
  let novos = 0;
  const govVistos = new Set();
  for (const it of r.itens) {
    if (!it.legis) {
      const citado = atoCitadoNoTitulo(it.titulo, indice);
      if (citado) it.legis = { tipo: citado.tipo, numero: citado.numero, seq: citado.seq, ano: citado.ano, orgao: citado.orgao };
    }
    if (it.legis) {
      const id = idAto(it.legis);
      const base = { ...it.legis, id };
      if (!atos.has(id)) {
        base.titulo = it.titulo;
        base.ementa = it.descricao;
        base.data = it.data;
      }
      const a = registrar(base, 'govbr');
      a.destaque = a.destaque || it.categoria;
      if (it.descricao && normalizar(it.descricao) !== normalizar(a.ementa || '')) a.nota = it.descricao;
      ligados++;
    } else {
      const id = `GOV-${hash(it.url + '|' + it.titulo)}`;
      const emissor = emissorGovBr(it.titulo);
      const a = registrar({
        id,
        tipo: 'GOV',
        tipoNome: it.tipoNome,
        orgao: emissor || (/transportes|in\.gov\.br/.test(it.url) && /portaria/i.test(it.titulo) ? 'Ministério dos Transportes' : 'ANTT'),
        titulo: it.titulo,
        ementa: it.descricao,
        data: it.data,
        ano: it.data ? +it.data.slice(0, 4) : +((it.titulo.match(/\b(19|20)\d{2}\b/) || [])[0] || 0) || null,
        url: it.url,
      }, 'govbr');
      a.destaque = a.destaque || it.categoria;
      a.tipoNome = it.tipoNome;
      govVistos.add(id);
      novos++;
    }
  }
  // Documentos que saíram das páginas do gov.br deixam a base (só quando o rastreamento foi completo)
  if (!r.erros.length && r.itens.length) {
    for (const [id, a] of atos) if (a.tipo === 'GOV' && !govVistos.has(id)) atos.delete(id);
  }
  log(`   ${r.itens.length} itens em ${r.paginas} páginas (${ligados} ligados ao ANTTlegis, ${novos} documentos próprios)`);
}

// ---------- 4. relatórios das concessões (gov.br) ----------
// Tipos de registro que apontam para documentos fora do ANTTlegis (link próprio, tipo definido na coleta)
const TIPOS_EXTERNOS = new Set(['GOV', 'REL', 'DNIT']);

// Siglas usadas no dia a dia, acrescentadas à ementa para a busca encontrar
const SIGLAS_RELATORIO = [
  [/relat[oó]rio mensal de atividades/i, 'RMA'],
  [/relat[oó]rio mensal de acompanhamento|acompanhamento mensal/i, 'RMA'],
  [/relat[oó]rio de monitora[çc][ãa]o/i, 'RM'],
  [/relat[oó]rio geral de verifica[çc][ãa]o/i, 'RGV'],
];

async function etapaRelatorios() {
  log(`gov.br: relatórios das concessões${COMPLETO ? ' (todos os anos)' : ` (desde ${ANO_MINIMO})`}`);
  // --relatorios-de=arquivo.json: usa uma coleta feita antes (ex.: em paralelo) em vez de rastrear de novo
  const arq = valor('relatorios-de');
  const r = arq ? lerJSON(arq) : await coletarRelatorios({ anoMinimo: ANO_MINIMO, log: () => {} });
  erros.push(...r.erros);
  if (!r.erros.length) fontesOk.add('relatorios');
  for (const it of r.itens) {
    const ano = it.ano || (it.modificado ? +it.modificado.slice(0, 4) : null);
    const texto = `${it.categoria} ${it.titulo}`;
    const siglas = [...new Set(SIGLAS_RELATORIO.filter(([re]) => re.test(texto)).map(([, s]) => s))];
    registrar({
      id: `REL-${hash(it.url)}`,
      tipo: 'REL',
      tipoNome: tipoDoRelatorio(it.categoria, it.titulo),
      orgao: it.concessao,
      titulo: it.titulo,
      ementa: `${it.categoria} — ${it.concessao}${it.encerrada ? ' (contrato encerrado)' : ''}${ano ? `, ${ano}` : ''}${siglas.length ? ` · ${siglas.join(', ')}` : ''}`,
      ano,
      publicado: it.modificado,
      url: it.url,
    }, 'relatorios');
  }
  log(`   ${r.itens.length} arquivos em ${r.concessoes.length} concessões${r.erros.length ? `, ${r.erros.length} erro(s)` : ''}`);
}

// ---------- 5. "Decisões por concessionária" do ANTTlegis ----------
// Lista curada pela ANTT: é a fonte mais confiável para ligar uma decisão à concessão.
function nomeDaConcessao(nomeLista) {
  const c = cfgConcessoes.find((c) => c.re.test(normalizar(nomeLista)));
  if (c) return c.nome;
  return nomeLista.replace(/^(contrato encerrado|caducidade declarada)\s*-\s*/i, '').toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase());
}

async function etapaConcessoesLegis() {
  log('ANTTlegis: decisões por concessionária');
  const sessao = criarSessaoLegis({ pausaMs: 300 });
  const r = await coletarDecisoesPorConcessionaria(sessao);
  erros.push(...r.erros);
  const indice = new Map();
  for (const a of atos.values()) {
    if (TIPOS_EXTERNOS.has(a.tipo)) continue;
    const k = `${a.tipo}|${a.numero}|${a.ano}`;
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(a);
  }
  if (!r.erros.length && r.listas.length) for (const a of atos.values()) delete a.concessaoLegis;
  let ligados = 0;
  let semPar = 0;
  for (const lista of r.listas) {
    const nome = nomeDaConcessao(lista.nome);
    for (const it of lista.itens) {
      const k = chaveDoTitulo(it.titulo);
      const cand = k ? (indice.get(`${k.tipo}|${k.numero}|${k.ano}`) || []).filter((a) => (k.orgao ? a.orgao.startsWith(k.orgao + '/') : /^(DG|DC)\//.test(a.orgao))) : [];
      if (cand.length === 1) {
        cand[0].concessaoLegis = nome;
        ligados++;
      } else semPar++;
    }
  }
  log(`   ${r.listas.length} concessões, ${ligados} atos ligados${semPar ? `, ${semPar} sem correspondência na base` : ''}`);
}

// ---------- 6. fichas do texto integral: DUPs e autorizações de uso da faixa ----------
// Lê só os atos que ainda não têm ficha; a ficha fica guardada na base para as próximas execuções.
async function etapaFichas() {
  // --refazer-dups: relê as DUPs já processadas (ex.: após melhorar o extrator)
  if (opt('refazer-dups')) for (const a of atos.values()) delete a.dup;
  const pendentes = [...atos.values()]
    .filter((a) => !TIPOS_EXTERNOS.has(a.tipo) && ((!a.dup && ehDup(a)) || (!a.faixa && ehUsoDaFaixa(a))))
    .sort((x, y) => (y.data || '').localeCompare(x.data || ''));
  const lote = pendentes.slice(0, MAX_FICHAS);
  log(`ANTTlegis: fichas (DUP e uso da faixa) — ${lote.length} a ler${pendentes.length > lote.length ? ` (de ${pendentes.length}; o restante fica para a próxima execução)` : ''}`);
  if (!lote.length) return;
  const sessao = criarSessaoLegis({ pausaMs: 250 });
  let ok = 0;
  for (const [i, a] of lote.entries()) {
    try {
      if (ehDup(a)) a.dup = await fichaDaDup(sessao, a, cfgConcessoes);
      else a.faixa = await fichaDaFaixa(sessao, a, cfgConcessoes);
      ok++;
    } catch (e) {
      erros.push(`Ficha ${a.id}: ${e.message}`);
    }
    if ((i + 1) % 200 === 0) log(`   ${i + 1}/${lote.length}`);
  }
  log(`   ${ok} ficha(s) extraída(s)`);
}

function concessaoDoAto(a) {
  if (a.tipo === 'REL') {
    const n = normalizar(a.orgao);
    return (cfgConcessoes.find((c) => c.re.test(n)) || {}).nome || a.orgao;
  }
  // Ordem de confiança: concessionária citada no texto integral (ficha) > ementa/título > lista curada do ANTTlegis
  // (que tem erros: ex. DUPs da Via Brasil listadas na Via Araucária) > nome/rodovia citados na ficha.
  const f = a.dup || a.faixa || {};
  const achar = (txt) => (txt ? cfgConcessoes.find((c) => c.re.test(normalizar(txt)))?.nome : null);
  return (
    achar(f.concessionaria) ||
    f.concessao ||
    achar(`${a.titulo} ${a.ementa} ${a.nota || ''}`) ||
    a.concessaoLegis ||
    achar(f.rodoviaNome) ||
    achar((f.rodovias || []).join(' ')) ||
    null
  );
}

// ---------- 7. poligonais das DUPs (mapa) ----------
// Lê o quadro de coordenadas (PDF anexo ou tabela no texto) das DUPs ainda não processadas.
// O resultado fica em site/data/poligonais.json (cache) e o mapa usa site/data/mapa.json.
const ARQ_POLIGONAIS = path.join(DIR_DADOS, 'poligonais.json');
const ARQ_MAPA = path.join(DIR_DADOS, 'mapa.json');
let poligonais = {};
try {
  poligonais = lerJSON(ARQ_POLIGONAIS).itens || {};
} catch {
  poligonais = {};
}

async function etapaPoligonais() {
  const pdf = await carregarPdfjs();
  // erros de rede (ex.: PDF ainda não publicado) são sempre tentados de novo; --refazer-mapa tenta também os não reconhecidos
  const refazer = (st) => st === 'erro' || (opt('refazer-mapa') && st !== 'ok');
  const pendentes = [...atos.values()].filter((a) => a.dup && (a.dup.anexo || a.dup.quadroNoTexto) && (!poligonais[a.id] || refazer(poligonais[a.id].st)));
  const lote = pendentes.sort((x, y) => (y.data || '').localeCompare(x.data || '')).slice(0, MAX_FICHAS);
  log(`Mapa: quadros de coordenadas — ${lote.length} a ler${pdf ? '' : ' (pdfjs-dist não instalado: só os quadros no texto do ato)'}`);
  if (!lote.length) return;
  const sessaoLegis = criarSessaoLegis({ pausaMs: 250 });
  const sessaoPdf = new Sessao({ pausaMs: 250 });
  let ok = 0;
  for (const [i, a] of lote.entries()) {
    try {
      let linhas;
      if (a.dup.anexo) {
        if (!pdf) continue;
        linhas = await linhasDoPdf(await sessaoPdf.binario(a.dup.anexo));
      } else {
        const html = await sessaoLegis.texto(urlAto(a));
        linhas = linhasDoHtml(html.slice(Math.max(0, html.indexOf('id="conteudo"'))));
      }
      const q = interpretarQuadro(linhas);
      // anexo de outro processo E de outra rodovia (erro de publicação): não entra no mapa
      const outraRodovia = q.rodovias.length && a.dup.rodovias?.length && !q.rodovias.some((r) => a.dup.rodovias.includes(r));
      if (q.referencia && a.dup.processo && q.referencia !== a.dup.processo && outraRodovia) {
        poligonais[a.id] = { st: 'divergente', ref: q.referencia };
        continue;
      }
      // UFs citadas no ato (rodovias "BR-163/PA" e municípios "Itaituba/PA") para conferir o fuso informado no anexo
      const ufs = [...new Set([...(a.dup.rodovias || []), ...(a.dup.municipios || [])].map((x) => (x.match(/\/([A-Z]{2})$/) || [])[1]).filter(Boolean))];
      const v = poligonosValidados(q, ufs);
      poligonais[a.id] = v.poligonos.length
        ? { st: 'ok', fu: v.fuso, at: q.areaTotal, p: v.poligonos, ...(v.fusoCorrigido ? { fuAnexo: q.fuso } : {}) }
        : { st: v.foraDaUf ? 'fora-da-uf' : 'sem', fu: q.fuso };
      if (v.poligonos.length) ok++;
    } catch (e) {
      poligonais[a.id] = { st: 'erro', msg: String(e.message).slice(0, 120) };
    }
    if ((i + 1) % 100 === 0) log(`   ${i + 1}/${lote.length}`);
  }
  log(`   ${ok} DUP(s) com poligonal no mapa`);
}

function gravarMapa(lista) {
  fs.writeFileSync(ARQ_POLIGONAIS, JSON.stringify({ atualizadoEm: new Date().toISOString(), itens: poligonais }) + '\n');
  const itens = [];
  for (const a of lista) {
    const pg = poligonais[a.id];
    if (!a.dup || !pg || pg.st !== 'ok') continue;
    const d = a.dup;
    itens.push({
      i: a.id, ti: a.titulo, cc: a.concessao || '', ob: d.obra || '', mu: (d.municipios || []).join(', '), ro: (d.rodovias || []).join(', '),
      km: (d.kms || []).join('; '), d: a.data || '', dou: d.dou || '', pr: d.processo || '', ax: d.anexo || '', at: pg.at || '', fu: pg.fu, fa: pg.fuAnexo || undefined,
      u: `https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&link=S&tipo=${a.tipo}&numeroAto=${String(a.numero).padStart(8, '0')}&seqAto=${a.seq || '000'}&valorAno=${a.ano}&orgao=${a.orgao}&cod_modulo=161&cod_menu=5408`,
      p: pg.p,
    });
  }
  fs.writeFileSync(ARQ_MAPA, JSON.stringify({ atualizadoEm: new Date().toISOString(), concessoes: cfgConcessoes.filter((c) => c.destaque).map((c) => c.nome), itens }) + '\n');
  return itens.length;
}

// Temas pelo tipo de uso da faixa
const TEMA_DO_USO = { Acesso: 'acessos', Publicidade: 'publicidade' };

// ---------- 8. DNIT (gov.br): atos normativos, faixa de domínio, manuais e normas do IPR ----------
const cfgDnit = lerJSON(path.join(RAIZ, 'config', 'fontes.json')).dnit || [];

function situacaoDnit(it) {
  const t = normalizar(`${it.categoria} ${it.titulo} ${it.descricao}`);
  if (/revogad|cancelad/.test(t)) return 'Revogado';
  if (/regulamentacao atual|vigente/.test(t)) return 'Vigente';
  return '';
}

async function etapaDnit() {
  if (!cfgDnit.length) return;
  log('DNIT: atos normativos, faixa de domínio e publicações do IPR');
  const r = await coletarGovBr({ raizes: cfgDnit, maxPaginas: 900, paginasComoItem: false, pausaMs: 300, log: () => {} });
  erros.push(...r.erros.map((e) => `DNIT ${e}`));
  if (!r.erros.length) fontesOk.add('dnit');
  const vistos = new Set();
  for (const it of r.itens) {
    if (!/gov\.br\/dnit|dnit\.gov\.br/.test(it.url)) continue; // links externos (DOU, outros órgãos) ficam de fora
    let titulo = it.titulo;
    // Manuais do IPR: o número da publicação só aparece no nome do arquivo (ex.: .../712_manual_ordenam_uso_solo.pdf)
    const ipr = /\/ipr\//.test(it.url) && !/^publica/i.test(titulo) && (it.url.match(/\/(?:publicacao[_-]ipr[_-]|ipr[_-])?(\d{3})[_-][a-z]/i) || [])[1];
    if (ipr && /manua/i.test(it.categoria)) titulo = `Publicação IPR ${ipr} — ${titulo}`;
    // "Resolução nº 07/2021", "Portaria nº 2.987/2021", "Instrução Normativa nº 35, de 8/7/2021"
    const num = titulo.match(/n[º°o.]?\s*0*(\d{1,3}(?:\.\d{3})*|\d+)\s*(?:\/|,?\s*de\s+[^/]*?)(\d{4})/i) || titulo.match(/\b0*(\d{1,4})\/(\d{4})\b/);
    if (num) num[1] = num[1].replace(/\./g, '');
    const id = `DNIT-${hash(it.url + '|' + titulo)}`;
    vistos.add(id);
    registrar({
      id,
      tipo: 'DNIT',
      tipoNome: it.tipoNome === 'Documento' && /norma/i.test(it.categoria) ? 'Norma Técnica' : it.tipoNome,
      orgao: /\/ipr\//.test(it.url) ? 'DNIT/IPR' : 'DNIT',
      titulo,
      ementa: [it.descricao, it.categoria].filter(Boolean).join(' · '),
      numero: num ? +num[1] : undefined,
      ano: num ? +num[2] : it.data ? +it.data.slice(0, 4) : (titulo.match(/\b(19[5-9]\d|20\d{2})\b/) || [])[1] ? +(titulo.match(/\b(19[5-9]\d|20\d{2})\b/) || [])[1] : null,
      data: it.data,
      situacao: situacaoDnit(it),
      url: it.url,
    }, 'dnit');
  }
  // documentos que saíram do site do DNIT deixam a base (só quando o rastreamento foi completo)
  if (!r.erros.length && vistos.size) for (const [id, a] of atos) if (a.tipo === 'DNIT' && !vistos.has(id)) atos.delete(id);
  log(`   ${vistos.size} documentos do DNIT em ${r.paginas} páginas`);
}

// ---------- execução ----------
async function principal() {
  log(`Modo ${COMPLETO ? 'COMPLETO' : 'incremental'} — base existente: ${anteriores.size} atos`);
  if (!(FILTRO_FONTES && FILTRO_FONTES.includes('nenhuma'))) await etapaListagens();
  if (!SEM_TEMAS) await etapaTemas();
  if (!SEM_CONCESSOES) {
    try {
      await etapaConcessoesLegis();
    } catch (e) {
      erros.push(`decisões por concessionária: ${e.message}`);
      log('! decisões por concessionária:', e.message);
    }
  }
  if (!SEM_FICHAS) await etapaFichas();
  if (!SEM_MAPA) {
    try {
      await etapaPoligonais();
    } catch (e) {
      erros.push(`mapa: ${e.message}`);
      log('! mapa:', e.message);
    }
  }
  if (!SEM_GOVBR) {
    try {
      await etapaGovBr();
    } catch (e) {
      erros.push(`gov.br: ${e.message}`);
      log('! gov.br:', e.message);
    }
  }
  if (!SEM_DNIT) {
    try {
      await etapaDnit();
    } catch (e) {
      erros.push(`DNIT: ${e.message}`);
      log('! DNIT:', e.message);
    }
  }
  if (!SEM_RELATORIOS) {
    try {
      await etapaRelatorios();
    } catch (e) {
      erros.push(`relatórios: ${e.message}`);
      log('! relatórios:', e.message);
    }
  }

  // No modo completo, preserva o que não pôde ser recoletado (etapa puladas ou com erro)
  if (COMPLETO) {
    for (const [id, a] of anteriores) {
      if (atos.has(id)) continue;
      const aindaValido = (a.fontes || []).some((f) => !fontesOk.has(f));
      if (aindaValido) atos.set(id, a);
    }
  }

  // Pós-processamento
  for (const [id, a] of atos) {
    if (!TIPOS_EXTERNOS.has(a.tipo) && ehAdministrativo(a)) {
      atos.delete(id);
      continue;
    }
    if (!TIPOS_EXTERNOS.has(a.tipo)) a.tipoNome = nomeDoTipo(a);
    a.setores = setoresDoAto(a);
    a.temas = unir(temasPorPalavras(a, temasCompilados), a.temasBusca || []).sort();
    if (a.dup && !ehDup(a)) delete a.dup;
    if (a.faixa && !ehUsoDaFaixa(a)) delete a.faixa;
    a.concessao = concessaoDoAto(a);
    const extras = [];
    if (a.dup) extras.push('desapropriacao');
    if (a.faixa) {
      extras.push('faixa-dominio');
      for (const u of a.faixa.usos || []) extras.push(TEMA_DO_USO[u] || (u === 'Outros' || u === 'Equipamentos e dispositivos' ? null : 'ocupacao-faixa'));
    }
    a.temas = unir(a.temas, extras.filter(Boolean)).sort();
    a.noMapa = poligonais[a.id]?.st === 'ok' ? 1 : undefined;
    if (a.dup) {
      if (poligonais[a.id]?.st === 'divergente') a.dup.anexoDivergente = poligonais[a.id].ref;
      else delete a.dup.anexoDivergente;
    }
    if (a.url && !TIPOS_EXTERNOS.has(a.tipo)) delete a.url;
  }

  const lista = [...atos.values()].sort((x, y) => (y.data || '').localeCompare(x.data || '') || (y.numero || 0) - (x.numero || 0));
  fs.mkdirSync(DIR_DADOS, { recursive: true });
  // um ato por linha: facilita ver no Git o que mudou a cada atualização
  const noMapa = gravarMapa(lista);
  log(`Mapa: ${noMapa} DUP(s) com poligonal`);
  fs.writeFileSync(ARQ_ATOS, '[\n' + lista.map((a) => JSON.stringify(paraDisco(a))).join(',\n') + '\n]\n');

  const contar = (fn) => lista.reduce((acc, a) => { for (const k of [].concat(fn(a))) if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const metaAnterior = fs.existsSync(ARQ_META) ? lerJSON(ARQ_META) : {};
  const meta = {
    atualizadoEm: new Date().toISOString(),
    ultimaColetaCompleta: COMPLETO && !erros.length ? new Date().toISOString() : metaAnterior.ultimaColetaCompleta || null,
    modo: COMPLETO ? 'completo' : 'incremental',
    duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
    total: lista.length,
    porTipo: contar((a) => a.tipoNome),
    porSetor: contar((a) => a.setores),
    porFonte: contar((a) => a.fontes),
    fontes: [
      ...cfgFontes.map((f) => ({ id: f.id, nome: f.nome, url: `https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=${f.acao}&cod_modulo=${f.modulo}&cod_menu=${f.menu}` })),
      { id: 'busca', nome: 'Busca no texto integral do ANTTlegis (por tema)', url: 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirLegislacao&cod_modulo=161&cod_menu=5408' },
      { id: 'govbr', nome: 'gov.br/antt — Normativos de Rodovias', url: 'https://www.gov.br/antt/pt-br/assuntos/rodovias/normativos-de-rodovias' },
      { id: 'dnit', nome: 'DNIT (gov.br) — atos normativos, faixa de domínio, manuais e normas técnicas do IPR', url: 'https://www.gov.br/dnit/pt-br/central-de-conteudos/atos-normativos' },
      { id: 'relatorios', nome: 'gov.br/antt — Relatórios das concessões (monitoração, verificador, obras, financeiros)', url: 'https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias' },
    ],
    concessoes: cfgConcessoes
      .map((c) => ({
        nome: c.nome,
        destaque: !!c.destaque,
        total: lista.filter((a) => a.concessao === c.nome).length,
        dups: lista.filter((a) => a.concessao === c.nome && a.dup).length,
        faixa: lista.filter((a) => a.concessao === c.nome && a.faixa).length,
      }))
      .filter((c) => c.total),
    totalDups: lista.filter((a) => a.dup).length,
    totalFaixa: lista.filter((a) => a.faixa).length,
    temas: cfgTemas.map((t) => ({ id: t.id, nome: t.nome, descricao: t.descricao, sinonimos: t.sinonimos, busca: t.busca, total: lista.filter((a) => a.temas.includes(t.id)).length })),
    erros,
  };
  fs.writeFileSync(ARQ_META, JSON.stringify(meta, null, 2) + '\n');
  log(`Concluído: ${lista.length} atos gravados em site/data (${erros.length} erro(s)).`);
  if (erros.length) for (const e of erros.slice(0, 20)) log('  -', e);
  // Falha só se nada foi coletado — erros pontuais não devem derrubar a atualização diária
  if (!lista.length) process.exit(1);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
