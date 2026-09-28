// Classificação automática: setor, atos de pessoal e temas por palavras.

import { normalizar } from './texto.mjs';
import { TIPOS, TIPOS_ADMINISTRATIVOS } from './anttlegis.mjs';

// Concessionárias e trechos de rodovias federais citados nas ementas
const CONCESSIONARIAS = [
  'autopista', 'ecovias', 'ecorodovias', 'ecoponte', 'ecosul', 'eco ?101', 'eco ?050', 'ecoriominas', 'arteris', 'motiva', 'concebra', 'concer',
  'via ?040', 'via ?bahia', 'viabahia', 'msvia', 'rota do oeste', 'nova rota', 'rodovia do aco', 'riosp', 'rio ?sp', 'nova dutra', 'transbrasiliana',
  'triunfo', 'litoral sul', 'fernao dias', 'regis bittencourt', 'planalto sul', 'fluminense', 'viasul', 'via sul', 'viacosteira', 'via costeira',
  'via araucaria', 'via brasil', 'via cristais', 'via mineira', 'epr ', 'pr vias', 'rota verde', 'rota sertaneja', 'rota agro', 'way[- ]?262',
  'nova 364', 'nova 381', 'elovias', 'litoral pioneiro', 'ponte rio', 'crt', 'rodosol', 'ecocataratas', 'caminhos do parana', 'cro\\b', 'viarondon',
];

const RE_RODOVIA = new RegExp(
  [
    'rodovi', '\\bbr[- ]?\\d{3}', 'pedagio', 'faixa de dominio', 'fins rodoviarios', 'programa de exploracao da rodovia', '\\bper\\b',
    'parada e descanso', 'concessionaria', 'concessao rodoviaria', 'concessoes rodoviarias', ...CONCESSIONARIAS,
  ].join('|')
);
const RE_FERROVIA = /ferrovi|\btrem\b|\btrens\b|vag(ao|oes)|locomotiv|malha (paulista|sul|oeste|norte)|\bmrs\b|\bvli\b|\brumo\b|ferroeste|ferronorte|transnordestina/;
const RE_PASSAGEIROS = /passageir|onibus|fretament|\btrip\b|servico regular|bilhete|gratuidade|mercado de transporte rodoviario/;
const RE_CARGAS = /\bcargas?\b|rntrc|\bfrete|\bciot\b|produtos perigosos|transportador(es)? rodoviario|\btrc\b|vale[- ]pedagio|\botm\b|multimodal/;

// Serviços de transporte (passageiros/cargas) citam "rodoviário" sem tratar de infraestrutura rodoviária
const RE_SERVICO_TRANSPORTE = /transporte rodoviario( \w+){0,4} de (passageiros|cargas)|transporte rodoviario (coletivo|interestadual|internacional|remunerado)|terminais? rodoviari/g;

