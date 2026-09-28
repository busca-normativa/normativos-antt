// Painel de Normativos ANTT — Rodovias
// Busca local (sem servidor) sobre site/data/atos.json, com temas, filtros, gráficos e exportação.

const $ = (s, el = document) => el.querySelector(s);
const NF = new Intl.NumberFormat('pt-BR');
const LEGIS = 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php';
const BUSCA_LIVRE = `${LEGIS}?acao=abrirLegislacao&cod_modulo=161&cod_menu=5408`;
const POR_PAGINA = 50;

const CHAVES = { i: 'id', t: 'tipo', tn: 'tipoNome', n: 'numero', a: 'ano', o: 'orgao', q: 'seq', ti: 'titulo', e: 'ementa', si: 'situacao', d: 'data', p: 'publicado', u: 'url', f: 'fontes', tm: 'temas', se: 'setores', g: 'destaque', nt: 'nota' };
const SETORES = { R: 'Rodovias', F: 'Ferrovias', P: 'Passageiros', C: 'Cargas', G: 'Geral' };
const STOP = new Set('de da do das dos e o a os as em no na nos nas para por com sobre ao aos um uma que se ou sem sob pelo pela pelos pelas n'.split(' '));
const SUFIXOS = ['acoes', 'icoes', 'mentos', 'mento', 'acao', 'icao', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada', 'ido', 'ida', 'ares', 'eres', 'ires', 'ar', 'er', 'ir', 'oes', 'aes', 'ais', 'eis', 'es', 's'];

// ---------------------------------------------------------------- utilidades
function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[º°ª]/g, '')
    .toLowerCase();
}
function semMilhar(s) {
  return s.replace(/(\d)\.(?=\d{3}(\D|$))/g, '$1');
}
function radical(t) {
  if (t.length < 6 || /\d/.test(t)) return t;
  for (const s of SUFIXOS) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length);
  return t;
}
function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
function compacto(n) {
  return NF.format(n);
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('visivel');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('visivel'), 2600);
}
async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function urlDoAto(a) {
  if (a.url) return a.url;
  const n = String(a.numero).padStart(8, '0');
  return `${LEGIS}?acao=abrirTextoAto&link=S&tipo=${a.tipo}&numeroAto=${n}&seqAto=${a.seq || '000'}&valorAno=${a.ano}&orgao=${a.orgao}&cod_modulo=161&cod_menu=5408`;
}

function classeSituacao(s) {
  const n = normalizar(s);
  if (!n) return '';
  if (/revogador|alterador|retificador/.test(n)) return 'alteracao';
  if (/revogad|sem efeito|cancelad|suspens|caduc/.test(n)) return 'revogado';
  if (/vigente|a entrar/.test(n)) return 'vigente';
  return 'outro';
}

// ---------------------------------------------------------------- estado
const estado = {
  q: '',
  tema: '',
  tipos: new Set(),
  orgao: '',
  categoria: '',
  de: null,
  ate: null,
  rodovias: true,
  vigentes: false,
  destaque: false,
  ordem: 'auto',
  limite: POR_PAGINA,
};

let ATOS = [];
let META = {};
let TEMAS = [];
let TEMA_POR_ID = new Map();
let modoServidor = false;
let ultimo = { final: [], consulta: null };

