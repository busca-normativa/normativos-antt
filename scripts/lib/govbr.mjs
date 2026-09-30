// Coleta das páginas curadas "Normativos de Rodovias" do portal gov.br/antt.
// Essas páginas destacam os principais normativos (RCR, POPs, INs, manuais, portarias do MT etc.)
// e trazem documentos que não estão no ANTTlegis (PDFs, links do DOU).

import { Sessao } from './http.mjs';
import { textoPuro, decodificarEntidades, dataDoTitulo, normalizar } from './texto.mjs';
import { chaveDoLink } from './anttlegis.mjs';

export const RAIZ_GOVBR = 'https://www.gov.br/antt/pt-br/assuntos/rodovias/normativos-de-rodovias';

const EXT_ARQUIVO = /\.(pdf|docx?|xlsx?|odt|zip|rar)(\?|$)/i;

function conteudoPrincipal(html) {
  const i = html.indexOf('id="content"');
  if (i < 0) return '';
  const inicio = html.indexOf('>', i) + 1;
  const j = html.indexOf('id="viewlet-below-content"', inicio);
  const fim = j > inicio ? html.lastIndexOf('<', j) : html.length;
  return html
    .slice(inicio, fim)
    // barra "Compartilhe" e metadados de arquivo do Plone
    .replace(/<div[^>]*class="[^"]*(social-links|share|compartilhe)[^"]*"[\s\S]*?<\/div>/gi, ' ');
}

const LINK_SOCIAL = /facebook\.com|twitter\.com|linkedin\.com|whatsapp\.com|sharer|share\?|t\.me\//i;
const TEXTO_VAZIO = /^(aqui|clique aqui|link|acesse|veja|saiba mais|download|baixar)$/i;

