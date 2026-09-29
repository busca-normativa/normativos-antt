// Ficha das Declarações de Utilidade Pública (DUP): lê o texto integral do ato no ANTTlegis e extrai
// concessionária, obra, rodovias, km, municípios, processo SEI, urgência e data do DOU.

import { textoPuro, normalizar, dataBR } from './texto.mjs';
import { urlAto } from './anttlegis.mjs';

/** A ementa/título indica uma DUP? */
export function ehDup(ato) {
  if (/^(voto|audiencia|consulta|tomada|reuniao)/.test(normalizar(ato.titulo).trim())) return false;
  const e = normalizar(ato.ementa);
  // "Declara (de/a) utilidade pública...", "Encaminha proposta de declaração de utilidade pública...", retificações e revogações de DUP
  return /\b(declara|declarar|encaminha|encaminhar|retifica|revoga|altera)\b[^.]{0,120}utilidade publica/.test(e) && !/requerimento de dup|procedimentos/.test(e);
}

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

/** Extrai os campos da DUP a partir do texto integral. */
export function extrairFicha(texto) {
  const t = texto.replace(/\s+/g, ' ');
  const ficha = {};

  // Concessionária autorizada a promover as desapropriações
  const conc =
    t.match(/(?:Fica|Autorizar|Autoriza|autorizada?)\s+(?:a\s+)?(?:empresa\s+|concession[áa]ria\s+)?([A-ZÀ-Ú][^,;:]{3,120}?(?:S\.?\s?\/?A\.?|Ltda\.?|Concession[áa]ria[^,;]{0,60}))(?=[\s,.;])/) ||
    t.match(/administrad[ao] pela\s+([^,;]{3,120}?(?:S\.?\s?\/?A\.?|Ltda\.?))/i) ||
    t.match(/em favor d[ao]\s+(?!Uni[ãa]o)([^,;]{3,120}?(?:S\.?\s?\/?A\.?|Ltda\.?))/i);
  if (conc) {
    ficha.concessionaria = conc[1]
      .replace(/\s+/g, ' ')
      .replace(/\s+(autorizad|fica\b|inscrit|detentor|a promover).*$/i, '')
      .replace(/\.$/, '')
      .trim();
  }

  const proc = t.match(/Processo\s+(?:SEI\s+)?n[º°o.]?\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i);
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
  // modelo antigo: "município de Hidrolândia, no estado de Goiás"
  for (const m of t.matchAll(/munic[íi]pio\s+de\s+([A-ZÀ-Ú][^,.;:()]{1,60}?),\s*(?:no\s+)?estado\s+d[eoa]s?\s+([A-ZÀ-Úa-zà-ú ]{4,25}?)(?=[\s,.;]|$)/g)) {
    const uf = UF[normalizar(m[2]).trim()];
    if (uf) muni.push(`${m[1].trim()}/${uf}`);
  }
  ficha.municipios = unicos(muni).slice(0, 12);

  // nome da rodovia no modelo antigo ("Rodovia Transbrasiliana, BR-153/GO") ajuda a achar a concessão
  const via = t.match(/Rodovia\s+([A-ZÀ-Ú][A-Za-zÀ-ú ]{3,40}?),\s*BR/);
  if (via) ficha.rodoviaNome = via[1].trim();

  const obra =
    t.match(/necess[áa]ri[oa]s?\s+(?:[àa]s?\s+)?(?:execu[çc][ãa]o\s+d[aoe]s?\s+|implanta[çc][ãa]o\s+d[aoe]s?\s+)?obras?\s+(?:de\s+|do\s+|da\s+|das\s+|dos\s+)?(?:de\s+)?(.{5,160}?)(?=,\s*(?:localizad|na\s+BR|no\s+km|BR-|no\s+munic|conforme)|\s+na\s+BR|\s+no\s+km|\s+nos?\s+kms?|\.\s)/i) ||
    t.match(/obras?\s+de\s+(.{5,120}?)(?=,|\s+na\s+BR|\s+no\s+km|\.)/i);
  if (obra) ficha.obra = obra[1].replace(/\s+/g, ' ').trim();

  ficha.urgencia = /carater\s+de\s+urgencia/.test(normalizar(t));
  const area = t.match(/([\d.]+,\d+)\s*m[²2]/);
  if (area) ficha.area = `${area[1]} m²`;
  return ficha;
}

/** Busca o texto integral do ato e devolve a ficha da DUP. */
export async function fichaDaDup(sessao, ato) {
  const html = await sessao.texto(urlAto(ato));
  const i = html.indexOf('id="conteudo"');
  const texto = textoPuro(i >= 0 ? html.slice(i, i + 120000) : html);
  // corta o quadro de coordenadas do anexo, que não interessa para a ficha (a data do DOU vem depois dele)
  const ficha = extrairFicha(texto.split(/ANEXO\s*[-–]?\s*QUADRO DE COORDENADAS|QUADRO DE COORDENADAS|ANEXO I\s*-\s*[ÁA]rea/i)[0]);
  const dou = texto.match(/D\.O\.U\.?,?\s*(\d{2}\/\d{2}\/\d{4})/);
  if (dou) ficha.dou = dataBR(dou[1]);
  return ficha;
}
