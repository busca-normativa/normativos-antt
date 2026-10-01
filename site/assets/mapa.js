// Mapa das DUPs: desenha as poligonais (site/data/mapa.json) com Leaflet.
/* global L */

const $ = (s) => document.querySelector(s);
const NF = new Intl.NumberFormat('pt-BR');
const COR_DESTAQUE = '#2f80ff';
const COR_OUTRAS = '#ff8a1f';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

let DADOS = { itens: [], concessoes: [] };
let camadas = new Map(); // id -> polígonos Leaflet
let mapa;
let grupo;
let marcadores;

function iniciarMapa() {
  const ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; colaboradores do OpenStreetMap',
  });
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics',
  });
  mapa = L.map('mapa', { layers: [satelite], zoomControl: true }).setView([-10, -53], 5);
  L.control.layers({ 'Satélite': satelite, 'Mapa': ruas }, null, { position: 'topright' }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);
  grupo = L.featureGroup().addTo(mapa);
  marcadores = L.featureGroup().addTo(mapa);
  mapa.on('zoomend', ajustarMarcadores);
}

function popup(it) {
  const linhas = [
    ['Concessão', it.cc], ['Obra', it.ob], ['Rodovia', it.ro], ['Trecho', it.km], ['Município', it.mu],
    ['Área total', it.at], ['Processo', it.pr], ['DOU', dataBR(it.dou)], ['Fuso UTM', it.fu ? `${it.fu} S (SIRGAS 2000)${it.fa === 'nenhum' ? ' — deduzido pela UF (o anexo não informa o fuso)' : it.fa ? ` — corrigido: o anexo informa fuso ${it.fa}, incompatível com a UF` : ''}` : ''],
    ['Observação', it.dv ? `${it.dv} vértice(s) do anexo descartado(s) por inconsistência (ponto fora da sequência — confira no PDF)` : ''],
  ].filter(([, v]) => v);
  const numero = (it.ti.match(/N[º°]\s*([\d.]+)/) || [])[1] || '';
  return `<h3>${esc(it.ti)}</h3><dl>${linhas.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="links">
      <a href="${esc(it.u)}" target="_blank" rel="noopener">Abrir no ANTTlegis ↗</a>
      ${it.ax ? `<a href="${esc(it.ax)}" target="_blank" rel="noopener">Quadro de coordenadas (PDF) ↗</a>` : ''}
      <a href="./?q=${encodeURIComponent(`${numero} ${it.d ? it.d.slice(0, 4) : ''}`.trim())}&dups=1">Ver no painel</a>
    </div>`;
}

function filtrados() {
  const q = normalizar($('#m-busca').value).trim();
  const conc = $('#m-concessao').value;
  const ano = $('#m-ano').value;
  return DADOS.itens.filter((it) => {
    if (conc && it.cc !== conc) return false;
    if (ano && !(it.d || '').startsWith(ano)) return false;
    if (q && !normalizar([it.ti, it.ob, it.mu, it.km, it.ro, it.cc, it.pr].join(' ')).includes(q)) return false;
    return true;
  });
}

function pontoSobreADup(areas) {
  const pts = areas.flat();
  const c = L.latLngBounds(pts).getCenter();
  let melhor = pts[0];
  let menor = Infinity;
  for (const q of pts) {
    const d = (q[0] - c.lat) ** 2 + (q[1] - c.lng) ** 2;
    if (d < menor) { menor = d; melhor = q; }
  }
  return melhor;
}

// Marcadores só com o mapa afastado; aproximado, as próprias áreas já aparecem e os pontos só atrapalham
const ZOOM_SEM_MARCADORES = 14;
function ajustarMarcadores() {
  if (mapa.getZoom() >= ZOOM_SEM_MARCADORES) marcadores.remove();
  else if (!mapa.hasLayer(marcadores)) marcadores.addTo(mapa);
}