const ORGAO_SETOR = [
  [/^(SUROD|SUINF|SUEXE|SUCON|SUREG)\//, 'R'],
  [/^SUFER\//, 'F'],
  [/^(SUPAS|SUESP)\//, 'P'],
  [/^(SUROC|SUCAR)\//, 'C'],
];

/** Setores: R rodovias, F ferrovias, P passageiros, C cargas, G geral/institucional. */
export function setoresDoAto(ato) {
  const s = new Set();
  for (const [re, set] of ORGAO_SETOR) if (re.test(ato.orgao || '')) s.add(set);
  const txt = normalizar(`${ato.titulo} ${ato.ementa}`);
  const semServico = txt.replace(RE_SERVICO_TRANSPORTE, ' ');
  if (RE_RODOVIA.test(semServico)) s.add('R');
  if (RE_FERROVIA.test(txt)) s.add('F');
  if (RE_PASSAGEIROS.test(txt)) s.add('P');
  if (RE_CARGAS.test(txt)) s.add('C');
  // "concessionária" sozinha em ato ferroviário não indica rodovia
  if (s.has('F') && !/rodovi|\bbr[- ]?\d{3}|pedagio/.test(semServico) && !/^(SUROD|SUINF)\//.test(ato.orgao || '')) s.delete('R');
  if (!s.size) s.add('G');
  return [...s].sort();
}

const RE_PESSOAL = /^(nomea?r?|exonera|designa|dispensa|remove|cede|requisita|lota|redistribui|aposenta|concede (aposentadoria|pensao|licenca|horario|abono|afastamento)|autoriza (o|a) (servidor|afastamento|teletrabalho)|torna sem efeito a (nomeacao|designacao|exoneracao|portaria n. ?\d+.{0,40}(nomea|designa|exonera))|declara vago|reconduz|prorroga (o )?afastamento|convoca (os )?candidat|homologa (o )?resultado (do|de) concurso|altera a lotacao)/;

export function ehAtoDePessoal(ato) {
  const e = normalizar(ato.ementa).trim();
  if (RE_PESSOAL.test(e)) return true;
  return /\b(cargo comissionado|funcao comissionada|substituto eventual|cct ?[ivx]+|ca ?[ivx]+|das ?\d|fcpe|teletrabalho|progressao funcional|promocao funcional|estagio probatorio|horario especial)\b/.test(e) && /servidor|nomea|designa|exonera|dispensa/.test(e);
}

// Nome do tipo pelo início do título (mais confiável que o código do ANTTlegis, que tem variantes como PT7, VTV)
const TIPO_PELO_TITULO = [
  [/^voto vista/, 'Voto Vista'], [/^voto/, 'Voto'], [/^declaracao de voto/, 'Declaração de Voto'],
  [/^portaria conjunta/, 'Portaria Conjunta'], [/^portaria complementar/, 'Portaria Complementar'], [/^portaria/, 'Portaria'],
  [/^resolucao/, 'Resolução'], [/^deliberacao/, 'Deliberação'], [/^instrucao normativa conjunta/, 'Instrução Normativa Conjunta'],
  [/^instrucao normativa/, 'Instrução Normativa'], [/^instrucao de servico/, 'Instrução de Serviço'], [/^decisao/, 'Decisão'],
  [/^sumula/, 'Súmula'], [/^apostila/, 'Apostila'], [/^comunicado/, 'Comunicado'], [/^aviso/, 'Aviso'], [/^nota tecnica/, 'Nota Técnica'],
  [/^audiencia publica/, 'Audiência Pública'], [/^consulta publica/, 'Consulta Pública'], [/^tomada de subsidio/, 'Tomada de Subsídio'],
  [/^reuniao participativa/, 'Reunião Participativa'], [/^lei /, 'Lei'], [/^decreto/, 'Decreto'], [/^medida provisoria/, 'Medida Provisória'],
];

export function nomeDoTipo(ato) {
  const t = normalizar(ato.titulo).trim();
  for (const [re, nome] of TIPO_PELO_TITULO) if (re.test(t)) return nome;
  if (TIPOS[ato.tipo]) return TIPOS[ato.tipo];
  return ato.tipo;
}

/** Atos administrativos internos (pessoal, compras, contratos da própria ANTT) não interessam ao painel. */
export function ehAdministrativo(ato) {
  return TIPOS_ADMINISTRATIVOS.has(ato.tipo) || /^portaria de pessoal/.test(normalizar(ato.titulo).trim());
}

/** Compila os temas (config/temas.json) em expressões regulares. */
export function compilarTemas(temas) {
  return temas.map((t) => ({ ...t, re: new RegExp(t.palavras.join('|')) }));
}

export function temasPorPalavras(ato, temasCompilados) {
  const txt = normalizar(`${ato.titulo} ${ato.ementa} ${ato.nota || ''}`);
  return temasCompilados.filter((t) => t.re.test(txt)).map((t) => t.id);
}
