#!/usr/bin/env node
// Servidor local do painel: serve a pasta site/ e oferece a busca ao vivo no texto integral do ANTTlegis.
// Uso: npm start   (ou: node scripts/servir.mjs --porta=8080)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarSessaoLegis, buscarTextoIntegral, TIPOS } from './lib/anttlegis.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PORTA = +((process.argv.find((a) => a.startsWith('--porta=')) || '').split('=')[1] || process.env.PORT || 8080);

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

// Cache simples para não repetir a mesma busca no ANTTlegis em sequência
const cache = new Map();
const TTL = 30 * 60 * 1000;

async function buscaIntegral(termo) {
  const chave = termo.toLowerCase();
  const c = cache.get(chave);
  if (c && Date.now() - c.quando < TTL) return c.dados;
  const sessao = criarSessaoLegis({ pausaMs: 150 });
  const exato = /\s/.test(termo.replace(/^"|"$/g, '').trim());
  const r = await buscarTextoIntegral(sessao, termo.replace(/"/g, ''), { exato, maxPaginas: 2, porPagina: 500 });
  const dados = { total: r.total, atos: r.atos.map((a) => ({ ...a, tipoNome: TIPOS[a.tipo] || a.tipo })) };
  cache.set(chave, { quando: Date.now(), dados });
  return dados;
}

function responderJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/status') return responderJSON(res, 200, { ok: true });
    if (url.pathname === '/api/texto-integral') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 3) return responderJSON(res, 400, { erro: 'Informe ao menos 3 caracteres.' });
      const t0 = Date.now();
      const dados = await buscaIntegral(q);
      console.log(`busca integral "${q}": ${dados.total} resultado(s) em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return responderJSON(res, 200, dados);
    }

    let arquivo = path.normalize(path.join(RAIZ, decodeURIComponent(url.pathname)));
    if (arquivo !== RAIZ && !arquivo.startsWith(RAIZ + path.sep)) { res.writeHead(403); return res.end('Proibido'); }
    if (fs.existsSync(arquivo) && fs.statSync(arquivo).isDirectory()) arquivo = path.join(arquivo, 'index.html');
    if (!fs.existsSync(arquivo)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS_MIME[path.extname(arquivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(arquivo).pipe(res);
  } catch (e) {
    console.error(e);
    responderJSON(res, 502, { erro: e.message });
  }
});

servidor.listen(PORTA, () => {
  console.log(`Painel de Normativos ANTT em http://localhost:${PORTA}`);
  console.log('Busca no texto integral ao vivo habilitada (botão "Texto integral"). Ctrl+C para encerrar.');
});
