// Coleta de atos no ANTTlegis (https://anttlegis.antt.gov.br).
// Duas formas: listagens por ano (ementário por tipo de ato) e busca no texto integral.

import { Sessao, formLatin1 } from './http.mjs';
import { textoPuro, decodificarEntidades, dataDoTitulo, dataBR, desduplicarTitulo } from './texto.mjs';

export const BASE_LEGIS = 'https://anttlegis.antt.gov.br';
const ACTION = '/action/ActionDatalegis.php';

export const TIPOS = {
  RES: 'Resolução', DLB: 'Deliberação', POR: 'Portaria', PCJ: 'Portaria Conjunta', PCP: 'Portaria Complementar',
  INM: 'Instrução Normativa', INC: 'Instrução Normativa Conjunta', DCS: 'Decisão', VTO: 'Voto', DVT: 'Declaração de Voto',
  SUM: 'Súmula', MAN: 'Manual', NTC: 'Nota Técnica', NTA: 'Nota Informativa', OFC: 'Ofício Circular', CCR: 'Carta-Circular',
  ISV: 'Instrução de Serviço', OSV: 'Ordem de Serviço', AUD: 'Audiência Pública', CPB: 'Consulta Pública',
  TMS: 'Tomada de Subsídio', REU: 'Reunião Participativa', DEC: 'Decreto', DSN: 'Decreto', LEI: 'Lei', EMC: 'Emenda Constitucional',
  AVS: 'Aviso', COM: 'Comunicado', DEP: 'Despacho', CON: 'Licitação - Concessão', LEL: 'Leilão / Concessão',
  NOF: 'Notificação', AUT: 'Autorização', ATA: 'Ata', REQ: 'Requerimento', MEM: 'Memorando',
};

// Tipos administrativos (pessoal, compras, contratos internos, editais de notificação de multas) que só
// geram ruído no painel.
export const TIPOS_ADMINISTRATIVOS = new Set(
  ('ABP AFA APO APT ADR AUX CDS CMS CMT CNC CNV DCP DES DIS EQA EXO GRT GDT HRE IDS IIR JDT LIC LTS NOM PEN PRD PRF REA REC REM RQS RSO TTB TAC VAC PRE PDP ' +
    'PRG ERP EDL IXL COR ENE ERD SEL MFT AFR ACD ECO CES CRD COV DOA EXS EIT EME MSA ETJ TCP TCM EXC DSG ETE ETA EXL ECE EXD ECM GPP ATB EDC NED PTL APB EPC ' +
    'PLO PLP PCT PTM DAB EDT APE ITM MTR PAO').split(' ')
);

/** Extrai a chave do ato a partir de qualquer link do ANTTlegis. */
export function chaveDoLink(href) {
  if (!href) return null;
  let u;
  try {
    u = new URL(decodificarEntidades(href), BASE_LEGIS);
  } catch {
    return null;
  }
  if (!/anttlegis|datalegis/i.test(u.hostname)) return null;
  const p = u.searchParams;
  const tipo = p.get('tipo') || p.get('sgl_tipo');
  const numero = p.get('numeroAto') || p.get('num_ato');
  const ano = p.get('valorAno') || p.get('vlr_ano');
  const orgao = p.get('orgao') || p.get('sgl_orgao');
  const seq = p.get('seqAto') || p.get('seq_ato') || '000';
  if (!tipo || !numero || !ano || !orgao) return null;
  return { tipo: tipo.toUpperCase(), numero: parseInt(numero, 10), seq: seq.toUpperCase(), ano: parseInt(ano, 10), orgao: orgao.toUpperCase() };
}

export function idAto(k) {
  return `${k.tipo}-${k.numero}-${k.ano}-${k.orgao.replace(/\//g, '.')}-${k.seq}`;
}

export function urlAto(k) {
  const n = String(k.numero).padStart(8, '0');
  return `${BASE_LEGIS}${ACTION}?acao=abrirTextoAto&link=S&tipo=${k.tipo}&numeroAto=${n}&seqAto=${k.seq}&valorAno=${k.ano}&orgao=${k.orgao}&cod_modulo=161&cod_menu=5408`;
}

