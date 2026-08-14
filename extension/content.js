(function () {
  'use strict';

  // Substitui o window.open que o SIMOV usa pra abrir a "Ficha"/Relatorio
  // da Vistoria como popup travado (toolbar=no, tamanho fixo), forcando
  // abrir como aba normal. Isso PRECISA rodar no contexto real da pagina
  // (nao no mundo isolado da extensao), senao o override nao vale pros
  // scripts que o proprio SIMOV executa. Criar uma <script> e injetar no
  // documento e a forma mais compativel de conseguir isso - funciona em
  // qualquer versao com Manifest V3, ao contrario da chave "world: MAIN"
  // do manifest (que exige Chrome/Edge 111+).
  function patchWindowOpenInPageContext() {
    if (document.getElementById('simov-ext-open-patch')) return;

    var script = document.createElement('script');
    script.id = 'simov-ext-open-patch';
    script.textContent =
      '(function () {' +
      '  if (window.__simovExtOpenPatched) return;' +
      '  window.__simovExtOpenPatched = true;' +
      '  var nativeOpen = window.open;' +
      '  window.open = function (url, name, specs) {' +
      '    if (specs) { return nativeOpen.call(window, url, "_blank"); }' +
      '    return nativeOpen.call(window, url, name, specs);' +
      '  };' +
      '})();';

    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  patchWindowOpenInPageContext();

  var STORAGE_KEYS = {
    dark: 'simov-ext-dark-mode',
    collapsed: 'simov-ext-menu-collapsed',
    searchCollapsed: 'simov-ext-search-collapsed',
    recentSearches: 'simov-ext-recent-searches',
    recentListCollapsed: 'simov-ext-recent-list-collapsed',
    quickSearchPanelCollapsed: 'simov-ext-quick-search-panel-collapsed'
  };

  var MIN_OPTIONS_TO_ENHANCE = 12;
  var MAX_RECENT_SEARCHES = 8;

  function normalize(str) {
    return (str || '')
      .toString()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  // ---- Filtro de texto para <select> grandes (municipio, cedente, etc.) ----
  function enhanceSelect(select) {
    if (!select || select.dataset.simovEnhanced === '1') return;
    if (!select.options || select.options.length < MIN_OPTIONS_TO_ENHANCE) return;

    select.dataset.simovEnhanced = '1';

    var wrapper = document.createElement('div');
    wrapper.className = 'simov-ext-select-search';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Filtrar opcoes...';
    input.className = 'simov-ext-select-search-input';
    input.autocomplete = 'off';
    input.spellcheck = false;

    wrapper.appendChild(input);
    select.parentNode.insertBefore(wrapper, select);

    function applyFilter() {
      var query = normalize(input.value);
      Array.prototype.forEach.call(select.options, function (opt) {
        var isPlaceholder = opt.value === '';
        var isSelected = opt.selected;
        var matches = !query || normalize(opt.text).indexOf(query) !== -1;
        opt.hidden = !(isPlaceholder || isSelected || matches);
      });
    }

    input.addEventListener('input', applyFilter);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        input.value = '';
        applyFilter();
        input.blur();
      }
      // impede que Enter no filtro dispare submit indevido do formulario
      if (ev.key === 'Enter') {
        ev.preventDefault();
      }
    });
  }

  function enhanceAllSelects(root) {
    var scope = root || document;
    var selects = scope.querySelectorAll('select');
    Array.prototype.forEach.call(selects, enhanceSelect);
  }

  // ---- Menu lateral recolhivel + consolidacao do topo ----
  // A antiga ".faixa" (abas Pesquisa/Cadastro + widget de tamanho de fonte)
  // foi esvaziada/escondida; o widget nativo "a/A" se muda pra dentro de
  // "#topo" pra tudo ficar numa unica barra compacta. Refeito a cada
  // chamada porque o postback parcial pode devolver um table.fontSize novo
  // dentro da ".faixa" original.
  function moveFontSizeWidgetToTopo() {
    var topo = document.getElementById('topo');
    var fontSizeTable = document.querySelector('table.fontSize');
    if (topo && fontSizeTable && fontSizeTable.parentNode !== topo) {
      topo.appendChild(fontSizeTable);
    }
    return fontSizeTable;
  }

  function setupMenuCollapse() {
    var menuCell = document.getElementById('menu');
    if (!menuCell) return;

    var fontSizeTable = moveFontSizeWidgetToTopo();

    if (document.getElementById('simov-ext-menu-toggle')) return;
    if (!document.body) return;

    // O botao precisa ficar fora da <td> do menu, porque a celula usa
    // "display:none" quando recolhida - se o botao estivesse dentro dela,
    // desapareceria junto e nao daria pra reabrir o menu. Preferimos
    // encaixa-lo dentro de "#topo" (fluxo normal, ao lado do widget de
    // fonte); so cai para posicao fixa se essa area nao existir na pagina.
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'simov-ext-menu-toggle';
    toggle.title = 'Recolher/expandir menu';
    toggle.setAttribute('aria-label', 'Recolher ou expandir menu lateral');
    toggle.textContent = '☰';

    var mount = document.getElementById('topo') || document.querySelector('.faixa .right');
    if (mount) {
      toggle.className = 'simov-ext-menu-toggle simov-ext-menu-toggle-inline';
      mount.insertBefore(toggle, fontSizeTable || null);
    } else {
      toggle.className = 'simov-ext-menu-toggle simov-ext-menu-toggle-floating';
      document.body.appendChild(toggle);
    }

    var collapsed = localStorage.getItem(STORAGE_KEYS.collapsed) === '1';
    if (collapsed) menuCell.classList.add('simov-ext-collapsed');

    toggle.addEventListener('click', function () {
      var isCollapsed = menuCell.classList.toggle('simov-ext-collapsed');
      localStorage.setItem(STORAGE_KEYS.collapsed, isCollapsed ? '1' : '0');
    });
  }

  // ---- Painel de pesquisa recolhivel ----
  // O UpdatePanel do SIMOV pode substituir o .search por um elemento novo a
  // cada postback parcial, entao em vez de guardar uma referencia fixa,
  // recriamos o cabecalho a cada chamada e buscamos o painel atual dentro
  // do handler de clique (nunca uma referencia presa/antiga).
  function setupSearchCollapse() {
    var panel = document.querySelector('.search');
    if (!panel) return;

    var existingToggle = document.querySelector('.simov-ext-search-toggle');
    if (existingToggle) existingToggle.remove();

    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'simov-ext-search-toggle';

    var label = document.createElement('span');
    label.textContent = 'Pesquisa';

    var chevron = document.createElement('span');
    chevron.className = 'simov-ext-chevron';
    chevron.textContent = '▾';

    header.appendChild(label);
    header.appendChild(chevron);

    var collapsed = localStorage.getItem(STORAGE_KEYS.searchCollapsed) === '1';
    panel.classList.toggle('simov-ext-search-hidden', collapsed);
    header.classList.toggle('simov-ext-collapsed-state', collapsed);

    header.addEventListener('click', function () {
      var currentPanel = document.querySelector('.search');
      if (!currentPanel) return;
      var isCollapsed = currentPanel.classList.toggle('simov-ext-search-hidden');
      header.classList.toggle('simov-ext-collapsed-state', isCollapsed);
      localStorage.setItem(STORAGE_KEYS.searchCollapsed, isCollapsed ? '1' : '0');
    });

    panel.parentNode.insertBefore(header, panel);
  }

  // ---- Busca rapida por codigo + historico de buscas recentes ----
  // Procura o campo pelo texto do rotulo (<h5>) em vez de um id fixo,
  // porque o id do ASP.NET muda de modulo pra modulo (txtCodigoImovelProprio
  // na Vistoria, outro nome noutro modulo) - so o texto "Codigo" e estavel.
  function findSearchFieldByLabel(labelSubstring) {
    var fieldsets = document.querySelectorAll('.search fieldset');
    var target = normalize(labelSubstring);
    for (var i = 0; i < fieldsets.length; i++) {
      var h5 = fieldsets[i].querySelector('h5');
      if (!h5) continue;
      if (normalize(h5.textContent).indexOf(target) !== -1) {
        return fieldsets[i].querySelector('input.textbox, select');
      }
    }
    return null;
  }

  function findSearchSubmitButton() {
    var buttons = document.querySelectorAll('.search input[type="submit"].button');
    for (var i = 0; i < buttons.length; i++) {
      if (normalize(buttons[i].value).indexOf('pesquisar') !== -1) return buttons[i];
    }
    return buttons[0] || null;
  }

  function getRecentSearches() {
    try {
      var raw = localStorage.getItem(STORAGE_KEYS.recentSearches);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function addRecentSearch(code) {
    if (!code) return;
    var list = getRecentSearches().filter(function (c) { return c !== code; });
    list.unshift(code);
    if (list.length > MAX_RECENT_SEARCHES) list.length = MAX_RECENT_SEARCHES;
    try {
      localStorage.setItem(STORAGE_KEYS.recentSearches, JSON.stringify(list));
    } catch (e) {
      // localStorage indisponivel (modo privado etc.) - sem historico, sem quebrar nada
    }
  }

  function removeRecentSearch(code) {
    var list = getRecentSearches().filter(function (c) { return c !== code; });
    try {
      localStorage.setItem(STORAGE_KEYS.recentSearches, JSON.stringify(list));
    } catch (e) {}
  }

  function clearRecentSearches() {
    try {
      localStorage.removeItem(STORAGE_KEYS.recentSearches);
    } catch (e) {}
  }

  // So faz sentido em paginas de listagem/pesquisa que tem um campo
  // "Codigo" reconhecivel; paginas de cadastro/edicao nao ganham o atalho.
  // Fica como um botao no "#topo" que abre um menu suspenso ancorado no
  // canto direito (nao um box fixo grudado no rodape, que competia com o
  // botao de tema escuro e ficava longe da mao).
  function setupQuickCodeSearch() {
    if (document.getElementById('simov-ext-quick-search-toggle')) return;
    if (!document.body) return;
    if (!findSearchFieldByLabel('codigo')) return;

    var topo = document.getElementById('topo');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'simov-ext-quick-search-toggle';
    toggle.className = 'simov-ext-menu-toggle simov-ext-menu-toggle-inline';
    toggle.title = 'Busca rapida por codigo';
    toggle.setAttribute('aria-label', 'Busca rapida por codigo');
    toggle.textContent = '🔎';

    if (topo) {
      topo.appendChild(toggle);
    } else {
      toggle.classList.add('simov-ext-menu-toggle-floating');
      document.body.appendChild(toggle);
    }

    var panel = document.createElement('div');
    panel.id = 'simov-ext-quick-search-panel';
    panel.className = 'simov-ext-quick-search-panel';
    panel.hidden = true;

    // Alca de colapsar/expandir o painel inteiro pro lado direito: em vez
    // de fechar (o que perde o foco do campo/estado do menu), encolhe pra
    // uma tira fina grudada na borda direita, deixando so a alca visivel.
    var collapseHandle = document.createElement('button');
    collapseHandle.type = 'button';
    collapseHandle.className = 'simov-ext-quick-search-collapse';
    collapseHandle.title = 'Colapsar/expandir pro lado direito';
    collapseHandle.setAttribute('aria-label', 'Colapsar ou expandir o painel');
    collapseHandle.textContent = '▸';

    var body = document.createElement('div');
    body.className = 'simov-ext-quick-search-body';

    var row = document.createElement('div');
    row.className = 'simov-ext-quick-search-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Codigo...';
    input.className = 'simov-ext-quick-search-input';
    input.autocomplete = 'off';
    input.inputMode = 'numeric';
    input.setAttribute('pattern', '[0-9]*');

    // Codigo de imovel e sempre numerico - barra letras/nomes direto no
    // campo em vez de deixar digitar e so falhar na busca depois.
    input.addEventListener('input', function () {
      var digitsOnly = input.value.replace(/\D+/g, '');
      if (digitsOnly !== input.value) input.value = digitsOnly;
    });

    var goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'simov-ext-quick-search-btn';
    goBtn.textContent = '↵';
    goBtn.title = 'Pesquisar';

    row.appendChild(input);
    row.appendChild(goBtn);

    // Cabecalho "Recentes" clicavel: colapsa/expande so a lista, sem fechar
    // o menu inteiro nem mexer no campo de busca. Estado salvo.
    var listHeader = document.createElement('div');
    listHeader.className = 'simov-ext-recent-header';

    var listToggle = document.createElement('button');
    listToggle.type = 'button';
    listToggle.className = 'simov-ext-recent-toggle';

    var listTitle = document.createElement('span');
    listTitle.textContent = 'Recentes';

    var listChevron = document.createElement('span');
    listChevron.className = 'simov-ext-chevron';
    listChevron.textContent = '▾';

    listToggle.appendChild(listTitle);
    listToggle.appendChild(listChevron);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'simov-ext-recent-clear';
    clearBtn.textContent = 'Limpar';

    listHeader.appendChild(listToggle);
    listHeader.appendChild(clearBtn);

    var list = document.createElement('div');
    list.className = 'simov-ext-recent-list';

    var listCollapsed = localStorage.getItem(STORAGE_KEYS.recentListCollapsed) === '1';
    list.classList.toggle('simov-ext-recent-list-hidden', listCollapsed);
    listToggle.classList.toggle('simov-ext-collapsed-state', listCollapsed);

    listToggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var isCollapsed = list.classList.toggle('simov-ext-recent-list-hidden');
      listToggle.classList.toggle('simov-ext-collapsed-state', isCollapsed);
      localStorage.setItem(STORAGE_KEYS.recentListCollapsed, isCollapsed ? '1' : '0');
    });

    body.appendChild(row);
    body.appendChild(listHeader);
    body.appendChild(list);
    panel.appendChild(collapseHandle);
    panel.appendChild(body);
    document.body.appendChild(panel);

    var panelCollapsed = localStorage.getItem(STORAGE_KEYS.quickSearchPanelCollapsed) === '1';
    panel.classList.toggle('simov-ext-panel-collapsed', panelCollapsed);
    collapseHandle.textContent = panelCollapsed ? '◂' : '▸';

    collapseHandle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var isCollapsed = panel.classList.toggle('simov-ext-panel-collapsed');
      collapseHandle.textContent = isCollapsed ? '◂' : '▸';
      localStorage.setItem(STORAGE_KEYS.quickSearchPanelCollapsed, isCollapsed ? '1' : '0');
      if (!isCollapsed) input.focus();
    });

    function renderList() {
      list.innerHTML = '';
      var codes = getRecentSearches();

      if (!codes.length) {
        listHeader.hidden = true;
        var empty = document.createElement('div');
        empty.className = 'simov-ext-recent-empty';
        empty.textContent = 'Nenhuma busca recente';
        list.appendChild(empty);
        return;
      }

      listHeader.hidden = false;
      codes.forEach(function (code) {
        var item = document.createElement('div');
        item.className = 'simov-ext-recent-item';

        var codeBtn = document.createElement('button');
        codeBtn.type = 'button';
        codeBtn.className = 'simov-ext-recent-item-code';
        codeBtn.textContent = code;
        codeBtn.title = 'Pesquisar codigo ' + code;
        codeBtn.addEventListener('click', function () {
          input.value = code;
          runSearch();
        });

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'simov-ext-recent-item-remove';
        removeBtn.title = 'Remover dos recentes';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          removeRecentSearch(code);
          renderList();
        });

        item.appendChild(codeBtn);
        item.appendChild(removeBtn);
        list.appendChild(item);
      });
    }

    clearBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      clearRecentSearches();
      renderList();
    });

    function openPanel() {
      panel.hidden = false;
      toggle.classList.add('simov-ext-active');
      input.focus();
    }

    function closePanel() {
      panel.hidden = true;
      toggle.classList.remove('simov-ext-active');
    }

    function runSearch() {
      var value = input.value.trim();
      if (!value) return;

      var field = findSearchFieldByLabel('codigo');
      var submitBtn = findSearchSubmitButton();
      if (!field || !submitBtn) return;

      var searchPanel = document.querySelector('.search');
      if (searchPanel) searchPanel.classList.remove('simov-ext-search-hidden');
      var searchToggle = document.querySelector('.simov-ext-search-toggle');
      if (searchToggle) searchToggle.classList.remove('simov-ext-collapsed-state');

      field.value = value;
      addRecentSearch(value);
      renderList();
      closePanel();
      submitBtn.click();
    }

    toggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (panel.hidden) openPanel(); else closePanel();
    });

    panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });

    document.addEventListener('click', function () {
      closePanel();
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        runSearch();
      }
      if (ev.key === 'Escape') {
        closePanel();
      }
    });
    goBtn.addEventListener('click', runSearch);

    renderList();
  }

  // ---- Copiar linha da grid como texto ----
  function getGridHeaders(table) {
    var headerRow = table.querySelector('tr.headerstyle');
    if (!headerRow) return [];
    var cells = headerRow.querySelectorAll('th, td');
    return Array.prototype.map.call(cells, function (c) {
      return c.textContent.replace(/\s+/g, ' ').trim();
    });
  }

  function rowToText(row, headers) {
    var cells = row.querySelectorAll('td');
    var parts = [];
    Array.prototype.forEach.call(cells, function (td, index) {
      if (td.querySelector('input[type="image"]')) return; // celula de acao (icones), ignora
      var value = td.textContent.replace(/\s+/g, ' ').trim();
      if (!value) return;
      var label = headers[index];
      parts.push(label ? label + ': ' + value : value);
    });
    return parts.join(' | ');
  }

  function fallbackCopyToClipboard(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      // sem suporte a copia - o usuario ainda pode copiar manualmente do textarea, mas
      // como ele some em seguida isso e apenas um "melhor esforco"
    }
    ta.remove();
  }

  function copyTextToClipboard(text, onDone) {
    // O SIMOV roda em http:// (sem TLS), e a Clipboard API moderna so
    // funciona em contexto seguro - por isso o fallback via execCommand
    // nao e so um "extra", e o unico caminho que funciona aqui.
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onDone, function () {
        fallbackCopyToClipboard(text);
        onDone();
      });
    } else {
      fallbackCopyToClipboard(text);
      onDone();
    }
  }

  function setupRowCopyButtons() {
    var tables = document.querySelectorAll('table.gridview');
    Array.prototype.forEach.call(tables, function (table) {
      var headers = getGridHeaders(table);
      var rows = table.querySelectorAll('tr.itemstyle, tr.alternateitemstyle');
      Array.prototype.forEach.call(rows, function (row) {
        if (row.dataset.simovCopyReady === '1') return;
        row.dataset.simovCopyReady = '1';

        var firstTd = row.querySelector('td');
        if (!firstTd) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'simov-ext-row-copy';
        btn.title = 'Copiar dados desta linha';
        btn.textContent = '⧉';

        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var text = rowToText(row, headers);
          copyTextToClipboard(text, function () {
            var original = btn.textContent;
            btn.textContent = '✓';
            btn.classList.add('simov-ext-row-copy-done');
            setTimeout(function () {
              btn.textContent = original;
              btn.classList.remove('simov-ext-row-copy-done');
            }, 1200);
          });
        });

        firstTd.insertBefore(btn, firstTd.firstChild);
      });
    });
  }

  // ---- Aviso ao sair de formulario com dados nao salvos ----
  // O SIMOV nao tem nenhuma protecao nativa contra perder um cadastro/edicao
  // em andamento - fechar a aba ou navegar pelo menu descarta tudo sem
  // avisar. Marca "sujo" em qualquer input/mudanca fora do painel de busca
  // (que nao conta como "dado que seria perdido"), e limpa a marca se o
  // proprio formulario for submetido (presume-se que e um "Salvar").
  var simovFormDirty = false;

  function setupUnsavedChangesWarning() {
    var form = document.getElementById('aspnetForm');
    if (!form || form.dataset.simovUnsavedWired === '1') return;
    form.dataset.simovUnsavedWired = '1';

    function markDirty(ev) {
      var el = ev.target;
      if (!el || typeof el.closest !== 'function') return;
      if (el.closest('.search')) return;
      if (el.closest('#simov-ext-quick-search')) return;
      if (el.closest('.simov-ext-select-search')) return;
      simovFormDirty = true;
    }

    form.addEventListener('input', markDirty, true);
    form.addEventListener('change', markDirty, true);
    form.addEventListener('submit', function () {
      simovFormDirty = false;
    });

    if (!window.__simovExtBeforeUnloadBound) {
      window.__simovExtBeforeUnloadBound = true;
      window.addEventListener('beforeunload', function (ev) {
        if (!simovFormDirty) return undefined;
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      });
    }
  }

  // ---- Botao flutuante de tema escuro ----
  function setupDarkModeToggle() {
    if (document.getElementById('simov-ext-fab-bar')) return;
    if (!document.body) return;

    var bar = document.createElement('div');
    bar.id = 'simov-ext-fab-bar';
    bar.className = 'simov-ext-fab-bar';

    var darkBtn = document.createElement('button');
    darkBtn.type = 'button';
    darkBtn.className = 'simov-ext-fab';
    darkBtn.title = 'Alternar tema escuro';
    darkBtn.setAttribute('aria-label', 'Alternar tema escuro');
    darkBtn.textContent = '◐';

    bar.appendChild(darkBtn);
    document.body.appendChild(bar);

    var isDark = localStorage.getItem(STORAGE_KEYS.dark) === '1';
    document.documentElement.classList.toggle('simov-dark-mode', isDark);

    darkBtn.addEventListener('click', function () {
      var nowDark = document.documentElement.classList.toggle('simov-dark-mode');
      localStorage.setItem(STORAGE_KEYS.dark, nowDark ? '1' : '0');
    });
  }

  function applyEnhancements() {
    enhanceAllSelects(document);
    setupMenuCollapse();
    setupSearchCollapse();
    setupQuickCodeSearch();
    setupRowCopyButtons();
    setupUnsavedChangesWarning();
    setupDarkModeToggle();
  }

  // A pagina usa UpdatePanel (postback parcial via Sys.WebForms.PageRequestManager).
  // Depois de uma pesquisa/paginacao, o HTML dentro do painel e substituido e
  // perde nossos filtros injetados, entao reaplicamos ao fim de cada postback parcial.
  function hookPartialPostbacks() {
    if (window.Sys && window.Sys.WebForms && window.Sys.WebForms.PageRequestManager) {
      try {
        window.Sys.WebForms.PageRequestManager.getInstance().add_endRequest(function () {
          applyEnhancements();
        });
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function init() {
    applyEnhancements();

    if (!hookPartialPostbacks()) {
      var attempts = 0;
      var timer = setInterval(function () {
        attempts += 1;
        if (hookPartialPostbacks() || attempts > 20) {
          clearInterval(timer);
        }
      }, 250);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
