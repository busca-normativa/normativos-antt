// Poligonais das DUPs: lê o quadro de coordenadas (PDF anexo ou tabela no próprio ato), identifica o fuso UTM
// e converte os vértices (SIRGAS 2000) para latitude/longitude, para desenhar no mapa.

import { textoPuro } from './texto.mjs';

// ------------------------------------------------------------------ texto do PDF (pdfjs-dist, opcional)

let pdfjs = null;
export async function carregarPdfjs() {
  if (pdfjs) return pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs;
  } catch {
    return null;
  }
}

/** Texto do PDF organizado em linhas (itens agrupados pela altura na página). */
export async function linhasDoPdf(bytes) {
  const lib = await carregarPdfjs();
  if (!lib) throw new Error('pdfjs-dist não instalado (rode "npm install")');
  const tarefa = lib.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const doc = await tarefa.promise;
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const porY = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!porY.has(y)) porY.set(y, []);
      porY.get(y).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...porY.keys()].sort((a, b) => b - a)) {
      linhas.push(porY.get(y).sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
    }
  }
  await tarefa.destroy();
  return linhas;
}

/** Linhas de uma tabela HTML (quadro de coordenadas publicado no texto do ato). */
export function linhasDoHtml(html) {
  const i = html.search(/QUADRO DE COORDENADAS|ANEXO/i);
  const trecho = i >= 0 ? html.slice(i) : html;
  // cada linha da tabela vira uma linha de texto (as células ficam lado a lado)
  return trecho.split(/<\/tr>/i).map((l) => textoPuro(l.replace(/<\/t[dh]>/gi, ' '))).filter(Boolean);
}

// ------------------------------------------------------------------ interpretação do quadro

const NUMERO = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{6,7}(?:[.,]\d+)?/g;
function paraNumero(s) {
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  const grupos = s.split('.');
  if (grupos.length <= 2 && !/^\d{1,3}\.\d{3}$/.test(s)) return parseFloat(s); // "667967.29"
  // "9.250.990" (milhar) ou "665.131.241" / "8.693.235.904" (milhar com 3 decimais, tudo com ponto)
  const inteiro = +grupos.join('');
  return inteiro > 10000000 ? inteiro / 1000 : inteiro;
}
const ehE = (v) => v >= 150000 && v <= 850000;
const ehN = (v) => v > 1000000 && v <= 10000000;

export function interpretarQuadro(linhas) {
  const texto = linhas.join('\n');
  let fuso = null;
  const f = texto.match(/FUSO(?:\s*\(S\)|S)?\s*[:\-]?\s*(\d{2})/i) || texto.match(/zona\s*(?:UTM\s*)?(\d{2})/i);
  if (f) fuso = +f[1];
  const mc = texto.match(/(?:MC|Meridiano Central)\s*[:=]?\s*[-−]?\s*(\d{2})\s*°?\s*W?/i);
  if (!fuso && mc) fuso = Math.floor((180 - +mc[1]) / 6) + 1;
  const norte = /hemisf[ée]rio\s+norte/i.test(texto);

  const areas = [];
  let atual = [];
  for (const linha of linhas) {
    const nums = (linha.match(NUMERO) || []).map(paraNumero);
    // primeiro par plausível da linha, nas ordens (E, N) ou (N, E)
    let par = null;
    for (let k = 0; k + 1 < nums.length; k++) {
      const [x, y] = [nums[k], nums[k + 1]];
      if (ehE(x) && ehN(y)) { par = [x, y]; break; }
      if (ehN(x) && ehE(y)) { par = [y, x]; break; }
    }
    if (!par) continue;
    if (atual.length && Math.abs(atual[0][0] - par[0]) < 0.02 && Math.abs(atual[0][1] - par[1]) < 0.02 && atual.length >= 3) {
      atual.push(par);
      areas.push(atual);
      atual = [];
    } else {
      atual.push(par);
    }
  }
  if (atual.length >= 3) areas.push(atual);
  // nº do processo citado no anexo: serve para conferir se o anexo publicado é mesmo o deste ato
  const ref = texto.match(/Refer[êe]ncia\s*:?\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i);
  const referencia = ref ? ref[1] : null;
  const rodovias = [...new Set([...texto.matchAll(/BR[-‐–\s]*(\d{3})\s*\/\s*([A-Z]{2})\b/g)].map((m) => `BR-${m[1]}/${m[2]}`))];
  const total = texto.replace(/m\s*&sup2;|m²/gi, 'm2 ').match(/[ÁA]REA\s+TOTAL[^\d]{0,40}(?:m2\s*\)?\s*)?([\d.]+,\d+)/i);
  return { fuso, sul: !norte, areasUtm: areas, areaTotal: total ? total[1] + ' m²' : null, referencia, rodovias };
}

// ------------------------------------------------------------------ UTM (SIRGAS 2000 ≈ WGS84) -> lat/lon

