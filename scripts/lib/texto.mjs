// Utilitários de texto e HTML (sem dependências externas).

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', sect: '§',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ', acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  agrave: 'à', Agrave: 'À', ccedil: 'ç', Ccedil: 'Ç', uuml: 'ü', Uuml: 'Ü', sup2: '²', sup3: '³',
};

export function decodificarEntidades(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m);
}

/** Remove tags e normaliza espaços. */
export function textoPuro(html) {
  return decodificarEntidades(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minúsculas, sem acentos — usado para classificação e busca. */
export function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

/** Extrai data "DE 17 DE SETEMBRO DE 2026" de um título -> "2026-09-17". */
export function dataDoTitulo(titulo) {
  const m = normalizar(titulo).match(/(\d{1,2})[ºo°]?\s+de\s+([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (!m || !MESES[m[2]]) return null;
  return `${m[3]}-${String(MESES[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "18/09/2026 | 06:39:51" -> "2026-09-18" */
export function dataBR(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Corrige títulos duplicados pelo site ("TÍTULO XTÍTULO X" -> "TÍTULO X"). */
export function desduplicarTitulo(t) {
  const s = t.trim();
  if (s.length % 2 === 0) {
    const meio = s.length / 2;
    if (s.slice(0, meio) === s.slice(meio)) return s.slice(0, meio).trim();
  }
  return s;
}

export function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
