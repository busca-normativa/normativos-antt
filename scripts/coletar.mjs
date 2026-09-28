#!/usr/bin/env node
// Coleta os normativos da ANTT e gera os arquivos de dados do painel (site/data).
//
// Uso:
//   node scripts/coletar.mjs               atualização incremental (ano atual e anterior + temas + gov.br)
//   node scripts/coletar.mjs --completo    recoleta todos os anos (recomendado 1x por semana)
//   node scripts/coletar.mjs --sem-temas   pula a busca no texto integral por tema
//   node scripts/coletar.mjs --sem-govbr   pula as páginas curadas do gov.br
//   node scripts/coletar.mjs --fontes=res,dlb   coleta só as listagens indicadas (ids de config/fontes.json)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarSessaoLegis, coletarListagem, buscarTextoIntegral, idAto } from './lib/anttlegis.mjs';
import { coletarGovBr } from './lib/govbr.mjs';
import { setoresDoAto, ehAtoDePessoal, ehAdministrativo, nomeDoTipo, compilarTemas, temasPorPalavras } from './lib/classificar.mjs';
import { normalizar } from './lib/texto.mjs';

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
const FILTRO_FONTES = valor('fontes') ? valor('fontes').split(',') : null;
const ANO_ATUAL = new Date().getFullYear();
const ANO_MINIMO = COMPLETO ? 0 : ANO_ATUAL - 1;

const lerJSON = (arq) => JSON.parse(fs.readFileSync(arq, 'utf8'));
const cfgFontes = lerJSON(path.join(RAIZ, 'config', 'fontes.json')).anttlegis;
const cfgTemas = lerJSON(path.join(RAIZ, 'config', 'temas.json')).temas;
const temasCompilados = compilarTemas(cfgTemas);

const inicio = Date.now();
const log = (...m) => console.log(`[${((Date.now() - inicio) / 1000).toFixed(0).padStart(4)}s]`, ...m);

// ---------- formato compacto em disco ----------
const CHAVES = { i: 'id', t: 'tipo', tn: 'tipoNome', n: 'numero', a: 'ano', o: 'orgao', q: 'seq', ti: 'titulo', e: 'ementa', si: 'situacao', d: 'data', p: 'publicado', u: 'url', f: 'fontes', tm: 'temas', tb: 'temasBusca', se: 'setores', g: 'destaque', nt: 'nota' };
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

// ---------- execução ----------
async function principal() {
  log(`Modo ${COMPLETO ? 'COMPLETO' : 'incremental'} — base existente: ${anteriores.size} atos`);
  await etapaListagens();
  if (!SEM_TEMAS) await etapaTemas();
  if (!SEM_GOVBR) {
    try {
      await etapaGovBr();
    } catch (e) {
      erros.push(`gov.br: ${e.message}`);
      log('! gov.br:', e.message);
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
    if (a.tipo !== 'GOV' && ehAdministrativo(a)) {
      atos.delete(id);
      continue;
    }
    if (a.tipo !== 'GOV') a.tipoNome = nomeDoTipo(a);
    a.setores = setoresDoAto(a);
    a.temas = unir(temasPorPalavras(a, temasCompilados), a.temasBusca || []).sort();
    if (a.url && a.tipo !== 'GOV') delete a.url;
  }

  const lista = [...atos.values()].sort((x, y) => (y.data || '').localeCompare(x.data || '') || (y.numero || 0) - (x.numero || 0));
  fs.mkdirSync(DIR_DADOS, { recursive: true });
  // um ato por linha: facilita ver no Git o que mudou a cada atualização
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
    ],
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
