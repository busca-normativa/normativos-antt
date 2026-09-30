// Fichas extraídas do texto integral dos atos no ANTTlegis:
//  - DUP (Declaração de Utilidade Pública): concessionária, obra, rodovia, km, município, processo, urgência, DOU
//  - Uso da faixa de domínio (PIT, ocupações, acessos, travessias): interessado, objeto, tipo de uso, rodovia, km,
//    município, concessionária, processo, CPEU, DOU

import { textoPuro, normalizar, dataBR } from './texto.mjs';
import { urlAto } from './anttlegis.mjs';

// ------------------------------------------------------------------ classificação pela ementa

export function ehDup(ato) {
  if (/^(voto|audiencia|consulta|tomada|reuniao)/.test(normalizar(ato.titulo).trim())) return false;
  const e = normalizar(ato.ementa);
  // "Declara (de/a) utilidade pública...", "Encaminha proposta de declaração de utilidade pública...", retificações e revogações de DUP
  return /\b(declara|declarar|encaminha|encaminhar|retifica|revoga|altera)\b[^.]{0,120}utilidade publica/.test(e) && !/requerimento de dup|procedimentos/.test(e);
}

// Autorizações de uso da faixa: PIT, ocupações longitudinais/transversais, acessos, travessias, redes
export function ehUsoDaFaixa(ato) {
  if (ehDup(ato)) return false;
  if (/^(SUFER|SUCAR|SUPAS|SUROC)\//.test(ato.orgao || '')) return false;
  if (/^(voto|audiencia|consulta|tomada|reuniao)/.test(normalizar(ato.titulo).trim())) return false;
  const e = normalizar(ato.ementa);
  if (!/\b(autoriza|autorizar|aprova|aprovar|revoga|prorroga|retifica)\b/.test(e)) return false;
  return /interesse de terceiro|\bpit\b|ocupac(ao|oes) (longitudinal|transversal|da faixa)|faixa de dominio|\bacessos?\b|travessia|passagem (inferior|superior|de gado)|\bredes? (de|eletrica)|\bdutos?\b|gasoduto|adutora|fibra optica/.test(e);
}

// Tipo de uso da faixa (para filtro no painel)
const TIPOS_DE_USO = [
  ['Acesso', /\bacessos?\b|entroncamento|intersec/],
  ['Rede elétrica', /energia eletrica|rede eletrica|linha de transmissao|linha de distribuicao|\bkv\b|subestacao|posteamento/],
  ['Fibra óptica / telecom', /fibra|optic|telecomunica|telefon|cabo de dados|\btelecom/],
  ['Água / esgoto', /\bagua\b|adutora|esgoto|saneamento|abastecimento|drenagem pluvial|emissario/],
  ['Gás / dutos', /\bgas\b|gasoduto|oleoduto|\bdutos?\b|poliduto/],
  ['Travessia / passagem', /travessia|passagem (inferior|superior|de gado)|passarela|viaduto|ponte/],
  ['Publicidade', /publicidad|publicitari|outdoor|painel/],
  ['Equipamentos e dispositivos', /dispositivo|equipamento|monitoramento|radar|camera|torre/],
];
export function tipoDeUso(texto) {
  const t = normalizar(texto);
  const achados = TIPOS_DE_USO.filter(([, re]) => re.test(t)).map(([nome]) => nome);
  return achados.length ? achados : ['Outros'];
}

// ------------------------------------------------------------------ extratores comuns

const UF = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
  goias: 'GO', maranhao: 'MA', 'mato grosso do sul': 'MS', 'mato grosso': 'MT', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB',
  parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
  rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

function unicos(lista) {
  return [...new Set(lista.map((s) => s.trim()).filter(Boolean))];
}

// "1.119+050", "308+200", "855" (com ou sem metros)
const KM = String.raw`\d{1,4}(?:\.\d{3})?(?:\s*\+\s*\d{1,3}(?:,\d+)?)?`;
const KM_COM_MAIS = String.raw`\d{1,4}(?:\.\d{3})?\s*\+\s*\d{1,3}(?:,\d+)?`;
const RE_KM = new RegExp(String.raw`kms?\s*(${KM})\s*m?(?:\s*(?:ao|a|até|e)\s*(?:o\s*)?(?:kms?\s*)?(${KM_COM_MAIS}))?`, 'gi');
const SUFIXO_EMPRESA = String.raw`(?:S\.?\s?\/\s?A\.?|S\.A\.?|S\.?A\b|Ltda\.?|LTDA)`;

function extrairLocal(t, ficha) {
  const proc = t.match(/Processo\s+(?:SEI\s+)?n\.?[º°o]?\.?\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i);
  if (proc) ficha.processo = proc[1];

  ficha.rodovias = unicos([...t.matchAll(/BR[-‐–\s]*(\d{3})\s*\/\s*([A-Z]{2})\b/g)].map((m) => `BR-${m[1]}/${m[2]}`));

  const kms = [];
  for (const m of t.matchAll(RE_KM)) {
    const ini = m[1].replace(/\s/g, '');
    kms.push(m[2] ? `km ${ini} a ${m[2].replace(/\s/g, '')}` : `km ${ini}`);
  }
  ficha.kms = unicos(kms).slice(0, 12);

  const muni = [];
  for (const m of t.matchAll(/munic[íi]pios?\s+de\s+([A-ZÀ-Ú][^.;:()]{1,160}?\/[A-Z]{2})(?=[\s,.;)]|$)/g)) {
    for (const parte of m[1].split(/,\s*|\s+e\s+/)) {
      if (/[A-Za-zÀ-ú]/.test(parte)) muni.push(parte.includes('/') ? parte : `${parte}/${m[1].slice(-2)}`);
    }
  }
  // "em Mandirituba/PR"
  for (const m of t.matchAll(/\bem\s+([A-ZÀ-Ú][A-Za-zÀ-ú' -]{2,40}?\/[A-Z]{2})\b/g)) muni.push(m[1]);
  // modelo antigo: "município de Hidrolândia, no estado de Goiás"
  for (const m of t.matchAll(/munic[íi]pio\s+de\s+([A-ZÀ-Ú][^,.;:()]{1,60}?),\s*(?:no\s+)?estado\s+d[eoa]s?\s+([A-ZÀ-Úa-zà-ú ]{4,25}?)(?=[\s,.;]|$)/g)) {
    const uf = UF[normalizar(m[2]).trim()];
    if (uf) muni.push(`${m[1].trim()}/${uf}`);
  }
  ficha.municipios = unicos(muni.filter((m) => !/^BR\b/.test(m))).slice(0, 12);

  const via = t.match(/Rodovia\s+([A-ZÀ-Ú][A-Za-zÀ-ú ]{3,40}?),\s*BR/);
  if (via) ficha.rodoviaNome = via[1].trim();
}

/** Concessão citada no texto: a que aparece primeiro entre as de config/concessoes.json. */
function concessaoNoTexto(t, concessoes) {
  if (!concessoes?.length) return null;
  const n = normalizar(t);
  let melhor = null;
  for (const c of concessoes) {
    const m = n.match(c.re);
    if (m && (melhor === null || m.index < melhor.pos)) melhor = { pos: m.index, nome: c.nome };
  }
  return melhor?.nome || null;
}

// ------------------------------------------------------------------ DUP

export function extrairFichaDup(texto, concessoes) {
  const t = texto.replace(/\s+/g, ' ');
  const ficha = {};
  const conc =
    t.match(/(?:Fica|Autorizar|Autoriza|autorizada?)\s+(?:a\s+)?(?:empresa\s+|concession[áa]ria\s+)?([A-ZÀ-Ú][^,;:]{3,120}?(?:S\.?\s?\/?A\.?|Ltda\.?|Concession[áa]ria[^,;]{0,60}))(?=[\s,.;])/) ||
    t.match(/administrad[ao] pela\s+([^,;]{3,120}?(?:S\.?\s?\/?A\.?|Ltda\.?))/i) ||
    t.match(/em favor d[ao]\s+(?!Uni[ãa]o)([^,;]{3,120}?(?:S\.?\s?\/?A\.?|Ltda\.?))/i);
  if (conc) {
    ficha.concessionaria = conc[1].replace(/\s+/g, ' ').replace(/\s+(autorizad|fica\b|inscrit|detentor|a promover).*$/i, '').replace(/\.$/, '').trim();
  }
  extrairLocal(t, ficha);
  const obra =
    t.match(/necess[áa]ri[oa]s?\s+(?:[àa]s?\s+)?(?:execu[çc][ãa]o\s+d[aoe]s?\s+|implanta[çc][ãa]o\s+d[aoe]s?\s+)?obras?\s+(?:de\s+|do\s+|da\s+|das\s+|dos\s+)?(?:de\s+)?(.{5,160}?)(?=,\s*(?:localizad|na\s+BR|no\s+km|BR-|no\s+munic|conforme)|\s+na\s+BR|\s+no\s+km|\s+nos?\s+kms?|\.\s)/i) ||
    t.match(/obras?\s+de\s+(.{5,120}?)(?=,|\s+na\s+BR|\s+no\s+km|\.)/i);
  if (obra) ficha.obra = obra[1].replace(/\s+/g, ' ').trim();
  ficha.urgencia = /carater\s+de\s+urgencia/.test(normalizar(t));
  const area = t.match(/([\d.]+,\d+)\s*m[²2]/);
  if (area) ficha.area = `${area[1]} m²`;
  const c = concessaoNoTexto(t, concessoes);
  if (c) ficha.concessao = c;
  return ficha;
}

// ------------------------------------------------------------------ uso da faixa (PIT etc.)

export function extrairFichaFaixa(texto, ementa, concessoes) {
  const t = texto.replace(/\s+/g, ' ');
  const ficha = {};
  // "de interesse da V. Tech Tecnologia e Sistemas Ltda., inscrito..." (ignora "Projeto de Interesse de Terceiro")
  const inter =
    t.match(/de interesse d[aoe]s?\s+(?!terceiro)(.{3,160}?)(?=,\s*(?:inscrit|CNPJ|relativ|conforme|sob|para|localizad|na faixa|no km)|\s+relativo|\.\s+(?:Art|Par[áa]grafo|§)|;|\s+-\s+CNPJ|,?\s+nos termos)/i) ||
    t.match(/requerid[oa] p(?:el[oa]|or)\s+(.{3,120}?)(?=,|\.\s|;)/i);
  if (inter) ficha.interessado = inter[1].replace(/\s+/g, ' ').replace(/[.,;]$/, '').trim();
  // Objeto: no PIT vem após "relativo à"; nos atos antigos, a própria ementa ("Autoriza a readequação de acesso...") é mais clara
  const doTexto = () => t.match(/relativ[oa]s?\s+[àa]s?\s+(.{5,200}?)(?=,?\s+na\s+faixa\s+de\s+dom[íi]nio|,?\s+por\s+meio|,\s*localizad|,\s*no\s+km|,?\s+na\s+BR|\.\s)/i);
  const daEmenta = () => String(ementa).match(/autoriza[r]?\s+(?:o|a|os|as)\s+(?!projeto de interesse)(.{5,160}?)(?=,?\s+(?:na|da|localizad[oa])\s+(?:na\s+)?faixa|,?\s+localizad|,?\s+de interesse|\.\s|\.$|$)/i);
  const obj = /relativ|interesse de terceiro|\bPIT\b/i.test(ementa) ? doTexto() || daEmenta() : daEmenta() || doTexto();
  if (obj) ficha.objeto = obj[1].replace(/\s+/g, ' ').trim().slice(0, 180);
  const conc = t.match(new RegExp(String.raw`(?:sob concess[ãa]o|concedido|concedida|integrante do Sistema[^.]{0,80}?)\s+(?:à|a|da|do)\s+(?:Concession[áa]ria\s+)?([A-ZÀ-Ú][^,;:]{2,110}?${SUFIXO_EMPRESA})`));
  if (conc) ficha.concessionaria = conc[1].replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  extrairLocal(t, ficha);
  ficha.usos = tipoDeUso(`${ementa} ${ficha.objeto || ''}`);
  ficha.cpeu = /permiss[ãa]o especial de uso|\bCPEU\b/i.test(t);
  const lado = t.match(/\b(pista (?:norte|sul|leste|oeste)|lado (?:direito|esquerdo)|sentido [A-ZÀ-Ú][\wÀ-ú/ -]{2,30})/i);
  if (lado) ficha.lado = lado[1];
  const c = concessaoNoTexto(t, concessoes);
  if (c) ficha.concessao = c;
  return ficha;
}

// ------------------------------------------------------------------ leitura do texto integral

async function textoIntegral(sessao, ato) {
  const html = await sessao.texto(urlAto(ato));
  const i = html.indexOf('id="conteudo"');
  const trecho = i >= 0 ? html.slice(i, i + 200000) : html;
  const texto = textoPuro(trecho);
  const dou = texto.match(/D\.O\.U\.?,?\s*(\d{2}\/\d{2}\/\d{4})/);
  // Anexo publicado à parte (PDF com o quadro de coordenadas / memorial descritivo)
  const anexo = trecho.match(/href="((?:https?:)?\/\/[^"]+\.pdf)"[^>]*>\s*(?:<[^>]+>\s*)*ANEXO/i);
  // Quadro de coordenadas publicado no próprio texto (atos mais antigos)
  const temQuadro = /QUADRO DE COORDENADAS/i.test(texto) && /<table/i.test(trecho.slice(trecho.search(/ANEXO/i)));
  // o quadro de coordenadas/memorial do anexo não interessa para a ficha
  const corpo = texto.split(/ANEXO\s*[-–]?\s*QUADRO DE COORDENADAS|QUADRO DE COORDENADAS|ANEXO I\s*-\s*[ÁA]rea/i)[0];
  return {
    corpo,
    dou: dou ? dataBR(dou[1]) : null,
    anexo: anexo ? (anexo[1].startsWith('//') ? 'https:' + anexo[1] : anexo[1]) : null,
    quadroNoTexto: temQuadro,
  };
}

function completar(ficha, { dou, anexo, quadroNoTexto }) {
  if (dou) ficha.dou = dou;
  if (anexo) ficha.anexo = anexo;
  if (quadroNoTexto) ficha.quadroNoTexto = true;
  return ficha;
}

export async function fichaDaDup(sessao, ato, concessoes) {
  const t = await textoIntegral(sessao, ato);
  return completar(extrairFichaDup(t.corpo, concessoes), t);
}

export async function fichaDaFaixa(sessao, ato, concessoes) {
  const t = await textoIntegral(sessao, ato);
  return completar(extrairFichaFaixa(t.corpo, ato.ementa, concessoes), t);
}
