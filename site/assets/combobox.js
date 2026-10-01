// Transforma um <select> em caixa onde dá para digitar e filtrar as opções ("rota" → Nova Rota do Oeste...).
// O <select> original continua existindo (escondido) e guarda o valor: quem já escuta o evento "change" dele
// continua funcionando, e as opções podem ser recriadas a qualquer momento (innerHTML) que a caixa acompanha.

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let contador = 0;

export function caixaDeBusca(select, { placeholder = 'Digite para buscar…' } = {}) {
  if (!select || select.dataset.combobox) return;
  select.dataset.combobox = '1';
  const id = `cb-${++contador}`;

  const caixa = document.createElement('div');
  caixa.className = 'combobox';
  caixa.innerHTML = `
    <div class="combobox-linha">
      <input type="text" class="combobox-campo" role="combobox" aria-expanded="false" aria-autocomplete="list"
        aria-controls="${id}" autocomplete="off" spellcheck="false" placeholder="${placeholder}">
      <button type="button" class="combobox-seta" tabindex="-1" aria-label="Mostrar opções">▾</button>
    </div>
    <ul class="combobox-lista" id="${id}" role="listbox" hidden></ul>`;
  select.after(caixa);
  select.classList.add('combobox-original');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const label = select.id && document.querySelector(`label[for="${select.id}"]`);
  if (label) label.htmlFor = `${id}-campo`;

  const campo = caixa.querySelector('input');
  campo.id = `${id}-campo`;
  const lista = caixa.querySelector('ul');
  let ativo = -1;
  let opcoesVisiveis = [];

  const textoSelecionado = () => {
    const o = select.selectedOptions[0];
    return o && o.value !== '' ? o.textContent.trim() : '';
  };
  const mostrarSelecionado = () => {
    if (document.activeElement !== campo) campo.value = textoSelecionado();
    caixa.classList.toggle('com-valor', select.value !== '');
  };

  function abrir(filtro = '') {
    const f = normalizar(filtro).trim();
    opcoesVisiveis = [...select.options].filter((o) => !o.disabled && (!f || normalizar(o.textContent).includes(f)));
    lista.innerHTML = opcoesVisiveis.length
      ? opcoesVisiveis
          .map((o, i) => `<li role="option" data-i="${i}" aria-selected="${o.selected}" class="${o.selected ? 'atual' : ''}">${destacar(o.textContent.trim(), f)}</li>`)
          .join('')
      : '<li class="vazio">Nada encontrado</li>';
    ativo = -1;
    lista.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
  }
  function fechar() {
    lista.hidden = true;
    campo.setAttribute('aria-expanded', 'false');
    campo.value = textoSelecionado();
  }
  function escolher(i) {
    const o = opcoesVisiveis[i];
    if (!o) return;
    select.value = o.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    campo.blur();
    fechar();
    mostrarSelecionado();
  }
  function marcar(i) {
    const itens = lista.querySelectorAll('li[data-i]');
    if (!itens.length) return;
    ativo = (i + itens.length) % itens.length;
    itens.forEach((li, k) => li.classList.toggle('ativo', k === ativo));
    itens[ativo].scrollIntoView({ block: 'nearest' });
  }

  campo.addEventListener('focus', () => { campo.select(); abrir(''); });
  campo.addEventListener('input', () => abrir(campo.value));
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (lista.hidden) abrir(''); marcar(ativo + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(ativo - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); escolher(ativo >= 0 ? ativo : opcoesVisiveis.length === 1 ? 0 : -1); }
    else if (e.key === 'Escape') { fechar(); campo.blur(); }
  });
  campo.addEventListener('blur', () => setTimeout(() => { if (!caixa.contains(document.activeElement)) fechar(); }, 150));
  lista.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); escolher(+li.dataset.i); }
  });
  // se a caixa estiver dentro de um <label>, o clique não deve "ativar" o select escondido
  caixa.addEventListener('click', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  caixa.querySelector('.combobox-seta').addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (lista.hidden) campo.focus();
    else fechar();
  });

  // acompanha mudanças feitas pelo painel (opções recriadas, valor alterado por "Limpar tudo", link compartilhado...)
  new MutationObserver(mostrarSelecionado).observe(select, { childList: true, subtree: true, attributes: true });
  const prop = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    get() { return prop.get.call(this); },
    set(v) { prop.set.call(this, v); mostrarSelecionado(); },
  });
  select.addEventListener('change', mostrarSelecionado);
  mostrarSelecionado();
}

function destacar(texto, f) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  if (!f) return esc(texto);
  const n = normalizar(texto);
  const i = n.indexOf(f);
  if (i < 0) return esc(texto);
  return esc(texto.slice(0, i)) + '<mark>' + esc(texto.slice(i, i + f.length)) + '</mark>' + esc(texto.slice(i + f.length));
}