/** Converte blocos de ato (listagem ou busca) em registros. */
export function parsearAtos(html) {
  const atos = [];
  const re = /<a\s[^>]*href=(["'])([^"']*acao=abrirTextoAto[^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const k = chaveDoLink(m[2]);
    if (!k) continue;
    const corpo = m[3];
    const sit = (corpo.match(/class="ico-situacao[^"]*"[^>]*title="([^"]*)"/i) || [])[1] || '';
    const strong = (corpo.match(/<strong>([\s\S]*?)<\/strong>/i) || [])[1] || '';
    let titulo = textoPuro(strong.replace(/<span[^>]*class="ico-situacao[\s\S]*?<\/span>/i, ''));
    titulo = desduplicarTitulo(titulo);
    const ps = [...corpo.matchAll(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi)];
    let ementa = '';
    let publicado = null;
    for (const p of ps) {
      if (/data-hora/.test(p[1] || '')) publicado = dataBR(p[2]);
      else if (!ementa) ementa = textoPuro(p[2]);
    }
    atos.push({
      ...k,
      id: idAto(k),
      titulo,
      ementa,
      situacao: decodificarEntidades(sit).trim(),
      data: dataDoTitulo(titulo) || publicado,
      publicado,
    });
  }
  return atos;
}

export function criarSessaoLegis(opcoes = {}) {
  return new Sessao({ base: BASE_LEGIS, charset: 'latin1', ...opcoes });
}

/**
 * Coleta uma listagem do tipo "resenha por ano" (ex.: Resoluções, Deliberações, Portarias SUROD).
 * fonte = { nome, modulo, menu, acao }
 * opcoes.anoMinimo: coleta somente anos >= anoMinimo (modo incremental).
 */
export async function coletarListagem(sessao, fonte, { anoMinimo = 0, log = console.log } = {}) {
  const inicial = `${ACTION}?acao=${fonte.acao}&cod_modulo=${fonte.modulo}&cod_menu=${fonte.menu}`;
  sessao.limparCookies();
  const html = await sessao.texto(inicial);
  const acaoPagina = (html.match(/var link = "\/action\/ActionDatalegis\.php\?acao=(abrirPagina\w+)/) || [])[1];
  if (!acaoPagina) throw new Error(`Link de paginação não encontrado em ${fonte.nome}`);
  // O script da página traz outro cod_modulo (da sessão); a paginação só funciona com o módulo da própria listagem.
  const link = `${ACTION}?acao=${acaoPagina}&cod_modulo=${fonte.modulo}&cod_menu=${fonte.menu}`;
  const anos = [...new Set([...html.matchAll(/[?&]ano=(\d{4})"/g)].map((x) => +x[1]))].sort((a, b) => b - a);
  const alvo = anos.length ? anos.filter((a) => a >= anoMinimo) : [null];
  const atos = [];
  const erros = [];
  for (const ano of alvo) {
    try {
      if (ano) await sessao.texto(`${inicial}&ano=${ano}`);
      let lidos = 0;
      for (let pagina = 1; pagina < 50; pagina++) {
        const parte = parsearAtos(await sessao.texto(`${link}&qtd_pagina=1000&pagina=${pagina}`));
        atos.push(...parte);
        lidos += parte.length;
        if (parte.length < 1000) break;
      }
      log(`   ${fonte.nome} ${ano ?? ''}: ${lidos}`);
    } catch (e) {
      erros.push(`${fonte.nome} ${ano}: ${e.message}`);
      log(`   ! ${fonte.nome} ${ano}: ${e.message}`);
    }
  }
  return { atos, erros, anos: alvo };
}

/**
 * Busca no texto integral do ANTTlegis (mesma busca da "Busca Livre").
 * exato = true procura a expressão exata.
 */
export async function buscarTextoIntegral(sessao, termo, { exato = true, maxPaginas = 10, porPagina = 500, filtrarAdministrativos = true } = {}) {
  sessao.limparCookies();
  await sessao.texto(`${ACTION}?acao=abrirLegislacao&cod_modulo=161&cod_menu=5408`);
  const campos = {
    txt_texto: termo,
    cod_modulo: 161,
    cod_menu: 5408,
    redirect_consultaato: 'apresentarAtos',
    in_pesquisa_avancada: 'N',
    inApsModuloBase: 'S',
    ind_legis_juris: 'L',
    pagina: 1,
    qtd_pagina: porPagina,
  };
  if (exato) campos.busca_expressao = 1;
  const html = await sessao.texto(`${ACTION}?acao=consultarAtosInicial&cod_modulo=161&cod_menu=5408&buscaGeral=true`, { metodo: 'POST', corpo: formLatin1(campos) });
  const total = parseInt(((html.match(/Resultado da Busca:\s*<span>([\d.]+)/) || [])[1] || '0').replace(/\./g, ''), 10);
  const atos = [];
  const paginas = Math.min(maxPaginas, Math.ceil(total / porPagina));
  for (let p = 1; p <= paginas; p++) {
    const j = await sessao.json(`${ACTION}?acao=abrirPagina&pagina=${p}&legisjuris=L`, { metodo: 'POST', corpo: formLatin1({ ...campos, pagina: p }) });
    const parte = parsearAtos(j.resultado || '');
    atos.push(...parte);
    if (parte.length < porPagina) break;
  }
  const filtrados = filtrarAdministrativos ? atos.filter((a) => !TIPOS_ADMINISTRATIVOS.has(a.tipo)) : atos;
  return { total, obtidos: atos.length, atos: filtrados };
}