// ---------------------------------------------------------------- carga
async function carregar() {
  const [meta, atos] = await Promise.all([
    fetch('data/meta.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('data/atos.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  META = meta;
  TEMAS = (meta.temas || []).map((t) => ({ ...t, sin: (t.sinonimos || []).map((s) => semMilhar(normalizar(s))) }));
  TEMA_POR_ID = new Map(TEMAS.map((t) => [t.id, t]));
  ATOS = atos.map((o) => {
    const a = {};
    for (const k in o) a[CHAVES[k] || k] = o[k];
    a.temas = a.temas || [];
    a.setores = a.setores || ['G'];
    a._h = semMilhar(normalizar([a.titulo, a.ementa, a.nota, a.tipoNome, a.orgao, a.destaque].filter(Boolean).join(' · ')));
    a._ti = semMilhar(normalizar(a.titulo));
    a._sit = classeSituacao(a.situacao);
    a._rod = a.setores.includes('R') || a.setores.includes('G');
    a._org = a.tipo === 'GOV' ? a.orgao || 'gov.br' : (a.orgao || '').split('/')[0];
    a._dt = a.data || a.publicado || (a.ano ? `${a.ano}-01-01` : '');
    return a;
  });
}

// ---------------------------------------------------------------- consulta
function analisarConsulta(q) {
  let qn = semMilhar(normalizar(q)).trim();
  const frases = [];
  qn = qn.replace(/"([^"]+)"/g, (_, f) => { frases.push(f.trim()); return ' '; });
  const numeros = [];
  let resto = qn.replace(/(^|[^a-z0-9-])(\d+)(?:\s*\/\s*(\d{2,4}))?(?=$|[^a-z0-9-])/g, (m, pre, n, ano) => {
    let a = ano ? +ano : null;
    if (a && a < 100) a += a > 50 ? 1900 : 2000;
    numeros.push({ n: +n, ano: a, re: new RegExp(`(^|[^0-9])${n}([^0-9]|$)`) });
    return pre + ' ';
  });
  resto = resto.replace(/\s+/g, ' ').trim();

  // Conceitos: sinônimos de temas encontrados na consulta (o ato atende se tiver o tema OU o texto)
  const conceitos = [];
  const temasCitados = new Set();
  let livre = ` ${resto} `;
  const candidatos = [];
  for (const t of TEMAS) for (const s of t.sin) candidatos.push({ s, t: t.id });
  candidatos.sort((a, b) => b.s.length - a.s.length);
  for (const { s } of candidatos) {
    if (s.length < 3 || !livre.includes(` ${s} `)) continue;
    const ids = candidatos.filter((c) => c.s === s).map((c) => c.t);
    ids.forEach((id) => temasCitados.add(id));
    conceitos.push({ texto: s, temas: ids, tokens: tokenizar(s) });
    livre = livre.replace(` ${s} `, ' ');
  }
  // Consulta curta contida em sinônimos (ex.: "faixa") ou variação de uma palavra deles (ex.: "desapropriações")
  if (!conceitos.length && resto.length >= 4 && !numeros.length) {
    const r = radical(resto);
    const inicioDePalavra = new RegExp(`(^| )${escaparRegex(resto.includes(' ') || r.length < 5 ? resto : r)}`);
    const ids = [...new Set(candidatos.filter((c) => inicioDePalavra.test(c.s)).map((c) => c.t))];
    if (ids.length && ids.length <= 3) {
      ids.forEach((id) => temasCitados.add(id));
      conceitos.push({ texto: resto, temas: ids, tokens: tokenizar(resto) });
      livre = '';
    }
  }
  for (const tk of tokenizar(livre)) conceitos.push({ texto: tk, temas: [], tokens: [tk] });
  // Siglas curtas (DUP, PPD, RCR) só casam com a palavra inteira — "dup" não pode achar "duplicação"
  const curtos = new Map();
  for (const t of conceitos.flatMap((c) => c.tokens)) if (t.length <= 3) curtos.set(t, new RegExp(`(^|[^a-z0-9])${escaparRegex(t)}([^a-z0-9]|$)`));
  const destacar = [...new Set([...conceitos.flatMap((c) => c.tokens), ...frases])];
  return { vazia: !conceitos.length && !frases.length && !numeros.length, conceitos, frases, numeros, temasCitados: [...temasCitados], destacar, curtos };
}

function tokenizar(s) {
  return s
    .split(/[^a-z0-9-]+/)
    .filter((t) => t && t.length >= 3 && !STOP.has(t))
    .map(radical);
}

function pontuar(a, c) {
  let score = 0;
  const contem = (txt, t) => (c.curtos.has(t) ? c.curtos.get(t).test(txt) : txt.includes(t));
  for (const cc of c.conceitos) {
    const texto = cc.tokens.length && cc.tokens.every((t) => contem(a._h, t));
    const tema = cc.temas.length && cc.temas.some((t) => a.temas.includes(t));
    if (!texto && !tema) return -1;
    if (texto) score += cc.tokens.every((t) => contem(a._ti, t)) ? 4 : 2;
    if (tema) score += texto ? 5 : 3;
  }
  for (const f of c.frases) {
    if (!a._h.includes(f)) return -1;
    score += 4;
  }
  for (const nm of c.numeros) {
    const exato = a.numero === nm.n && (!nm.ano || a.ano === nm.ano);
    if (exato) score += nm.ano ? 16 : 10;
    else if (nm.re.test(a._h) && (!nm.ano || a._h.includes(String(nm.ano)))) score += 2;
    else return -1;
  }
  if (a.destaque) score += 1.5;
  if (a._sit === 'vigente') score += 1;
  if (a._sit === 'revogado') score -= 1.5;
  if (/^(RES|INM|DLB|POR)$/.test(a.tipo)) score += 0.5;
  score += Math.max(0, (a.ano || 1995) - 1995) / 15;
  return score;
}

let cacheConsulta = { chave: null, lista: null, consulta: null };
function atosDaConsulta() {
  const chave = `${estado.q}|${estado.tema}`;
  if (cacheConsulta.chave === chave) return cacheConsulta;
  const c = analisarConsulta(estado.q);
  let lista;
  if (c.vazia) {
    lista = estado.tema ? ATOS.filter((a) => a.temas.includes(estado.tema)) : ATOS.slice();
    for (const a of lista) a._score = 0;
  } else {
    lista = [];
    for (const a of ATOS) {
      if (estado.tema && !a.temas.includes(estado.tema)) continue;
      const s = pontuar(a, c);
      if (s >= 0) { a._score = s; lista.push(a); }
    }
  }
  cacheConsulta = { chave, lista, consulta: c };
  return cacheConsulta;
}

function aplicar() {
  const { lista, consulta } = atosDaConsulta();
  const passaAbrangencia = (a, ignorarRodovias = false) =>
    (ignorarRodovias || !estado.rodovias || a._rod) &&
    (!estado.vigentes || a._sit !== 'revogado') &&
    (!estado.destaque || a.destaque) &&
    (!estado.categoria || a.destaque === estado.categoria);
  const f1 = lista.filter((a) => passaAbrangencia(a));
  const ocultosSetor = estado.rodovias ? lista.filter((a) => !a._rod && passaAbrangencia(a, true)).length : 0;
  const passaTipo = (a) => !estado.tipos.size || estado.tipos.has(a.tipoNome);
  const passaOrgao = (a) => !estado.orgao || a._org === estado.orgao;
  const passaPeriodo = (a) => (!estado.de || (a.ano || 0) >= estado.de) && (!estado.ate || (a.ano || 0) <= estado.ate);

  const paraAno = f1.filter((a) => passaTipo(a) && passaOrgao(a));
  const f2 = f1.filter(passaPeriodo);
  const paraTipo = f2.filter(passaOrgao);
  const paraOrgao = f2.filter(passaTipo);
  const final = f2.filter((a) => passaTipo(a) && passaOrgao(a));

  const ordem = estado.ordem === 'auto' ? (consulta.vazia ? 'recentes' : 'relevancia') : estado.ordem;
  const porData = (x, y) => (y._dt || '').localeCompare(x._dt || '') || (y.numero || 0) - (x.numero || 0);
  if (ordem === 'relevancia') final.sort((x, y) => y._score - x._score || porData(x, y));
  else if (ordem === 'recentes') final.sort(porData);
  else final.sort((x, y) => -porData(x, y));

  ultimo = { final, consulta };
  desenharTudo({ final, consulta, paraAno, paraTipo, paraOrgao, ocultosSetor, ordem });
  salvarUrl();
}

// ---------------------------------------------------------------- desenho
function desenharTudo(ctx) {
  desenharKpis(ctx.final);
  desenharTemas();
  desenharFacetas(ctx.paraTipo, ctx.paraOrgao);
  desenharGraficoAno(ctx.paraAno);
  desenharGraficoTipo(ctx.paraTipo);
  desenharCabecalho(ctx);
  desenharResultados(ctx.final, ctx.consulta);
}

function desenharKpis(final) {
  $('#k-total').textContent = compacto(ATOS.length);
  $('#k-total-d').textContent = META.atualizadoEm ? `atualizado em ${new Date(META.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  $('#k-res').textContent = compacto(final.length);
  $('#k-res-d').textContent = estado.q ? `para “${estado.q}”` : estado.tema ? TEMA_POR_ID.get(estado.tema)?.nome || '' : 'todos os atos filtrados';
  const vig = final.filter((a) => a._sit === 'vigente').length;
  $('#k-vig').textContent = compacto(vig);
  $('#k-vig-d').textContent = final.length ? `${Math.round((vig / final.length) * 100)}% dos resultados` : '';
  const limite = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const novos = final.filter((a) => (a.publicado || a.data || '') >= limite).length;
  $('#k-novos').textContent = compacto(novos);
  $('#k-novos-d').textContent = `desde ${dataBR(limite)}`;
}

function desenharTemas() {
  const el = $('#temas');
  if (!el.childElementCount) {
    el.innerHTML = TEMAS.map((t) => `<button type="button" class="tema" data-tema="${t.id}" title="${escapar(t.descricao)}"><span class="nome">${escapar(t.nome)}</span><span class="qtd" aria-label="${compacto(t.total || 0)} atos">${compacto(t.total || 0)}</span></button>`).join('') +
      `<button type="button" class="link-botao ver-temas" id="ver-temas">ver todos os ${TEMAS.length} temas</button>`;
  }
  for (const b of el.querySelectorAll('.tema')) b.setAttribute('aria-pressed', String(b.dataset.tema === estado.tema));
}

function desenharFacetas(paraTipo, paraOrgao) {
  const contTipo = contar(paraTipo, (a) => a.tipoNome);
  const tipos = [...new Set([...Object.keys(contTipo), ...estado.tipos])].sort((x, y) => (contTipo[y] || 0) - (contTipo[x] || 0) || x.localeCompare(y));
  const el = $('#f-tipos');
  const expandido = el.dataset.expandido === '1';
  const visiveis = expandido ? tipos : tipos.slice(0, 8);
  el.innerHTML =
    visiveis.map((t) => `<label class="opcao${contTipo[t] ? '' : ' zero'}"><input type="checkbox" value="${escapar(t)}" ${estado.tipos.has(t) ? 'checked' : ''}> ${escapar(t)}<span class="n">${compacto(contTipo[t] || 0)}</span></label>`).join('') +
    (tipos.length > 8 ? `<button type="button" class="link-botao" id="ver-tipos">${expandido ? 'ver menos' : `ver todos (${tipos.length})`}</button>` : '') +
    (!tipos.length ? '<div class="opcao zero">Nenhum</div>' : '');

  const contOrg = contar(paraOrgao, (a) => a._org);
  const sel = $('#f-orgao');
  const orgs = Object.entries(contOrg).sort((a, b) => b[1] - a[1]);
  if (estado.orgao && !contOrg[estado.orgao]) orgs.unshift([estado.orgao, 0]);
  sel.innerHTML = `<option value="">Todos</option>` + orgs.map(([o, n]) => `<option value="${escapar(o)}" ${o === estado.orgao ? 'selected' : ''}>${escapar(o)} (${compacto(n)})</option>`).join('');

  const cat = $('#f-categoria');
  if (cat.options.length <= 1) {
    const cats = [...new Set(ATOS.map((a) => a.destaque).filter(Boolean))].sort();
    cat.innerHTML = `<option value="">Todas</option>` + cats.map((c) => `<option value="${escapar(c)}">${escapar(c)}</option>`).join('');
  }
  cat.value = estado.categoria;
}

function contar(lista, fn) {
  const r = {};
  for (const a of lista) { const k = fn(a); if (k) r[k] = (r[k] || 0) + 1; }
  return r;
}

// ------ gráfico: atos por ano (colunas, série única)
function passoLimpo(max, partes = 4) {
  if (max <= 0) return 1;
  const bruto = max / partes;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function desenharGraficoAno(lista) {
  const fig = $('#g-ano');
  const area = $('.area', fig);
  const cont = contar(lista, (a) => a.ano);
  const anos = Object.keys(cont).map(Number).filter((a) => a > 1900).sort((a, b) => a - b);
  if (!anos.length) { area.innerHTML = '<div class="vazio-grafico">Sem dados para o gráfico</div>'; fig.classList.remove('com-selecao'); return; }
  const fim = Math.max(anos[anos.length - 1], estado.ate || 0);
  const ini = Math.max(anos[0], fim - 29);
  const antes = anos.filter((a) => a < ini).reduce((s, a) => s + cont[a], 0);
  $('#g-ano-sub').textContent = antes ? `${compacto(antes)} atos antes de ${ini} · clique para filtrar` : 'clique em uma barra para filtrar';
  const serie = [];
  for (let a = ini; a <= fim; a++) serie.push({ ano: a, n: cont[a] || 0 });

  const W = Math.max(280, area.clientWidth || 600);
  const H = 190;
  const m = { t: 10, r: 6, b: 22, l: 38 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(...serie.map((s) => s.n));
  const passo = passoLimpo(max);
  const topo = Math.max(passo, Math.ceil(max / passo) * passo);
  const y = (v) => m.t + ih - (v / topo) * ih;
  const banda = iw / serie.length;
  const bw = Math.min(24, Math.max(2, banda * 0.72));
  const cadaRotulo = Math.max(1, Math.ceil(serie.length / (iw / 38)));
  const selecao = estado.de && estado.de === estado.ate ? estado.de : null;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Atos por ano, de ${ini} a ${fim}">`;
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    const yy = Math.round(y(v)) + 0.5;
    svg += `<line class="${v === 0 ? 'base' : 'grade'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="eixo" x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${compacto(v)}</text>`;
  }
  serie.forEach((s, i) => {
    const cx = m.l + banda * i + banda / 2;
    const h = Math.max(0, y(0) - y(s.n));
    const x0 = cx - bw / 2;
    const r = Math.min(4, bw / 2, h);
    const yb = y(0);
    const path = h > 0
      ? `M${x0},${yb} V${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} H${x0 + bw - r} Q${x0 + bw},${yb - h} ${x0 + bw},${yb - h + r} V${yb} Z`
      : '';
    const cls = selecao === s.ano ? 'selecionado' : '';
    svg += `<g class="${cls}" data-ano="${s.ano}" data-n="${s.n}"><rect class="alvo" x="${m.l + banda * i}" y="${m.t}" width="${banda}" height="${ih}"/>${path ? `<path class="marca-dado" d="${path}"/>` : ''}</g>`;
    if (i % cadaRotulo === 0 || i === serie.length - 1) {
      svg += `<text class="eixo" x="${cx}" y="${H - 6}" text-anchor="middle">${s.ano}</text>`;
    }
  });
  svg += '</svg>';
  area.innerHTML = svg;
  fig.classList.toggle('com-selecao', !!selecao);
}

// ------ gráfico: por tipo (barras horizontais, série única)
function desenharGraficoTipo(lista) {
  const area = $('#g-tipo .area');
  const cont = Object.entries(contar(lista, (a) => a.tipoNome)).sort((a, b) => b[1] - a[1]);
  if (!cont.length) { area.innerHTML = '<div class="vazio-grafico">Sem dados para o gráfico</div>'; return; }
  let linhas = cont.slice(0, 7);
  const resto = cont.slice(7).reduce((s, [, n]) => s + n, 0);
  if (resto) linhas.push(['Outros', resto]);
  const max = Math.max(...linhas.map(([, n]) => n));
  const algumSel = estado.tipos.size > 0;
  area.innerHTML = `<div class="barras-h" role="list">${linhas
    .map(([t, n]) => {
      const sel = estado.tipos.has(t);
      const outros = t === 'Outros';
      return `<button type="button" role="listitem" class="barra-h${sel ? ' sel' : ''}${algumSel && !sel ? ' apagada' : ''}" ${outros ? 'disabled' : `data-tipo="${escapar(t)}"`} data-n="${n}" aria-label="${escapar(t)}: ${compacto(n)} atos">
        <span class="rot">${escapar(t)}</span>
        <span class="trilho"><span class="fill" style="width:${Math.max(1.5, (n / max) * 100)}%"></span></span>
        <span class="val">${compacto(n)}</span></button>`;
    })
    .join('')}</div>`;
}

function desenharCabecalho({ final, consulta, ocultosSetor, ordem }) {
  const partes = [];
  if (estado.q) partes.push(`para “${escapar(estado.q)}”`);
  $('#contagem').innerHTML = `${compacto(final.length)} ${final.length === 1 ? 'ato encontrado' : 'atos encontrados'} ${partes.join(' ')}`;
  $('#ordem').value = ordem;

  // aviso de temas incluídos
  const temasQ = consulta.temasCitados.filter((t) => t !== estado.tema).map((t) => TEMA_POR_ID.get(t)).filter(Boolean);
  const avisos = [];
  if (temasQ.length) {
    avisos.push(`<div class="aviso-tema">Incluindo o tema <strong>${temasQ.map((t) => escapar(t.nome)).join('</strong> e <strong>')}</strong>: atos em que ${temasQ.length > 1 ? 'esses assuntos aparecem' : 'o assunto aparece'} no texto integral do ANTTlegis ou na ementa (${escapar(temasQ.flatMap((t) => t.sinonimos || []).slice(0, 6).join(', '))}…).</div>`);
  }
  if (estado.tema) {
    const t = TEMA_POR_ID.get(estado.tema);
    avisos.push(`<div class="aviso-tema">Tema <strong>${escapar(t?.nome)}</strong> — ${escapar(t?.descricao || '')} <button class="link-botao" type="button" data-limpar="tema">remover tema</button></div>`);
  }
  $('#aviso-tema').innerHTML = avisos.join('');

  $('#aviso-setor').innerHTML = ocultosSetor
    ? `${compacto(ocultosSetor)} resultado(s) exclusivos de ferrovias, passageiros ou cargas estão ocultos. <button class="link-botao" type="button" id="mostrar-setores">Mostrar também</button>`
    : '';

  // filtros ativos
  const chips = [];
  if (estado.tema) chips.push(['tema', `Tema: ${TEMA_POR_ID.get(estado.tema)?.nome}`]);
  for (const t of estado.tipos) chips.push([`tipo:${t}`, t]);
  if (estado.orgao) chips.push(['orgao', `Órgão: ${estado.orgao}`]);
  if (estado.categoria) chips.push(['categoria', `gov.br: ${estado.categoria}`]);
  if (estado.de || estado.ate) chips.push(['periodo', estado.de === estado.ate ? `Ano: ${estado.de}` : `Período: ${estado.de || '…'}–${estado.ate || '…'}`]);
  if (estado.vigentes) chips.push(['vigentes', 'Sem revogados']);
  if (estado.destaque) chips.push(['destaque', 'Destaques gov.br']);
  $('#filtros-ativos').innerHTML = chips.map(([k, r]) => `<button type="button" class="filtro-ativo" data-limpar="${escapar(k)}" title="Remover filtro">${escapar(r)} <span aria-hidden="true">×</span></button>`).join('');
}

function destacar(texto, termos) {
  if (!texto) return '';
  if (!termos.length) return escapar(texto);
  // normaliza caractere a caractere para mapear as posições de volta ao texto original
  let norm = '';
  const mapa = [];
  for (let i = 0; i < texto.length; i++) {
    const c = normalizar(texto[i]);
    for (let j = 0; j < c.length; j++) { norm += c[j]; mapa.push(i); }
  }
  const re = new RegExp(
    termos.map((t) => (t.length <= 3 ? `\\b${escaparRegex(t)}\\b` : escaparRegex(t) + (/\s/.test(t) ? '' : '[a-z0-9]*'))).join('|'),
    'g'
  );
  const intervalos = [];
  let m;
  while ((m = re.exec(norm))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    intervalos.push([mapa[m.index], mapa[m.index + m[0].length - 1] + 1]);
  }
  if (!intervalos.length) return escapar(texto);
  let out = '';
  let pos = 0;
  for (const [a, b] of intervalos) {
    if (a < pos) continue;
    out += escapar(texto.slice(pos, a)) + '<mark>' + escapar(texto.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + escapar(texto.slice(pos));
}

function cartaoAto(a, termos, extra = '') {
  const sit = a.situacao ? `<span class="selo ${a._sit}"><span class="ponto" aria-hidden="true"></span>${escapar(a.situacao)}</span>` : '';
  const dest = a.destaque ? `<span class="selo destaque" title="Listado nas páginas de normativos de rodovias do gov.br">★ ${escapar(a.destaque)}</span>` : '';
  const setores = (a.setores || []).filter((s) => s !== 'G' && s !== 'R').map((s) => `<span class="selo">${SETORES[s]}</span>`).join('');
  const temas = (a.temas || []).map((t) => TEMA_POR_ID.get(t)).filter(Boolean).map((t) => `<button type="button" data-tema="${t.id}" title="Ver todos os atos do tema">${escapar(t.nome)}</button>`).join('');
  const url = urlDoAto(a);
  const meta = [a.tipo === 'GOV' ? a.orgao : a.orgao?.replace(/\/ANTT.*$/, ''), a.data ? `ato de ${dataBR(a.data)}` : a.ano, a.publicado && a.publicado !== a.data ? `publicado em ${dataBR(a.publicado)}` : ''].filter(Boolean).join(' · ');
  const origem = a.tipo === 'GOV' ? 'Abrir documento' : 'Abrir no ANTTlegis';
  return `<li class="ato" data-id="${escapar(a.id)}">
    <div class="linha1"><span class="selo tipo">${escapar(a.tipoNome || a.tipo)}</span>${sit}${dest}${setores}${extra}</div>
    <h3><a href="${escapar(url)}" target="_blank" rel="noopener">${destacar(a.titulo || a.id, termos)}</a></h3>
    <div class="meta">${escapar(meta)}</div>
    ${a.ementa ? `<p class="ementa">${destacar(a.ementa, termos)}</p>` : ''}
    ${a.nota ? `<p class="nota"><strong>gov.br:</strong> ${destacar(a.nota, termos)}</p>` : ''}
    <div class="rodape-ato">
      <div class="temas-ato">${temas}</div>
      <div class="acoes">
        <a href="${escapar(url)}" target="_blank" rel="noopener"><svg class="icone" aria-hidden="true"><use href="#i-externo"/></svg>${origem}</a>
        <button type="button" data-copiar="${escapar(a.id)}" title="Copiar referência com link"><svg class="icone" aria-hidden="true"><use href="#i-copiar"/></svg>Copiar</button>
      </div>
    </div>
  </li>`;
}

function desenharResultados(final, consulta) {
  const el = $('#resultados');
  if (!final.length) {
    el.innerHTML = `<li class="nada">Nenhum ato encontrado com esses critérios.<br>Tente outra palavra, remova filtros ou use <strong>Texto integral</strong> para pesquisar dentro do conteúdo completo dos atos no ANTTlegis.</li>`;
    $('#mais').hidden = true;
    return;
  }
  const termos = consulta.destacar;
  el.innerHTML = final.slice(0, estado.limite).map((a) => cartaoAto(a, termos)).join('');
  const faltam = final.length - estado.limite;
  $('#mais').hidden = faltam <= 0;
  $('#mais').textContent = `Mostrar mais ${compacto(Math.min(POR_PAGINA, faltam))} (de ${compacto(faltam)} restantes)`;
}

// ---------------------------------------------------------------- URL (links compartilháveis)
function salvarUrl() {
  const p = new URLSearchParams();
  if (estado.q) p.set('q', estado.q);
  if (estado.tema) p.set('tema', estado.tema);
  if (estado.tipos.size) p.set('tipo', [...estado.tipos].join('|'));
  if (estado.orgao) p.set('orgao', estado.orgao);
  if (estado.categoria) p.set('gov', estado.categoria);
  if (estado.de) p.set('de', estado.de);
  if (estado.ate) p.set('ate', estado.ate);
  if (!estado.rodovias) p.set('setores', 'todos');
  if (estado.vigentes) p.set('vigentes', '1');
  if (estado.destaque) p.set('destaques', '1');
  if (estado.ordem !== 'auto') p.set('ordem', estado.ordem);
  const s = p.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

function lerUrl() {
  const p = new URLSearchParams(location.search);
  estado.q = p.get('q') || '';
  estado.tema = p.get('tema') || '';
  estado.tipos = new Set((p.get('tipo') || '').split('|').filter(Boolean));
  estado.orgao = p.get('orgao') || '';
  estado.categoria = p.get('gov') || '';
  estado.de = +p.get('de') || null;
  estado.ate = +p.get('ate') || null;
  estado.rodovias = p.get('setores') !== 'todos';
  estado.vigentes = p.get('vigentes') === '1';
  estado.destaque = p.get('destaques') === '1';
  estado.ordem = p.get('ordem') || 'auto';
}

function sincronizarControles() {
  $('#q').value = estado.q;
  $('#f-rodovias').checked = estado.rodovias;
  $('#f-vigentes').checked = estado.vigentes;
  $('#f-destaque').checked = estado.destaque;
  $('#f-de').value = estado.de || '';
  $('#f-ate').value = estado.ate || '';
}

// ---------------------------------------------------------------- exportação
function exportarCsv() {
  const lista = ultimo.final;
  if (!lista.length) return toast('Não há resultados para exportar');
  const cab = ['Tipo', 'Número', 'Ano', 'Título', 'Ementa', 'Situação', 'Data do ato', 'Publicação', 'Órgão', 'Temas', 'Destaque gov.br', 'Link'];
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = lista.map((a) => [
    a.tipoNome, a.numero ?? '', a.ano ?? '', a.titulo, a.ementa, a.situacao, dataBR(a.data), dataBR(a.publicado), a.orgao,
    (a.temas || []).map((t) => TEMA_POR_ID.get(t)?.nome).filter(Boolean).join(', '), a.destaque || '', urlDoAto(a),
  ].map(cel).join(';'));
  const csv = '﻿' + [cab.map(cel).join(';'), ...linhas].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const nome = `normativos-antt-${normalizar(estado.q || estado.tema || 'consulta').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'consulta'}-${new Date().toISOString().slice(0, 10)}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${compacto(lista.length)} atos exportados`);
}

// ---------------------------------------------------------------- texto integral
async function textoIntegral() {
  const termo = estado.q.trim();
  const painel = $('#integral');
  if (!termo) { toast('Digite um termo na busca primeiro'); $('#q').focus(); return; }
  if (!modoServidor) {
    await copiar(termo);
    painel.hidden = false;
    painel.innerHTML = `<div class="integral"><h2>Pesquisar “${escapar(termo)}” no texto integral</h2>
      <p>A busca no conteúdo completo dos atos é feita no próprio ANTTlegis. O termo foi copiado — cole-o na Busca Livre que abriu em outra aba.
      Os <strong>temas</strong> deste painel já incluem resultados do texto integral, atualizados a cada coleta.
      Rodando o painel localmente (<code>npm start</code>), esta busca acontece aqui mesmo, ao vivo.</p>
      <a class="botao pequeno" href="${BUSCA_LIVRE}" target="_blank" rel="noopener"><svg class="icone"><use href="#i-externo"/></svg> Abrir Busca Livre do ANTTlegis</a>
      <button class="botao secundario pequeno" type="button" data-fechar-integral>Fechar</button></div>`;
    window.open(BUSCA_LIVRE, '_blank', 'noopener');
    return;
  }
  painel.hidden = false;
  painel.innerHTML = `<div class="integral"><div class="carregando"><div class="giro"></div>Pesquisando “${escapar(termo)}” no texto integral do ANTTlegis…</div></div>`;
  try {
    const r = await fetch(`api/texto-integral?q=${encodeURIComponent(termo)}`).then((x) => { if (!x.ok) throw new Error(`HTTP ${x.status}`); return x.json(); });
    const ids = new Set(ATOS.map((a) => a.id));
    const termos = analisarConsulta(termo).destacar;
    const itens = r.atos.map((o) => {
      const a = { ...o, temas: [], setores: [], _sit: classeSituacao(o.situacao) };
      const na = ATOS.find((x) => x.id === o.id);
      if (na) Object.assign(a, { temas: na.temas, destaque: na.destaque, nota: na.nota, tipoNome: na.tipoNome });
      a.tipoNome = a.tipoNome || o.tipoNome || o.tipo;
      return cartaoAto(a, termos, ids.has(o.id) ? '' : '<span class="selo">fora da base do painel</span>');
    });
    painel.innerHTML = `<div class="integral"><h2>Texto integral no ANTTlegis: ${compacto(r.total)} ato(s) com “${escapar(termo)}”</h2>
      <p>Resultado ao vivo da Busca Livre do ANTTlegis (inclui atos de todas as áreas${r.total > r.atos.length ? `; exibindo os ${compacto(r.atos.length)} mais relevantes` : ''}).
      <button class="link-botao" type="button" data-fechar-integral>fechar</button></p>
      <ol class="resultados">${itens.join('') || '<li class="nada">Nenhum resultado.</li>'}</ol></div>`;
  } catch (e) {
    painel.innerHTML = `<div class="integral"><h2>Não foi possível consultar o ANTTlegis agora</h2><p>${escapar(e.message)}. <a href="${BUSCA_LIVRE}" target="_blank" rel="noopener">Abrir a Busca Livre</a></p></div>`;
  }
}

// ---------------------------------------------------------------- eventos
function ligarEventos() {
  const executar = () => { estado.limite = POR_PAGINA; aplicar(); };
  const buscarDigitando = debounce(() => { estado.q = $('#q').value.trim(); $('#integral').hidden = true; executar(); }, 220);
  $('#q').addEventListener('input', buscarDigitando);
  $('#form-busca').addEventListener('submit', (e) => { e.preventDefault(); estado.q = $('#q').value.trim(); executar(); $('#principal').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#exemplos').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    estado.q = b.textContent.trim();
    $('#q').value = estado.q;
    executar();
  });
  $('#temas').addEventListener('click', (e) => {
    if (e.target.id === 'ver-temas') { $('#temas').classList.add('todos'); return; }
    const b = e.target.closest('[data-tema]');
    if (!b) return;
    estado.tema = estado.tema === b.dataset.tema ? '' : b.dataset.tema;
    executar();
  });
  $('#f-rodovias').addEventListener('change', (e) => { estado.rodovias = e.target.checked; executar(); });
  $('#f-vigentes').addEventListener('change', (e) => { estado.vigentes = e.target.checked; executar(); });
  $('#f-destaque').addEventListener('change', (e) => { estado.destaque = e.target.checked; executar(); });
  const periodo = debounce(() => { estado.de = +$('#f-de').value || null; estado.ate = +$('#f-ate').value || null; executar(); }, 400);
  $('#f-de').addEventListener('input', periodo);
  $('#f-ate').addEventListener('input', periodo);
  $('#f-tipos').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    e.target.checked ? estado.tipos.add(e.target.value) : estado.tipos.delete(e.target.value);
    executar();
  });
  $('#f-tipos').addEventListener('click', (e) => {
    if (e.target.id !== 'ver-tipos') return;
    const el = $('#f-tipos');
    el.dataset.expandido = el.dataset.expandido === '1' ? '0' : '1';
    aplicar();
  });
  $('#f-orgao').addEventListener('change', (e) => { estado.orgao = e.target.value; executar(); });
  $('#f-categoria').addEventListener('change', (e) => { estado.categoria = e.target.value; executar(); });
  $('#ordem').addEventListener('change', (e) => { estado.ordem = e.target.value; executar(); });
  $('#limpar').addEventListener('click', () => {
    Object.assign(estado, { q: '', tema: '', tipos: new Set(), orgao: '', categoria: '', de: null, ate: null, rodovias: true, vigentes: false, destaque: false, ordem: 'auto' });
    sincronizarControles();
    executar();
  });
  $('#mais').addEventListener('click', () => { estado.limite += POR_PAGINA; desenharResultados(ultimo.final, ultimo.consulta); });
  $('#exportar').addEventListener('click', exportarCsv);
  $('#integral-btn').addEventListener('click', textoIntegral);
  $('#abrir-filtros').addEventListener('click', (e) => {
    const f = $('#filtros');
    f.classList.toggle('aberto');
    e.currentTarget.setAttribute('aria-expanded', String(f.classList.contains('aberto')));
  });

  // cliques delegados (resultados, avisos, chips)
  document.addEventListener('click', async (e) => {
    const lim = e.target.closest('[data-limpar]');
    if (lim) {
      const k = lim.dataset.limpar;
      if (k === 'tema') estado.tema = '';
      else if (k.startsWith('tipo:')) estado.tipos.delete(k.slice(5));
      else if (k === 'orgao') estado.orgao = '';
      else if (k === 'categoria') estado.categoria = '';
      else if (k === 'periodo') { estado.de = null; estado.ate = null; }
      else if (k === 'vigentes') estado.vigentes = false;
      else if (k === 'destaque') estado.destaque = false;
      sincronizarControles();
      executar();
      return;
    }
    if (e.target.id === 'mostrar-setores') { estado.rodovias = false; sincronizarControles(); executar(); return; }
    if (e.target.closest('[data-fechar-integral]')) { $('#integral').hidden = true; return; }
    const tema = e.target.closest('.temas-ato [data-tema]');
    if (tema) { estado.tema = tema.dataset.tema; estado.q = ''; sincronizarControles(); executar(); window.scrollTo({ top: $('#temas').offsetTop - 10, behavior: 'smooth' }); return; }
    const cp = e.target.closest('[data-copiar]');
    if (cp) {
      const a = ATOS.find((x) => x.id === cp.dataset.copiar);
      if (a && (await copiar(`${a.titulo}${a.ementa ? ` — ${a.ementa}` : ''}\n${urlDoAto(a)}`))) toast('Referência copiada');
      return;
    }
    const barraAno = e.target.closest('#g-ano g[data-ano]');
    if (barraAno) {
      const ano = +barraAno.dataset.ano;
      if (estado.de === ano && estado.ate === ano) { estado.de = null; estado.ate = null; } else { estado.de = ano; estado.ate = ano; }
      sincronizarControles();
      executar();
      return;
    }
    const barraTipo = e.target.closest('#g-tipo [data-tipo]');
    if (barraTipo) {
      const t = barraTipo.dataset.tipo;
      estado.tipos.has(t) ? estado.tipos.delete(t) : estado.tipos.add(t);
      executar();
    }
  });

  // dicas (tooltips) dos gráficos
  const dica = $('#dica');
  document.addEventListener('pointermove', (e) => {
    const g = e.target.closest('#g-ano g[data-ano], #g-tipo [data-n]');
    if (!g) { dica.style.opacity = 0; return; }
    const n = +g.dataset.n;
    const rot = g.dataset.ano || g.dataset.tipo || 'Outros';
    dica.innerHTML = `${escapar(rot)}: <strong>${compacto(n)}</strong> ${n === 1 ? 'ato' : 'atos'}`;
    const w = dica.offsetWidth;
    dica.style.left = `${Math.min(window.innerWidth - w - 8, e.clientX + 12)}px`;
    dica.style.top = `${e.clientY - 38}px`;
    dica.style.opacity = 1;
  });

  window.addEventListener('resize', debounce(() => aplicar(), 200));

  $('#alternar-tema').addEventListener('click', () => {
    const atual = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const novo = atual === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem('tema-visual', novo); } catch {}
  });
}

