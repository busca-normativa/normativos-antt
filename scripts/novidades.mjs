#!/usr/bin/env node
// Compara a base recém-coletada com a última versão gravada no Git e gera um resumo (Markdown) dos atos NOVOS
// das concessões listadas em config/alertas.json. A automação transforma esse resumo num aviso (issue) do GitHub.
//
// Uso: node scripts/novidades.mjs --saida=novidades.md
// Sai sem gerar arquivo quando não há novidades.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = (process.argv.find((a) => a.startsWith('--saida=')) || '--saida=novidades.md').split('=')[1];
const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'alertas.json'), 'utf8'));
if (!cfg.concessoes?.length) process.exit(0);

const atual = JSON.parse(fs.readFileSync(path.join(RAIZ, 'site', 'data', 'atos.json'), 'utf8'));
let anterior = [];
const arqAnterior = (process.argv.find((a) => a.startsWith('--anterior=')) || '').split('=')[1];
if (arqAnterior) anterior = JSON.parse(fs.readFileSync(arqAnterior, 'utf8'));
else try {
  // "safe.directory" permite rodar também em pastas de rede
  const txt = execFileSync('git', ['-c', 'safe.directory=*', 'show', 'HEAD:site/data/atos.json'], { cwd: RAIZ, maxBuffer: 1 << 30, encoding: 'utf8' });
  anterior = JSON.parse(txt);
} catch {
  console.log('Sem versão anterior no Git; nada a comparar.');
  process.exit(0);
}
const idsAntes = new Set(anterior.map((o) => o.i));
const alvo = new Set(cfg.concessoes);
const novos = atual.filter((o) => !idsAntes.has(o.i) && alvo.has(o.cc));
if (!novos.length) {
  console.log('Nenhuma novidade das concessões acompanhadas.');
  process.exit(0);
}

const LEGIS = 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php';
const link = (o) => o.u || `${LEGIS}?acao=abrirTextoAto&link=S&tipo=${o.t}&numeroAto=${String(o.n).padStart(8, '0')}&seqAto=${o.q || '000'}&valorAno=${o.a}&orgao=${o.o}&cod_modulo=161&cod_menu=5408`;
const repo = process.env.GITHUB_REPOSITORY || '';
const painel = repo ? `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/` : '';
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

function resumoFicha(o) {
  const f = o.dp || o.fa;
  if (!f) return '';
  const partes = [
    o.dp ? `**DUP** — ${f.obra || ''}` : `**${/interesse de terceiro/i.test(o.e) ? 'PIT' : 'Uso da faixa'}** — ${[f.interessado, f.objeto].filter(Boolean).join(': ')}`,
    [(f.rodovias || []).join(', '), (f.kms || []).join('; ')].filter(Boolean).join(' '),
    (f.municipios || []).join(', '),
    f.processo ? `processo ${f.processo}` : '',
  ].filter(Boolean);
  return `\n  ${partes.join(' · ')}`;
}

const porConcessao = new Map();
for (const o of novos.sort((a, b) => (b.d || b.p || '').localeCompare(a.d || a.p || ''))) {
  if (!porConcessao.has(o.cc)) porConcessao.set(o.cc, []);
  porConcessao.get(o.cc).push(o);
}

const linhas = [];
const mencoes = (cfg.mencionar || []).map((u) => `@${u}`).join(' ');
linhas.push(`${novos.length} novo(s) ato(s) das concessões acompanhadas na atualização de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. ${mencoes}`.trim());
for (const [conc, lista] of porConcessao) {
  const dups = lista.filter((o) => o.dp).length;
  const faixa = lista.filter((o) => o.fa).length;
  linhas.push('', `### ${conc} — ${lista.length} novo(s)${dups ? ` · ${dups} DUP` : ''}${faixa ? ` · ${faixa} uso da faixa` : ''}`);
  if (painel) linhas.push(`[Ver no painel](${painel}?concessao=${encodeURIComponent(conc)})`, '');
  for (const o of lista.slice(0, cfg.maxItens || 60)) {
    linhas.push(`- [${o.ti}](${link(o)}) — ${o.tn}${o.d ? `, ${dataBR(o.d)}` : ''}  \n  ${o.e || ''}${resumoFicha(o)}`);
  }
  if (lista.length > (cfg.maxItens || 60)) linhas.push(`- … e mais ${lista.length - cfg.maxItens} no painel.`);
}
linhas.push('', '_Aviso gerado automaticamente pela atualização diária. Para mudar as concessões acompanhadas ou quem é avisado, edite `config/alertas.json`._');

fs.writeFileSync(path.resolve(RAIZ, saida), linhas.join('\n') + '\n');
fs.writeFileSync(path.resolve(RAIZ, saida + '.titulo'), `Novidades: ${[...porConcessao.keys()].join(', ')} — ${novos.length} novo(s) em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
console.log(`${novos.length} novidade(s) gravada(s) em ${saida}`);
