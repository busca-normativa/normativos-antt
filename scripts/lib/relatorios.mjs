// Coleta dos relatórios publicados nas páginas de cada concessão rodoviária no gov.br/antt:
// Relatórios de Monitoração, do Verificador Independente, de Acompanhamento das Obras, financeiros etc.
// Indexa título, concessão, categoria, ano e link de cada arquivo (o conteúdo dos PDFs não é lido).

import { Sessao } from './http.mjs';
import { textoPuro, decodificarEntidades, dataBR, normalizar } from './texto.mjs';

export const PAGINA_CONCESSOES = 'https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias';
const RE_CONCESSAO = /^https:\/\/www\.gov\.br\/antt\/pt-br\/assuntos\/rodovias\/concessionarias\/lista-de-concessoes\/(contratos-encerrados\/)?[^/]+$/;

function limparUrl(href, base) {
  try {
    const u = new URL(decodificarEntidades(href.trim()), base);
    u.hash = '';
    u.search = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function conteudo(html) {
  const i = html.indexOf('id="content"');
  if (i < 0) return html;
  const j = html.indexOf('id="viewlet-below-content"', i);
  return html.slice(i, j > i ? j : undefined);
}

function tituloPagina(html) {
  const h1 = html.match(/<h1[^>]*documentFirstHeading[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? textoPuro(h1[1]) : '';
}

/** Lista as concessões (em andamento e encerradas) a partir da página de concessionárias. */
async function listarConcessoes(sessao) {
  const html = await sessao.texto(PAGINA_CONCESSOES);
  const mapa = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = limparUrl(m[1], PAGINA_CONCESSOES);
    if (!url || !RE_CONCESSAO.test(url)) continue;
    const nome = textoPuro(m[2]);
    if (nome && (!mapa.has(url) || nome.length > mapa.get(url).length)) mapa.set(url, nome);
  }
  return [...mapa].map(([url, nome]) => ({
    url,
    // "Via Brasil BR-163 Área de atuação: MT e PA Extensão: ..." -> "Via Brasil BR-163"
    nome: (nome.split(/\s+[ÁA]rea de atua[çc][ãa]o/i)[0] || url.split('/').pop()).trim(),
    encerrada: /contratos-encerrados|encerrad|caducidade/i.test(url + ' ' + nome),
  }));
}

// "relatorios-de-monitoracao" -> título da página; a categoria é o caminho de páginas abaixo de /relatorios
function anoDoSegmento(seg) {
  const m = String(seg).match(/^(19|20)\d{2}\b/);
  return m ? +m[0] : null;
}

/**
 * Rastreia /relatorios de uma concessão.
 * anoMinimo: pula as pastas de anos anteriores (modo incremental).
 */
async function rastrearConcessao(sessao, conc, { anoMinimo = 0, maxPaginas = 250 } = {}) {
  const raiz = `${conc.url}/relatorios`;
  const fila = [];
  const titulos = new Map(); // url da página -> título
  const vistas = new Set();
  const itens = [];
  const erros = [];

  // Pontos de entrada: links da página da concessão para dentro de /relatorios
  const capa = await sessao.texto(conc.url);
  for (const m of capa.matchAll(/href="([^"]+)"/gi)) {
    const u = limparUrl(m[1], conc.url);
    if (u && u.startsWith(raiz + '/') && !/\.(pdf|xlsx?|docx?|zip)(\/view)?$/i.test(u)) fila.push(u);
  }
  if (!fila.length) fila.push(raiz);

  while (fila.length && vistas.size < maxPaginas) {
    const url = fila.shift();
    if (vistas.has(url)) continue;
    vistas.add(url);
    const segs = url.slice(raiz.length + 1).split('/').filter(Boolean);
    const ano = segs.map(anoDoSegmento).find(Boolean) || null;
    if (ano && ano < anoMinimo) continue;

    let html;
    try {
      html = await sessao.texto(url);
    } catch (e) {
      if (!/HTTP 404/.test(e.message)) erros.push(`${conc.nome} ${url}: ${e.message}`);
      continue;
    }
    titulos.set(url, tituloPagina(html));
    const c = conteudo(html);

    // Categoria: títulos das páginas do caminho, sem as pastas de ano
    const caminho = [];
    for (let i = 1; i <= segs.length; i++) {
      if (anoDoSegmento(segs[i - 1])) continue;
      const t = titulos.get(`${raiz}/${segs.slice(0, i).join('/')}`);
      if (t && !caminho.includes(t)) caminho.push(t);
    }
    const categoria = caminho.join(' › ') || 'Relatórios';

    // Abas por ano carregadas por AJAX
    for (const m of c.matchAll(/data-url="([^"]+)"/gi)) {
      const u = limparUrl(m[1], url);
      if (u && u.startsWith(raiz + '/')) fila.push(u);
    }

    // Listagem do Plone: arquivos e subpastas
    for (const art of c.match(/<article class="entry">[\s\S]*?<\/article>/gi) || []) {
      const a = art.match(/<a\s[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const u = limparUrl(a[1], url);
      if (!u) continue;
      if (/^file$/i.test(a[2]) || /\.(pdf|xlsx?|docx?|zip|rar)(\/view)?$/i.test(u)) {
        const byline = (art.match(/documentByLine[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '';
        itens.push({
          titulo: textoPuro(a[3]) || decodeURIComponent(u.split('/').filter((s) => s !== 'view').pop()),
          url: u.replace(/\/view$/, ''),
          concessao: conc.nome,
          encerrada: conc.encerrada,
          categoria,
          ano,
          modificado: dataBR(textoPuro(byline)),
        });
      } else if (u.startsWith(raiz + '/')) {
        fila.push(u);
      }
    }

    // Outros links de páginas internas (ex.: Verificador › Acompanhamento Mensal)
    for (const m of c.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) {
      const u = limparUrl(m[1], url);
      if (u && u.startsWith(raiz + '/') && !/\/view$|\.(pdf|xlsx?|docx?|zip|rar)$|@@|resolveuid/i.test(u) && !vistas.has(u)) fila.push(u);
    }
  }
  return { itens, erros, paginas: vistas.size };
}

/** Nome curto do tipo de relatório, a partir da categoria. */
export function tipoDoRelatorio(categoria, titulo) {
  const c = normalizar(`${categoria} ${titulo}`);
  if (/verificador/.test(c) && /mensal/.test(c)) return 'Relatório do Verificador (mensal)';
  if (/verificador/.test(c)) return 'Relatório do Verificador';
  if (/monitora/.test(c)) return 'Relatório de Monitoração';
  if (/obras/.test(c)) return 'Relatório de Obras';
  if (/financeir|contab|demonstra/.test(c)) return 'Relatório Financeiro';
  if (/ambient/.test(c)) return 'Relatório Ambiental';
  return 'Relatório de Concessão';
}

export async function coletarRelatorios({ anoMinimo = 0, log = console.log, pausaMs = 300, filtro = null } = {}) {
  const sessao = new Sessao({ charset: 'utf-8', pausaMs });
  const concessoes = (await listarConcessoes(sessao)).filter((c) => !filtro || filtro.some((f) => c.url.includes(f)));
  const itens = [];
  const erros = [];
  for (const conc of concessoes) {
    try {
      const r = await rastrearConcessao(sessao, conc, { anoMinimo });
      itens.push(...r.itens);
      erros.push(...r.erros);
      log(`   ${conc.nome}: ${r.itens.length} arquivo(s) em ${r.paginas} página(s)`);
    } catch (e) {
      erros.push(`${conc.nome}: ${e.message}`);
      log(`   ! ${conc.nome}: ${e.message}`);
    }
  }
  return { itens, erros, concessoes };
}
