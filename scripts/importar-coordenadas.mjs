// Inclui no mapa uma DUP cujo quadro de coordenadas não foi publicado no ANTTlegis
// (o ato diz que as poligonais estão "descritas no Processo"): lê o PDF baixado do processo no SEI
// e grava só os vértices em config/coordenadas.json — o PDF em si (assinado, com dados do responsável
// técnico) não vai para o repositório.
//
//   node scripts/importar-coordenadas.mjs "<quadro de coordenadas.pdf>" DCS-457-2025
//
// A DUP pode ser indicada pelo código completo (DCS-457-2025-SUROD.ANTT.MT-000, o que aparece no
// endereço do mapa) ou só pelo começo (DCS-457-2025). Depois, rode a coleta (ou espere a do dia).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarPdfjs, linhasDoPdf, interpretarQuadro, poligonosLatLon } from './lib/poligonais.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQ = path.join(RAIZ, 'config', 'coordenadas.json');
const [arquivo, dup] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const origem = (process.argv.find((a) => a.startsWith('--origem=')) || '').slice(9);

function sair(msg) {
  console.error(msg);
  process.exit(1);
}

if (!arquivo || !dup) sair('Uso: node scripts/importar-coordenadas.mjs "<quadro de coordenadas.pdf>" <DUP, ex.: DCS-457-2025> [--origem="Processo SEI ..."]');
if (!fs.existsSync(arquivo)) sair(`Arquivo não encontrado: ${arquivo}`);

// confere o código da DUP com as já conhecidas pela coleta
const conhecidas = Object.keys(JSON.parse(fs.readFileSync(path.join(RAIZ, 'site', 'data', 'poligonais.json'), 'utf8')).itens || {});
const codigo = dup.trim().toUpperCase();
const achadas = conhecidas.filter((id) => id === codigo || id.startsWith(`${codigo}-`));
if (achadas.length !== 1) {
  sair(achadas.length ? `Mais de uma DUP começa com ${codigo}: ${achadas.join(', ')} — use o código completo.` : `Nenhuma DUP conhecida com o código ${codigo}.`);
}
const id = achadas[0];

if (!(await carregarPdfjs())) sair('pdfjs-dist não instalado: rode npm install.');
const q = interpretarQuadro(await linhasDoPdf(new Uint8Array(fs.readFileSync(arquivo))));
if (!q.areasUtm.length) sair('Não encontrei vértices (coordenadas E/N) nesse PDF.');
if (!q.fuso) console.warn('Aviso: o quadro não informa o fuso; a coleta vai deduzi-lo pela UF do ato.');

const dados = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8')) : {};
dados._leia =
  'Quadros de coordenadas de DUPs que não foram publicados no ANTTlegis (ex.: "poligonais descritas no Processo"). ' +
  'Inclua com: node scripts/importar-coordenadas.mjs "<quadro.pdf>" <DUP>. Só os vértices ficam aqui; a coleta converte e valida como os demais.';
dados.itens = dados.itens || {};
dados.itens[id] = {
  origem: origem || 'Quadro de coordenadas do processo no SEI',
  arquivo: path.basename(arquivo),
  incluidoEm: new Date().toISOString().slice(0, 10),
  fuso: q.fuso,
  sul: q.sul,
  areaTotal: q.areaTotal,
  areas: q.areasUtm.map((pts) => pts.map(([e, n]) => [+e.toFixed(3), +n.toFixed(3)])),
};
// um vértice [E, N] por linha, para o arquivo ficar fácil de conferir
fs.writeFileSync(ARQ, JSON.stringify(dados, null, 1).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n');

const ll = poligonosLatLon(q);
console.log(`${id}: ${q.areasUtm.length} área(s), ${q.areasUtm.reduce((s, a) => s + a.length, 0)} vértices, fuso ${q.fuso || '?'}, área total ${q.areaTotal || '?'}`);
if (ll.length) console.log(`Primeiro vértice: ${ll[0][0].join(', ')} (lat, lon) — confira no mapa após a coleta.`);
console.log(`Gravado em config/coordenadas.json`);
