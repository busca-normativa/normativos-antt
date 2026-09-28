// Cliente HTTP com sessão (cookies), decodificação ISO-8859-1, repetição e pausa entre requisições.

const UA = 'Mozilla/5.0 (compatible; ConsultaNormasANTT/1.0; +https://github.com/)';
const decLatin1 = new TextDecoder('latin1');
const decUtf8 = new TextDecoder('utf-8');

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Codifica texto para application/x-www-form-urlencoded em ISO-8859-1 (padrão do ANTTlegis). */
export function codificarLatin1(texto) {
  let out = '';
  for (const ch of String(texto)) {
    const c = ch.codePointAt(0);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (c === 32) out += '+';
    else if (c < 256) out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
    else out += encodeURIComponent(ch);
  }
  return out;
}

export function formLatin1(campos) {
  return Object.entries(campos)
    .map(([k, v]) => encodeURIComponent(k) + '=' + codificarLatin1(v))
    .join('&');
}

export class Sessao {
  constructor({ base = '', charset = 'latin1', pausaMs = 400, tentativas = 4, timeoutMs = 90000 } = {}) {
    this.base = base;
    this.charset = charset;
    this.pausaMs = pausaMs;
    this.tentativas = tentativas;
    this.timeoutMs = timeoutMs;
    this.cookies = new Map();
    this.ultima = 0;
    this.total = 0;
  }

  limparCookies() {
    this.cookies.clear();
  }

  cabecalhoCookie() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  guardarCookies(resp) {
    for (const c of resp.headers.getSetCookie?.() || []) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  async esperarVez() {
    const falta = this.ultima + this.pausaMs - Date.now();
    if (falta > 0) await dormir(falta);
    this.ultima = Date.now();
  }

  /** Faz a requisição e devolve o corpo como texto. */
  async texto(caminho, { metodo = 'GET', corpo, cabecalhos = {} } = {}) {
    let url = caminho.startsWith('http') ? caminho : this.base + caminho;
    let erro;
    for (let t = 1; t <= this.tentativas; t++) {
      try {
        await this.esperarVez();
        let m = metodo;
        let b = corpo;
        for (let redir = 0; redir < 6; redir++) {
          const headers = { 'User-Agent': UA, Accept: '*/*', ...cabecalhos };
          const ck = this.cabecalhoCookie();
          if (ck) headers.Cookie = ck;
          if (b) headers['Content-Type'] = 'application/x-www-form-urlencoded';
          const resp = await fetch(url, { method: m, headers, body: b, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
          this.total++;
          this.guardarCookies(resp);
          if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
            url = new URL(resp.headers.get('location'), url).href;
            m = 'GET';
            b = undefined;
            continue;
          }
          if (resp.status >= 500 || resp.status === 429) throw new Error(`HTTP ${resp.status} em ${url}`);
          if (resp.status >= 400) {
            const e = new Error(`HTTP ${resp.status} em ${url}`);
            e.definitivo = true;
            throw e;
          }
          const buf = await resp.arrayBuffer();
          return (this.charset === 'utf-8' ? decUtf8 : decLatin1).decode(buf);
        }
        throw new Error(`Redirecionamentos demais em ${url}`);
      } catch (e) {
        erro = e;
        if (e.definitivo) break;
        await dormir(1500 * t * t);
      }
    }
    throw erro;
  }

  async json(caminho, opcoes) {
    const t = await this.texto(caminho, opcoes);
    return JSON.parse(t);
  }
}