function preencherSobre() {
  $('#lista-fontes').innerHTML = (META.fontes || []).map((f) => `<li><a href="${escapar(f.url)}" target="_blank" rel="noopener">${escapar(f.nome)}</a>${META.porFonte?.[f.id] ? ` — ${compacto(META.porFonte[f.id])} atos` : ''}</li>`).join('');
  const quando = META.atualizadoEm ? new Date(META.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '—';
  const completa = META.ultimaColetaCompleta ? new Date(META.ultimaColetaCompleta).toLocaleDateString('pt-BR') : '—';
  $('#info-atualizacao').innerHTML = `Última atualização: <strong>${quando}</strong> (modo ${escapar(META.modo || '')}). Última recoleta completa: ${completa}.`;
  $('#frase-atualizacao').textContent = META.atualizadoEm ? `atualizados em ${new Date(META.atualizadoEm).toLocaleDateString('pt-BR')}` : 'atualizados automaticamente';
  const dias = META.atualizadoEm ? (Date.now() - new Date(META.atualizadoEm)) / 864e5 : 0;
  const avisos = [];
  if (dias > 3) avisos.push(`A base não é atualizada há ${Math.floor(dias)} dias. Verifique a automação (GitHub Actions) ou rode <code>npm run coletar</code>.`);
  if (META.erros?.length) avisos.push(`A última coleta teve ${META.erros.length} falha(s) pontual(is); parte dos atos pode estar desatualizada até a próxima execução.`);
  $('#alerta-atualizacao').innerHTML = avisos.map((a) => `<div class="alerta">${a}</div>`).join('');
}

async function detectarServidor() {
  try {
    const r = await fetch('api/status', { cache: 'no-store' });
    modoServidor = r.ok && (await r.json()).ok === true;
  } catch {
    modoServidor = false;
  }
  if (modoServidor) $('#integral-btn').title = 'Pesquisar ao vivo no texto integral dos atos (ANTTlegis)';
}

async function iniciar() {
  lerUrl();
  sincronizarControles();
  ligarEventos();
  detectarServidor();
  try {
    await carregar();
  } catch (e) {
    $('#resultados').innerHTML = `<li class="nada">Não foi possível carregar a base de dados (${escapar(e.message)}).<br>Se abriu o arquivo direto do disco, rode <code>npm start</code> e acesse <a href="http://localhost:8080">http://localhost:8080</a>.</li>`;
    $('#contagem').textContent = 'Base indisponível';
    return;
  }
  preencherSobre();
  aplicar();
}

iniciar();