function tituloPagina(html) {
  const h1 = html.match(/<h1[^>]*documentFirstHeading[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return textoPuro(h1[1]);
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  return t ? textoPuro(t[1]).replace(/\s*[—-]\s*(Ag[eê]ncia Nacional|Departamento Nacional).*$/i, '') : '';
}

function descricaoPagina(html) {
  const d = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  return d ? decodificarEntidades(d[1]).trim() : '';
}

function normalizarUrl(href, base) {
  try {
    const u = new URL(decodificarEntidades(href.trim()), base);
    // Espelhos antigos do ANTTlegis
    if (/datalegis\.(inf\.br|net)$/i.test(u.hostname)) u.hostname = 'anttlegis.antt.gov.br';
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function ehPaginaDaSecao(url, raiz = RAIZ_GOVBR) {
  return url.startsWith(raiz + '/') && !EXT_ARQUIVO.test(url) && !/\/(@@|view$|image|resolveuid)/.test(url);
}

function limparDescricao(s) {
  return s
    .replace(/[—–-]?\s*[úu]ltima modifica[çc][ãa]o\s*\d{2}\/\d{2}\/\d{4}\s*\d{2}h\d{2}/gi, ' ')
    .replace(/Compartilhe:?(\s*Compartilhe por \w+)*/gi, ' ')
    .replace(/Publicado em \d{2}\/\d{2}\/\d{4} \d{2}h\d{2}( Atualizado em \d{2}\/\d{2}\/\d{4} \d{2}h\d{2})?/gi, ' ')
    .replace(/^[\s:;,.–-]+/, '')
    .replace(/^(objeto|objetivo|descri[çc][ãa]o)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

/** Converte linhas de tabelas (Referência | Descrição) em itens. */
function itensDeTabelas(html, paginaUrl) {
  const itens = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const celulas = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    if (celulas.length < 2) continue;
    const link = tr.match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const url = link && normalizarUrl(link[1], paginaUrl);
    if (url && !/^(mailto|javascript):/i.test(link[1])) {
      // linha com documento (ex.: "629 | [Defensas rodoviárias]"): o texto do link é o título
      const titulo = textoPuro(link[2]);
      const resto = celulas.map(textoPuro).filter((c) => c && c !== titulo).join(' · ');
      if (titulo && titulo.length <= 250) itens.push({ titulo, descricao: limparDescricao(resto), url });
      continue;
    }
    // linha sem link (ex.: "Referência | Descrição" das normas das OIAs)
    const titulo = textoPuro(celulas[0]);
    const desc = textoPuro(celulas.slice(1).join(' '));
    if (!titulo || titulo.length > 200 || /^(publica[çc][ãa]o|t[íi]tulo|refer[êe]ncia|descri[çc][ãa]o)$/i.test(titulo)) continue;
    itens.push({ titulo, descricao: limparDescricao(desc), url: paginaUrl });
  }
  return itens;
}

/**
 * Extrai itens (link + descrição seguinte) do conteúdo de uma página.
 * Links precedidos de "Alteração:" são tratados como alterações do item principal anterior.
 */
function itensDeLinks(html, paginaUrl) {
  const partes = [];
  const re = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let ultimo = 0;
  let m;
  while ((m = re.exec(html))) {
    partes.push({ antes: textoPuro(html.slice(ultimo, m.index)), href: m[1], texto: textoPuro(m[2]) });
    ultimo = re.lastIndex;
  }
  const resto = textoPuro(html.slice(ultimo));
  const itens = [];
  let principal = null;
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    const depois = i + 1 < partes.length ? partes[i + 1].antes : resto;
    const url = normalizarUrl(p.href, paginaUrl);
    if (!url || /^(mailto|javascript|tel):/i.test(p.href) || p.href.startsWith('#') || LINK_SOCIAL.test(url)) continue;
    if (!p.texto || p.texto.length < 4 || TEXTO_VAZIO.test(p.texto)) {
      // link de imagem/ícone: a descrição seguinte pertence ao item principal
      if (principal && !principal.descricao && /obje(to|tivo)/i.test(depois)) principal.descricao = limparDescricao(depois);
      continue;
    }
    // "Alteração: [link]", "- Alterada pela [link]", ", pela [link] e pela [link]" pertencem ao item anterior
    const ehAlteracao =
      principal &&
      (/altera[çc](ão|ões|ao|oes)\s*:?\s*$/i.test(p.antes) ||
        /(alterad|revogad|complementad)[ao]s?\s+pel[ao]s?\s*$/i.test(p.antes) ||
        /^\s*(,|e|;)?\s*(e\s+)?pel[ao]s?\s*$/i.test(p.antes) ||
        /^\s*(e|,|;)\s*$/.test(p.antes));
    const item = { titulo: p.texto, url, descricao: '', alteraDe: null };
    if (ehAlteracao) {
      item.alteraDe = principal.titulo;
      item.descricao = `Altera: ${principal.titulo}`;
      if (/obje(to|tivo)\s*:/i.test(depois) && !principal.descricao) principal.descricao = limparDescricao(depois.replace(/^[\s\S]*?(obje(to|tivo)\s*:)/i, '$1'));
    } else {
      principal = item;
      if (!/^\s*altera[çc]/i.test(depois)) item.descricao = limparDescricao(depois);
    }
    itens.push(item);
  }
  return itens;
}

function tipoPorTitulo(titulo, categoria) {
  const t = normalizar(titulo);
  const regras = [
    [/^resolu/, 'Resolução'], [/^delibera/, 'Deliberação'], [/^portaria/, 'Portaria'], [/^instru[cç][aã]o normativa/, 'Instrução Normativa'],
    [/^decis/, 'Decisão'], [/^s[uú]mula/, 'Súmula'], [/^of[ií]cio/, 'Ofício Circular'], [/^manual/, 'Manual'], [/^lei /, 'Lei'],
    [/^decreto/, 'Decreto'], [/^norma|abnt|nbr|^dnit\b|^dner\b/, 'Norma Técnica'], [/^recomenda/, 'Recomendação'], [/^publica[çc][ãa]o ipr|^ipr\b/, 'Manual'], [/regulamento/, 'Regulamento'], [/^nota t[eé]cnica/, 'Nota Técnica'],
  ];
  for (const [re, tipo] of regras) if (re.test(t)) return tipo;
  const c = normalizar(categoria);
  if (c.includes('manua')) return 'Manual';
  if (c.includes('procedimento operacional')) return 'POP';
  if (c.includes('oficios')) return 'Ofício Circular';
  if (c.includes('fiscaliza')) return 'Plano de Fiscalização';
  return 'Documento';
}

/**
 * Rastreia seções do gov.br (por padrão, "Normativos de Rodovias" da ANTT).
 * raizes: páginas iniciais; cada uma só segue links para dentro de si mesma.
 * paginasComoItem: subpáginas de 2º nível viram itens (útil na ANTT; no DNIT as subpáginas são pastas de ano).
 */
export async function coletarGovBr({ raizes = [RAIZ_GOVBR], maxPaginas = 80, paginasComoItem = true, pausaMs = 500, log = console.log } = {}) {
  const sessao = new Sessao({ charset: 'utf-8', pausaMs });
  const fila = raizes.map((raiz) => ({ url: raiz, raiz, nivel: 0, categoria: '' }));
  const visitadas = new Set();
  const itens = new Map();
  const erros = [];

  while (fila.length && visitadas.size < maxPaginas) {
    const { url, raiz, nivel, categoria } = fila.shift();
    if (visitadas.has(url)) continue;
    visitadas.add(url);
    let html;
    try {
      html = await sessao.texto(url);
    } catch (e) {
      erros.push(`gov.br ${url}: ${e.message}`);
      continue;
    }
    const titulo = tituloPagina(html);
    const cat = nivel <= 1 ? titulo : categoria;
    let conteudo = conteudoPrincipal(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

    // Subpáginas da seção: rastrear
    for (const m of conteudo.matchAll(/<a\s[^>]*href="([^"]*)"/gi)) {
      const u = normalizarUrl(m[1], url);
      if (u && ehPaginaDaSecao(u.replace(/\/$/, ''), raiz) && !visitadas.has(u.replace(/\/$/, ''))) {
        fila.push({ url: u.replace(/\/$/, ''), raiz, nivel: nivel + 1, categoria: cat });
      }
    }

    // Páginas de 2º nível ou mais (ex.: um manual específico) viram itens próprios
    if (paginasComoItem && nivel >= 2) {
      const corpo = textoPuro(conteudo).replace(titulo, '').slice(0, 600);
      const desc = descricaoPagina(html) || corpo;
      itens.set(url, { titulo, url, descricao: limparDescricao(desc), categoria: cat, pagina: url });
    }

    const tabelas = itensDeTabelas(conteudo, url);
    conteudo = conteudo.replace(/<table[\s\S]*?<\/table>/gi, ' ');
    // links para subpáginas só viram itens quando vêm com descrição (ex.: "Resolução nº 11/2022 - Dispõe sobre...")
    const links = itensDeLinks(conteudo, url).filter((it) => !ehPaginaDaSecao(it.url.replace(/\/$/, ''), raiz) || (!paginasComoItem && it.descricao));
    for (const it of links) {
      // "arquivo.pdf", "Nota Explicativa", "Revisão nº 01": nomeia pelo título da página
      if (EXT_ARQUIVO.test(it.titulo)) it.titulo = `${titulo} (${it.titulo.match(EXT_ARQUIVO)[1].toUpperCase()})`;
      else if (nivel >= 1 && it.titulo.split(/\s+/).length <= 3 && !/\d{3,}|n[º°o]\s*\d/i.test(it.titulo)) it.titulo = `${titulo} — ${it.titulo}`;
      else if (nivel >= 1 && /^revis[ãa]o n/i.test(it.titulo)) it.titulo = `${titulo} — ${it.titulo}`;
    }
    for (const it of [...links, ...tabelas]) {
      const chave = it.url === url ? `${url}#${normalizar(it.titulo)}` : it.url;
      if (itens.has(chave)) {
        const ex = itens.get(chave);
        if (!ex.descricao && it.descricao) ex.descricao = it.descricao;
        continue;
      }
      itens.set(chave, { ...it, categoria: cat, pagina: url });
    }
    log(`   ${titulo} (${links.length + tabelas.length} itens)`);
  }

  const resultado = [...itens.values()].map((it) => {
    const legis = chaveDoLink(it.url);
    return {
      ...it,
      legis,
      tipoNome: tipoPorTitulo(it.titulo, it.categoria),
      data: dataDoTitulo(it.titulo),
    };
  });
  return { itens: resultado, erros, paginas: visitadas.size };
}