export function utmParaLatLon(e, n, fuso, sul = true) {
  const a = 6378137;
  const f = 1 / 298.257222101; // GRS80 (SIRGAS 2000)
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = e - 500000;
  const y = sul ? n - 10000000 : n;
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = x / (n1 * k0);
  const lat =
    phi1 - ((n1 * Math.tan(phi1)) / r1) *
      (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon0 = ((fuso - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lon =
    lon0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) / Math.cos(phi1);
  return [+(lat * (180 / Math.PI)).toFixed(6), +(lon * (180 / Math.PI)).toFixed(6)];
}

// Retângulos aproximados das UFs [latMin, latMax, lonMin, lonMax], para conferir se a poligonal caiu no estado certo
const UF_BBOX = {
  AC: [-11.2, -7.1, -74.0, -66.6], AL: [-10.5, -8.8, -38.3, -35.1], AP: [-1.3, 4.5, -54.9, -49.8], AM: [-9.9, 2.3, -73.8, -56.1],
  BA: [-18.4, -8.5, -46.7, -37.3], CE: [-7.9, -2.7, -41.5, -37.2], DF: [-16.1, -15.5, -48.3, -47.3], ES: [-21.3, -17.8, -41.9, -39.6],
  GO: [-19.5, -12.4, -53.3, -45.9], MA: [-10.3, -1.0, -48.8, -41.8], MT: [-18.1, -7.3, -61.7, -50.2], MS: [-24.1, -17.1, -58.2, -50.9],
  MG: [-22.95, -14.2, -51.1, -39.8], PA: [-9.9, 2.6, -58.9, -46.0], PB: [-8.3, -6.0, -38.8, -34.8], PR: [-26.8, -22.5, -54.7, -48.0],
  PE: [-9.5, -7.3, -41.4, -34.8], PI: [-10.95, -2.7, -46.0, -40.4], RJ: [-23.4, -20.7, -44.9, -40.9], RN: [-7.0, -4.8, -38.6, -34.9],
  RS: [-33.8, -27.0, -57.7, -49.7], RO: [-13.7, -7.9, -66.9, -59.7], RR: [-1.6, 5.3, -64.9, -58.9], SC: [-29.4, -25.9, -53.9, -48.3],
  SP: [-25.4, -19.7, -53.2, -44.1], SE: [-11.6, -9.5, -38.3, -36.4], TO: [-13.5, -5.1, -50.8, -45.7],
};
function naUf([lat, lon], ufs) {
  return ufs.some((uf) => {
    const b = UF_BBOX[uf];
    return b && lat >= b[0] - 0.5 && lat <= b[1] + 0.5 && lon >= b[2] - 0.5 && lon <= b[3] + 0.5;
  });
}

/**
 * Converte o quadro em polígonos lat/lon. Com `ufs` (UFs da rodovia/município do ato), confere se a área caiu no
 * estado certo; se não, testa os outros fusos (erro comum de digitação no anexo) e usa o que acertar a UF.
 * Devolve { poligonos, fuso, fusoCorrigido }.
 */
export function poligonosValidados(q, ufs = []) {
  const conhecidas = ufs.filter((u) => UF_BBOX[u]);
  const tentar = (fuso) => poligonosLatLon({ ...q, fuso });
  const centro = (polys) => L_centro(polys.flat());
  let polys = tentar(q.fuso);
  if (!conhecidas.length || !polys.length || naUf(centro(polys), conhecidas)) return { poligonos: polys, fuso: q.fuso, fusoCorrigido: false };
  const candidatos = [];
  for (let f = 18; f <= 25; f++) {
    if (f === q.fuso) continue;
    const p = tentar(f);
    if (p.length && naUf(centro(p), conhecidas)) candidatos.push({ poligonos: p, fuso: f, fusoCorrigido: true });
  }
  // só corrige quando um único fuso coloca a área na UF certa; se houver dúvida, fica fora do mapa
  if (candidatos.length === 1) return candidatos[0];
  return { poligonos: [], fuso: q.fuso, fusoCorrigido: false, foraDaUf: true };
}

function L_centro(pts) {
  return [mediana(pts.map((x) => x[0])), mediana(pts.map((x) => x[1]))];
}

/** Converte o quadro interpretado em polígonos lat/lon; descarta resultados fora do Brasil. */
export function poligonosLatLon(q) {
  if (!q.fuso || !q.areasUtm.length) return [];
  const dentro = ([lat, lon]) => lat > -34.5 && lat < 5.5 && lon > -74.5 && lon < -28.5;
  const polys = q.areasUtm.map((pts) => semVerticesEspurios(pts.map(([e, n]) => utmParaLatLon(e, n, q.fuso, q.sul)).filter(dentro)));
  // uma área de DUP não passa de ~1° (≈110 km) de extensão; acima disso a leitura falhou
  const validos = polys.filter((p) => p.length >= 3 && extensao(p) <= 1.2);
  if (validos.length < 3) return validos;
  // áreas isoladas a mais de ~3° (≈330 km) do conjunto do ato também são erro de leitura (ex.: fuso trocado)
  const centros = validos.map((p) => [mediana(p.map((x) => x[0])), mediana(p.map((x) => x[1]))]);
  const c = [mediana(centros.map((x) => x[0])), mediana(centros.map((x) => x[1]))];
  return validos.filter((_, i) => Math.hypot(centros[i][0] - c[0], centros[i][1] - c[1]) <= 3);
}

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function extensao(p) {
  const la = p.map((x) => x[0]);
  const lo = p.map((x) => x[1]);
  return Math.max(Math.max(...la) - Math.min(...la), Math.max(...lo) - Math.min(...lo));
}

/** Remove vértices muito distantes do centro do polígono (ex.: número de outra coluna lido como coordenada). */
function semVerticesEspurios(p) {
  if (p.length < 4) return p;
  const c = [mediana(p.map((x) => x[0])), mediana(p.map((x) => x[1]))];
  const dist = p.map(([la, lo]) => Math.hypot(la - c[0], lo - c[1]));
  const limite = Math.max(0.05, 4 * mediana(dist)); // 0,05° ≈ 5,5 km
  return p.filter((_, i) => dist[i] <= limite);
}