function desenhar(ajustar = true) {
  const lista = filtrados();
  grupo.clearLayers();
  marcadores.clearLayers();
  camadas = new Map();
  const destaque = new Set(DADOS.concessoes);
  for (const it of lista) {
    const cor = destaque.has(it.cc) ? COR_DESTAQUE : COR_OUTRAS;
    const polys = it.p.map((p) => L.polygon(p, { color: cor, weight: 3, fillColor: cor, fillOpacity: 0.3 }));
    const g = L.featureGroup(polys).bindPopup(popup(it), { maxWidth: 360 });
    g.on('click', () => marcarNaLista(it.i));
    g.addTo(grupo);
    camadas.set(it.i, g);
    // marcador para achar a DUP com o mapa afastado (as áreas são pequenas demais para aparecer). Fica SOBRE a
    // poligonal — no vértice mais próximo do centro da obra —, nunca no centro do retângulo, que numa obra longa
    // ou com áreas espalhadas cai fora da rodovia.
    const marcador = L.circleMarker(pontoSobreADup(it.p), { radius: 6, color: '#ffffff', weight: 2, fillColor: cor, fillOpacity: 1 });
    marcador.on('click', () => focar(it.i));
    marcador.addTo(marcadores);
  }
  $('#m-lista').innerHTML = lista
    .slice(0, 400)
    .map((it) => `<li><button type="button" data-id="${esc(it.i)}"><span class="t">${esc(it.ti)}</span><span class="o">${esc(it.ob || '')}</span><span class="m">${esc([it.cc, it.ro, it.km, it.mu].filter(Boolean).join(' · '))}</span></button></li>`)
    .join('') + (lista.length > 400 ? `<li class="mapa-sub">… e mais ${NF.format(lista.length - 400)} (refine a busca)</li>` : '');
  const areas = lista.reduce((s, it) => s + it.p.length, 0);
  $('#mapa-resumo').textContent = `${NF.format(lista.length)} DUP(s) no mapa · ${NF.format(areas)} área(s)`;
  if (ajustar && lista.length) mapa.fitBounds(grupo.getBounds(), { padding: [30, 30], maxZoom: 16 });
  ajustarMarcadores();
}

function marcarNaLista(id) {
  for (const b of document.querySelectorAll('#m-lista button')) b.setAttribute('aria-current', String(b.dataset.id === id));
  const b = document.querySelector(`#m-lista button[data-id="${CSS.escape(id)}"]`);
  b?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
}

function focar(id) {
  const g = camadas.get(id);
  if (!g) return;
  mapa.fitBounds(g.getBounds(), { padding: [40, 40], maxZoom: 17 });
  g.openPopup();
  marcarNaLista(id);
}

function preencherFiltros() {
  const cont = {};
  for (const it of DADOS.itens) cont[it.cc || 'Sem concessão identificada'] = (cont[it.cc || 'Sem concessão identificada'] || 0) + 1;
  const destaques = DADOS.concessoes.filter((c) => cont[c]);
  const outras = Object.entries(cont).filter(([c]) => !destaques.includes(c)).sort((a, b) => b[1] - a[1]);
  $('#m-concessao').innerHTML =
    `<option value="">Todas (${NF.format(DADOS.itens.length)})</option>` +
    destaques.map((c) => `<option value="${esc(c)}">★ ${esc(c)} (${NF.format(cont[c])})</option>`).join('') +
    outras.map(([c, n]) => `<option value="${esc(c === 'Sem concessão identificada' ? '' : c)}">${esc(c)} (${NF.format(n)})</option>`).join('');
  // começa pela concessão em destaque (ex.: Via Brasil), se houver DUPs dela no mapa
  if (destaques.length) $('#m-concessao').value = destaques[0];
  const anos = [...new Set(DADOS.itens.map((it) => (it.d || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  $('#m-ano').innerHTML = '<option value="">Todos</option>' + anos.map((a) => `<option>${a}</option>`).join('');
  $('#m-legenda').innerHTML = `<span><i style="background:${COR_DESTAQUE}"></i>${esc(DADOS.concessoes.join(', ') || 'Destaque')}</span><span><i style="background:${COR_OUTRAS}"></i>Outras concessões</span>`;
}

async function iniciar() {
  iniciarMapa();
  try {
    DADOS = await fetch('data/mapa.json', { cache: 'no-cache' }).then((r) => r.json());
  } catch (e) {
    $('#mapa-resumo').textContent = `Não foi possível carregar o mapa (${e.message}).`;
    return;
  }
  preencherFiltros();
  const alvo = decodeURIComponent(location.hash.slice(1));
  const itemAlvo = alvo && DADOS.itens.find((it) => it.i === alvo);
  if (itemAlvo) $('#m-concessao').value = itemAlvo.cc || '';
  desenhar(!itemAlvo);
  if (itemAlvo) focar(alvo);

  let t;
  $('#m-busca').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => desenhar(), 250); });
  $('#m-concessao').addEventListener('change', () => desenhar());
  $('#m-ano').addEventListener('change', () => desenhar());
  $('#m-lista').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) focar(b.dataset.id);
  });
}

iniciar();
