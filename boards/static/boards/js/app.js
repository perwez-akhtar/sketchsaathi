(() => {
  const { api, canvas, collab, presence, ui, fileIo } = SketchSaathi;
  const $ = id => document.getElementById(id);
  const DRAWING_EVENTS = ['add', 'update', 'remove', 'clear', 'order', 'background'];
  const GUEST = document.body.dataset.guest === '1';
  const LIVE = !GUEST && document.body.dataset.live !== '0';
  const HOME_PATH = GUEST ? '/draw/' : '/';
  const LAST_KEY = GUEST ? 'sketchsaathi.guest.last' : 'sketchsaathi.last';

  let boardId = null;
  let savedTitle = '';
  let pages = [];
  let pageId = null;
  let saveTimer = null;
  let saving = 0;
  let saveFailed = false;

  const setStatus = text => { $('status').textContent = text; };
  const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // keep the address bar clean; remember the open board in this browser instead
  function updateUrl() {
    if (location.pathname !== HOME_PATH || location.search) history.replaceState(null, '', HOME_PATH);
    try {
      if (boardId) localStorage.setItem(LAST_KEY, JSON.stringify({ board: boardId, page: pageId }));
      else localStorage.removeItem(LAST_KEY);
    } catch {}
  }

  const shareLink = () => `${location.origin}/b/${boardId}/`;

  async function savePageNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pageId) return;
    setStatus('Saving…');
    saving++;
    try {
      await api.updatePage(pageId, { elements: canvas.getElements(), background: canvas.getBackground() });
      saveFailed = false;
      setStatus('Saved');
    } catch (error) {
      saveFailed = true;
      setStatus('Save failed');
      ui.toast(GUEST ? error.message : 'Could not save this page. Check your connection.', 'error', 5000);
    } finally {
      saving--;
    }
  }

  let creating = null;

  // a sketch with no board yet gets one on the first change, so nothing is lost
  async function autoSave() {
    if (boardId) return savePageNow();
    saveTimer = null;
    if (!canvas.getElements().length) return;
    try {
      creating = creating || ensureBoard().finally(() => { creating = null; });
      await creating;
    } catch {
      setStatus('Save failed');
      ui.toast('Could not save this sketch. Check your connection.', 'error', 5000);
    }
  }

  function scheduleSave(delay = 1500) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autoSave, delay);
  }

  const flushSave = () => (saveTimer ? autoSave() : Promise.resolve());

  async function ensureBoard() {
    if (boardId) return;
    const localName = pages[0] && pages[0].name;
    const board = await api.createBoard($('title').value || 'Untitled');
    setBoard(board);
    pageId = board.pages[0].uuid;
    if (localName && localName !== pages[0].name) {
      pages[0].name = localName;
      await api.updatePage(pageId, { name: localName });
    }
    await savePageNow();
    renderTabs();
    updateUrl();
    refreshBoardList();
  }

  async function save() {
    try {
      if (!boardId) return await ensureBoard();
      const title = $('title').value || 'Untitled';
      if (title !== savedTitle) {
        await api.renameBoard(boardId, title);
        savedTitle = title;
        refreshBoardList();
      }
      await savePageNow();
    } catch {
      ui.toast('Could not save the board.', 'error');
    }
  }

  async function saveToFile() {
    try {
      await flushSave();
      const title = $('title').value || 'Untitled';
      const list = await Promise.all(pages.map(async page => (
        page.uuid === pageId
          ? { name: page.name, background: canvas.getBackground(), elements: canvas.getElements() }
          : api.getPage(page.uuid).then(full => ({ name: full.name, background: full.background, elements: full.elements }))
      )));
      const name = await fileIo.saveFile({ title, pages: list });
      if (name) ui.toast(`Saved ${name}`, 'success');
    } catch {
      ui.toast('Could not save the file.', 'error');
    }
  }

  async function openFromFile() {
    let drawing;
    try {
      drawing = await fileIo.openFile();
    } catch (error) {
      return ui.toast(error.message, 'error', 5000);
    }
    if (!drawing) return;

    try {
      await flushSave();
      const board = await api.createBoard(drawing.title);
      const [first, ...rest] = drawing.pages;
      await api.updatePage(board.pages[0].uuid, first);
      for (const page of rest) {
        const added = await api.addPage(board.uuid, page.name);
        await api.updatePage(added.uuid, { elements: page.elements, background: page.background });
      }
      await openBoard(board.uuid);
      ui.toast(`Opened "${drawing.title}"`, 'success');
    } catch (error) {
      ui.toast(GUEST ? error.message : 'Could not open that file.', 'error', 5000);
    }
  }

  function setBoard(board) {
    boardId = board.uuid;
    savedTitle = board.title;
    pages = board.pages;
    $('delete').hidden = !board.is_owner;
    presence.clear();
    if (LIVE) collab.connect(boardId);
  }

  async function refreshBoardList() {
    const boards = await api.listBoards();
    $('boards').innerHTML = '<option value="">New board</option>' +
      boards.map(b => `<option value="${b.uuid}">${escapeHtml(b.title)}</option>`).join('');
    $('boards').value = boardId || '';
  }

  async function openBoard(uuid, wantedPage) {
    await flushSave();
    const board = await api.getBoard(uuid);
    $('title').value = board.title;
    setBoard(board);
    const target = pages.find(p => p.uuid === wantedPage) || pages[0];
    await loadPage(target.uuid);
    refreshBoardList();
  }

  function newBoard() {
    clearTimeout(saveTimer);
    saveTimer = null;
    boardId = null;
    savedTitle = '';
    pages = [{ uuid: null, name: 'Page 1' }];
    pageId = null;
    collab.disconnect();
    presence.clear();
    canvas.load([]);
    showBackground('#ffffff');
    $('title').value = 'Untitled';
    $('delete').hidden = true;
    $('boards').value = '';
    renderTabs();
    updateUrl();
  }

  async function deleteBoard() {
    if (!boardId) return;
    const ok = await ui.confirm({
      title: 'Delete this board?',
      message: `"${$('title').value}" and all its pages will be deleted for everyone. This can't be undone.`,
      confirmText: 'Delete board', danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteBoard(boardId);
      newBoard();
      ui.toast('Board deleted', 'success');
      refreshBoardList();
    } catch {
      ui.toast('Could not delete the board.', 'error');
    }
  }

  async function share() {
    if (GUEST) {
      const ok = await ui.confirm({
        title: 'Sign up to share',
        message: 'Create a free account to share boards and draw together live. Your sketches here come with you.',
        confirmText: 'Create free account', cancelText: 'Not now',
      });
      if (ok) { await flushSave(); location.href = '/signup/'; }
      return;
    }
    try {
      await ensureBoard();
    } catch {
      return ui.toast('Could not save the board, so it cannot be shared yet.', 'error');
    }
    try {
      await navigator.clipboard.writeText(shareLink());
      ui.toast('Link copied – send it to anyone with an account to draw together', 'success', 3600);
    } catch {
      ui.prompt({ title: 'Share this board', message: 'Copy this link:', value: shareLink(), confirmText: 'Done', cancelText: 'Close' });
    }
  }

  async function loadPage(uuid) {
    const page = await api.getPage(uuid);
    pageId = uuid;
    canvas.load(page.elements);
    showBackground(page.background);
    renderTabs();
    updateUrl();
  }

  async function switchPage(uuid) {
    if (!uuid || uuid === pageId) return;
    await flushSave();
    try {
      await loadPage(uuid);
    } catch {
      ui.toast('That page no longer exists.', 'error');
    }
  }

  async function addPage() {
    try {
      await ensureBoard();
      await flushSave();
      const page = await api.addPage(boardId, `Page ${pages.length + 1}`);
      pages.push(page);
      collab.send({ type: 'pages' });
      await loadPage(page.uuid);
      const tab = document.querySelector(`.tab[data-page="${page.uuid}"]`);
      if (tab) tab.scrollIntoView({ inline: 'nearest' });
    } catch {
      ui.toast('Could not add a page.', 'error');
    }
  }

  async function renamePage(uuid, name) {
    const page = pages.find(p => p.uuid === uuid);
    name = name.trim();
    if (!page || !name || name === page.name) return renderTabs();
    page.name = name;
    renderTabs();
    if (!uuid) return;
    try {
      await api.updatePage(uuid, { name });
      collab.send({ type: 'pages' });
    } catch {
      ui.toast('Could not rename the page.', 'error');
    }
  }

  async function deletePage(uuid) {
    const page = pages.find(p => p.uuid === uuid);
    if (!page || pages.length < 2) return;
    const ok = await ui.confirm({
      title: `Delete "${page.name}"?`,
      message: 'Everything on this page will be deleted for everyone.',
      confirmText: 'Delete page', danger: true,
    });
    if (!ok) return;
    try {
      if (uuid === pageId) { clearTimeout(saveTimer); saveTimer = null; }
      await api.deletePage(uuid);
      const index = pages.indexOf(page);
      pages.splice(index, 1);
      collab.send({ type: 'pages' });
      if (uuid === pageId) await loadPage(pages[Math.max(0, index - 1)].uuid);
      else renderTabs();
      ui.toast(`"${page.name}" deleted`, 'success');
    } catch {
      ui.toast('Could not delete the page.', 'error');
    }
  }

  async function refreshPages() {
    if (!boardId) return;
    const board = await api.getBoard(boardId);
    pages = board.pages;
    if (document.activeElement !== $('title')) $('title').value = board.title;
    savedTitle = board.title;
    if (!pages.some(p => p.uuid === pageId)) await loadPage(pages[0].uuid);
    else renderTabs();
  }

  function startRename(tab, page) {
    const input = document.createElement('input');
    input.value = page.name;
    input.maxLength = 100;
    tab.querySelector('.name').replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      keep ? renamePage(page.uuid, input.value) : renderTabs();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
  }

  function renderTabs() {
    const tabs = $('tabs');
    tabs.innerHTML = '';
    pages.forEach(page => {
      const tab = document.createElement('button');
      tab.className = 'tab' + (page.uuid === pageId ? ' active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(page.uuid === pageId));
      tab.dataset.page = page.uuid || '';
      tab.title = 'Double-click to rename';
      tab.innerHTML = '<span class="name"></span>';
      tab.querySelector('.name').textContent = page.name;
      if (pages.length > 1) {
        const close = document.createElement('span');
        close.className = 'close';
        close.textContent = '×';
        close.title = 'Delete page';
        close.addEventListener('click', e => { e.stopPropagation(); deletePage(page.uuid); });
        tab.appendChild(close);
      }
      tab.addEventListener('click', () => switchPage(page.uuid));
      tab.addEventListener('dblclick', () => startRename(tab, page));
      tabs.appendChild(tab);
    });
    if (!pages.some(p => p.uuid === pageId) && pages.length && !pageId) tabs.firstChild.classList.add('active');
  }

  function stepPage(delta) {
    const index = pages.findIndex(p => p.uuid === pageId);
    const next = pages[index + delta];
    if (next) switchPage(next.uuid);
  }

  $('addPage').onclick = addPage;

  const menu = $('menu'), menuButton = $('menuButton');
  const toggleMenu = open => {
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
  };
  menuButton.onclick = () => toggleMenu(menu.hidden);
  document.addEventListener('pointerdown', e => {
    if (!menu.hidden && !menu.contains(e.target) && !menuButton.contains(e.target)) toggleMenu(false);
  });
  $('saveFile').onclick = () => { toggleMenu(false); saveToFile(); };
  $('openFile').onclick = () => { toggleMenu(false); openFromFile(); };
  $('title').addEventListener('change', () => { if (boardId) save(); });
  $('export').onclick = () => {
    const page = pages.find(p => p.uuid === pageId);
    canvas.exportPng(`${$('title').value || 'sketch'}${page ? ' - ' + page.name : ''}.png`);
    toggleMenu(false);
  };
  $('clear').onclick = () => { toggleMenu(false); clearPage(); };
  $('delete').onclick = () => { toggleMenu(false); deleteBoard(); };
  $('boards').onchange = e => { toggleMenu(false); e.target.value ? openBoard(e.target.value) : newBoard(); };
  $('share').onclick = share;

  let currentTool = 'pen';
  const MORE_TOOLS = ['frame', 'bucket', 'lasso'];
  const selectTool = name => {
    currentTool = name;
    canvas.setTool(name);
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
    $('moreButton').classList.toggle('active', MORE_TOOLS.includes(name));
    refreshPanel();
  };
  document.querySelectorAll('.tool[data-tool]').forEach(btn => btn.addEventListener('click', () => selectTool(btn.dataset.tool)));
  canvas.on('toolchange', selectTool);

  function setToolLock(on) {
    canvas.setToolLock(on);
    $('toolLock').setAttribute('aria-pressed', String(on));
    $('toolLock').classList.toggle('active', on);
  }
  $('toolLock').onclick = () => setToolLock($('toolLock').getAttribute('aria-pressed') !== 'true');

  const moreMenu = $('moreMenu'), moreButton = $('moreButton');
  function toggleMore(open) {
    moreMenu.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = moreButton.getBoundingClientRect();
    const height = moreMenu.offsetHeight, width = moreMenu.offsetWidth;
    if (r.top > innerHeight - height - 20) {
      moreMenu.style.left = `${Math.max(10, Math.min(innerWidth - width - 10, r.left - width / 2))}px`;
      moreMenu.style.top = `${r.top - height - 10}px`;
    } else {
      moreMenu.style.left = `${r.right + 10}px`;
      moreMenu.style.top = `${Math.max(10, Math.min(innerHeight - height - 10, r.top - height / 2))}px`;
    }
  }
  moreButton.onclick = () => toggleMore(moreMenu.hidden);
  moreMenu.querySelectorAll('[data-tool]').forEach(item =>
    item.addEventListener('click', () => { selectTool(item.dataset.tool); toggleMore(false); }));
  $('insertImage').onclick = () => { toggleMore(false); $('imageFile').click(); };
  document.addEventListener('pointerdown', e => {
    if (!moreMenu.hidden && !moreMenu.contains(e.target) && !moreButton.contains(e.target)) toggleMore(false);
  });

  const MAX_IMAGE_CHARS = 350000;
  const PAGE_WARN_CHARS = 900000;
  const SUPPORTS_WEBP = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');

  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      let maxSide = 1600, quality = 0.85;
      for (let attempt = 0; attempt < 7; attempt++) {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(img.naturalWidth * k));
        out.height = Math.max(1, Math.round(img.naturalHeight * k));
        const c = out.getContext('2d');
        if (!SUPPORTS_WEBP) { c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height); }
        c.drawImage(img, 0, 0, out.width, out.height);
        const src = out.toDataURL(SUPPORTS_WEBP ? 'image/webp' : 'image/jpeg', quality);
        if (src.length <= MAX_IMAGE_CHARS) return { src, width: out.width, height: out.height };
        maxSide *= 0.75;
        quality = Math.max(0.5, quality - 0.1);
      }
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function addImageFile(file, atPointer) {
    if (!file || !file.type.startsWith('image/')) return ui.toast('That file is not an image.', 'error');
    let image;
    try { image = await compressImage(file); } catch { image = null; }
    if (!image) return ui.toast('Could not use that image. Try a smaller one.', 'error');
    canvas.insertImage(image.src, image.width, image.height, atPointer);
    selectTool('select');
    if (JSON.stringify(canvas.getElements()).length > PAGE_WARN_CHARS) {
      ui.toast('This page is getting large. Put more images on a new page so it keeps saving.', 'info', 6000);
    }
  }

  $('imageFile').addEventListener('change', e => {
    const [file] = e.target.files;
    e.target.value = '';
    if (file) addImageFile(file, false);
  });
  $('canvas').addEventListener('dragover', e => {
    if ([...e.dataTransfer.items].some(item => item.kind === 'file')) {
      e.preventDefault();
      $('canvas').classList.add('dropping');
    }
  });
  $('canvas').addEventListener('dragleave', () => $('canvas').classList.remove('dropping'));
  $('canvas').addEventListener('drop', e => {
    e.preventDefault();
    $('canvas').classList.remove('dropping');
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (!file) return ui.toast('Drop an image file to add it.', 'info');
    canvas.pointAt(e.clientX, e.clientY);
    addImageFile(file, true);
  });

  canvas.on('frameRename', async frame => {
    const name = await ui.prompt({ title: 'Rename frame', value: frame.name || 'Frame', confirmText: 'Rename' });
    if (name && name.trim()) canvas.renameFrame(frame.id, name.trim().slice(0, 60));
  });

  async function clearPage() {
    if (canvas.isEmpty()) return;
    const ok = await ui.confirm({
      title: 'Clear this page?',
      message: 'Everything on this page will be removed for everyone.',
      confirmText: 'Clear page', danger: true,
    });
    if (ok) canvas.clear();
  }
  $('clearTool').onclick = clearPage;

  const defaults = {
    color: '#1e1e1e', fill: '', size: 4, strokeStyle: 'solid', round: false, opacity: 1,
    fontFamily: 'hand', fontSize: 20, align: 'left',
  };
  const target = () => canvas.getEditing() || canvas.getSelection();

  function markActive(selector, match) {
    document.querySelectorAll(selector).forEach(el => el.classList.toggle('active', match(el)));
  }

  function syncPanel(props) {
    const color = (props.color || '#1e1e1e').toLowerCase();
    const preset = document.querySelector(`#colors [data-color="${color}"]`);
    markActive('#colors .dot', d => (preset ? d === preset : d.classList.contains('custom')));
    $('hex').value = color.slice(1);
    $('hex').parentElement.classList.remove('invalid');
    markActive('#fills .dot', d => d.dataset.fill === (props.fill || ''));
    markActive('#widths .opt', b => Number(b.dataset.size) === Number(props.size));
    markActive('#strokeStyles .opt', b => b.dataset.stroke === (props.strokeStyle || 'solid'));
    markActive('#edges .opt', b => (b.dataset.round === '1') === Boolean(props.round));
    markActive('#fontFamilies .opt', b => b.dataset.font === (props.fontFamily || 'hand'));
    markActive('#fontSizes .opt', b => Number(b.dataset.fontSize) === Math.round(props.fontSize || 0));
    markActive('#aligns .opt', b => b.dataset.align === (props.align || 'left'));
    const opacity = Math.round((props.opacity ?? 1) * 100);
    $('opacity').value = opacity;
    $('opacityValue').textContent = opacity;
  }

  function refreshPanel() {
    const el = target();
    const list = canvas.getEditing() ? [canvas.getEditing()] : canvas.getSelectedList();
    const textMode = list.length ? list.every(item => item.type === 'text') : currentTool === 'text';
    $('textProps').hidden = !textMode;
    $('shapeProps').hidden = textMode;
    $('selectionTools').hidden = !canvas.getSelection() || Boolean(canvas.getEditing());
    syncPanel(el || defaults);
  }

  function applyStyle(changes) {
    if (!target()) Object.assign(defaults, changes);
    canvas.setStyle(changes);
    syncPanel(target() || defaults);
  }

  document.querySelectorAll('#colors [data-color]').forEach(dot =>
    dot.addEventListener('click', () => applyStyle({ color: dot.dataset.color })));
  $('color').oninput = e => applyStyle({ color: e.target.value });
  $('hex').addEventListener('input', e => {
    const value = e.target.value.replace(/^#/, '');
    const valid = /^[0-9a-f]{6}$/i.test(value);
    e.target.parentElement.classList.toggle('invalid', !valid && value.length > 0);
    if (valid) {
      canvas.setStyle({ color: `#${value.toLowerCase()}` });
      if (!target()) defaults.color = `#${value.toLowerCase()}`;
    }
  });
  $('hex').addEventListener('change', () => syncPanel(target() || defaults));
  document.querySelectorAll('#fills [data-fill]').forEach(dot =>
    dot.addEventListener('click', () => applyStyle({ fill: dot.dataset.fill })));
  document.querySelectorAll('#widths .opt').forEach(btn =>
    btn.addEventListener('click', () => applyStyle({ size: Number(btn.dataset.size) })));
  document.querySelectorAll('#strokeStyles .opt').forEach(btn =>
    btn.addEventListener('click', () => applyStyle({ strokeStyle: btn.dataset.stroke })));
  document.querySelectorAll('#edges .opt').forEach(btn =>
    btn.addEventListener('click', () => applyStyle({ round: btn.dataset.round === '1' })));
  $('opacity').addEventListener('input', e => {
    $('opacityValue').textContent = e.target.value;
    canvas.setStyle({ opacity: Number(e.target.value) / 100 });
    if (!target()) defaults.opacity = Number(e.target.value) / 100;
  });
  document.querySelectorAll('[data-layer]').forEach(btn =>
    btn.addEventListener('click', () => canvas.reorderSelected(btn.dataset.layer)));
  $('duplicate').onclick = () => canvas.duplicateSelected();
  $('deleteSelection').onclick = () => canvas.deleteSelected();

  document.querySelectorAll('#fontFamilies .opt').forEach(btn =>
    btn.addEventListener('click', () => applyStyle({ fontFamily: btn.dataset.font })));
  document.querySelectorAll('#fontSizes .opt').forEach(btn =>
    btn.addEventListener('click', () => applyStyle({ fontSize: Number(btn.dataset.fontSize) })));
  document.querySelectorAll('#aligns .opt').forEach(btn =>
    btn.addEventListener('click', () => applyStyle({ align: btn.dataset.align })));

  document.querySelector('.style').addEventListener('mousedown', e => {
    if (canvas.getEditing() && !e.target.closest('input')) e.preventDefault();
  });

  canvas.on('select', refreshPanel);
  canvas.on('editing', refreshPanel);

  const stylePanel = document.querySelector('.style');
  const phone = matchMedia('(max-width: 640px)');
  const styleIsOpen = () => (phone.matches ? stylePanel.classList.contains('open') : !stylePanel.classList.contains('collapsed'));
  // on a phone the panel is a sheet; on a computer it can be hidden and brought back
  function toggleStyleSheet(open) {
    if (phone.matches) stylePanel.classList.toggle('open', open);
    else {
      stylePanel.classList.toggle('collapsed', !open);
    }
    syncStyleButtons();
  }
  function syncStyleButtons() {
    const open = String(styleIsOpen());
    $('styleToggle').setAttribute('aria-expanded', open);
    $('styleHandle').setAttribute('aria-expanded', open);
    $('styleHandle').setAttribute('aria-label', open === 'true' ? 'Hide style panel' : 'Show style panel');
  }
  $('styleToggle').onclick = () => toggleStyleSheet(!styleIsOpen());
  $('styleHandle').onclick = () => toggleStyleSheet(!styleIsOpen());

  function showBackground(color) {
    canvas.setBackground(color);
    const preset = document.querySelector(`#backgrounds [data-bg="${color.toLowerCase()}"]`);
    markActive('#backgrounds .dot', d => (preset ? d === preset : d.classList.contains('custom')));
  }
  function changeBackground(color) {
    showBackground(color);
    sendDrawing({ type: 'background', color });
    scheduleSave(800);
  }
  document.querySelectorAll('#backgrounds [data-bg]').forEach(dot =>
    dot.addEventListener('click', () => changeBackground(dot.dataset.bg)));
  $('bgColor').oninput = e => changeBackground(e.target.value);

  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const recall = key => { try { return localStorage.getItem(key); } catch { return null; } };
  syncStyleButtons();

  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('theme').setAttribute('aria-pressed', String(dark));
    remember('sketchsaathi.theme', dark ? 'dark' : 'light');
  }
  function setGrid(on) {
    canvas.setGrid(on);
    $('gridState').textContent = on ? 'On' : 'Off';
    remember('sketchsaathi.grid', on ? '1' : '0');
  }
  $('theme').onclick = () => setTheme(document.documentElement.dataset.theme !== 'dark');
  $('grid').onclick = () => setGrid($('gridState').textContent !== 'On');
  $('fit').onclick = () => { canvas.zoomToFit(); toggleMenu(false); };

  const savedTheme = recall('sketchsaathi.theme');
  setTheme(savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  setGrid(recall('sketchsaathi.grid') !== '0');

  $('zoomIn').onclick = () => canvas.zoomBy(1.2);
  $('zoomOut').onclick = () => canvas.zoomBy(1 / 1.2);
  $('zoomReset').onclick = () => canvas.zoomReset();
  $('zoomResetIcon').onclick = () => canvas.zoomReset();
  $('undo').onclick = () => canvas.undo();
  $('redo').onclick = () => canvas.redo();
  presence.setProjection(canvas.toScreen);
  canvas.on('view', view => {
    $('zoomReset').textContent = `${Math.round(view.scale * 100)}%`;
    $('zoomResetIcon').disabled = Math.round(view.scale * 100) === 100;
    presence.refresh();
  });
  $('scrollBack').onclick = () => canvas.scrollToContent();
  canvas.on('render', () => {
    $('scrollBack').hidden = canvas.isContentVisible();
    $('welcome').hidden = !canvas.isEmpty();
    $('undo').disabled = !canvas.canUndo();
    $('redo').disabled = !canvas.canRedo();
  });

  const help = $('help');
  $('helpButton').onclick = () => help.showModal();
  help.querySelector('[data-close]').onclick = () => help.close();
  help.addEventListener('click', e => { if (e.target === help) help.close(); });

  const shortcuts = {
    h: 'hand', v: 'select', r: 'rectangle', d: 'diamond', o: 'ellipse', a: 'arrow',
    l: 'line', p: 'pen', t: 'text', e: 'eraser', x: 'eraser',
    1: 'select', 2: 'rectangle', 3: 'diamond', 4: 'ellipse', 5: 'arrow', 6: 'line', 7: 'pen', 8: 'text', 0: 'eraser',
    f: 'frame', k: 'laser', b: 'bucket',
  };
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const isTyping = el => el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);

  function ctrlShortcut(e) {
    const key = e.key.toLowerCase();
    const byKey = {
      z: () => (e.shiftKey ? canvas.redo() : canvas.undo()),
      y: () => canvas.redo(),
      s: () => saveToFile(),
      o: () => openFromFile(),
      d: () => canvas.duplicateSelected(),
      a: () => { selectTool('select'); canvas.selectAll(); },
      e: () => e.shiftKey && $('export').click(),
      l: () => e.shiftKey && canvas.lockSelected(),
    };
    const byCode = {
      BracketLeft: () => canvas.reorderSelected(e.shiftKey ? 'back' : 'backward'),
      BracketRight: () => canvas.reorderSelected(e.shiftKey ? 'front' : 'forward'),
      Equal: () => canvas.zoomBy(1.2), NumpadAdd: () => canvas.zoomBy(1.2),
      Minus: () => canvas.zoomBy(1 / 1.2), NumpadSubtract: () => canvas.zoomBy(1 / 1.2),
      Digit0: () => canvas.zoomReset(), Numpad0: () => canvas.zoomReset(),
      Quote: () => setGrid($('gridState').textContent !== 'On'),
      PageUp: () => stepPage(-1), PageDown: () => stepPage(1),
    };
    const action = byCode[e.code] || byKey[key];
    if (!action) return;
    e.preventDefault();
    action();
  }

  document.addEventListener('keydown', e => {
    if (help.open) return;
    if (e.key === 'Escape') { toggleMenu(false); toggleMore(false); if (phone.matches) toggleStyleSheet(false); closeContextMenu(); canvas.clearSelection(); return; }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.code === 'KeyS' || e.code === 'KeyO')) {
      e.preventDefault();
      return e.code === 'KeyS' ? saveToFile() : openFromFile();
    }
    if (isTyping(e.target) || e.metaKey) return;
    if (e.ctrlKey && e.altKey && e.code === 'KeyN') { e.preventDefault(); return addPage(); }
    if (e.ctrlKey && e.altKey && e.code === 'KeyC') { e.preventDefault(); return copyStyles(); }
    if (e.ctrlKey && e.altKey && e.code === 'KeyV') { e.preventDefault(); return pasteStyles(); }
    if (e.shiftKey && e.altKey && e.code === 'KeyC') { e.preventDefault(); return copyAsPng(); }
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      return setTheme(document.documentElement.dataset.theme !== 'dark');
    }
    if (e.altKey) return;
    if (e.ctrlKey) return ctrlShortcut(e);

    if (e.key === '?') return help.showModal();
    if (ARROWS[e.key] && canvas.getSelection()) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      return canvas.nudgeSelected(ARROWS[e.key][0] * step, ARROWS[e.key][1] * step);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return canvas.deleteSelected();
    if (e.key === 'Enter') { e.preventDefault(); return canvas.editSelected(); }
    if (e.shiftKey && e.code === 'Digit1') return canvas.zoomToFit();
    if (e.shiftKey && e.code === 'KeyL') return selectTool('lasso');
    if (e.shiftKey && canvas.getSelection() && (e.code === 'KeyH' || e.code === 'KeyV')) {
      return canvas.flipSelected(e.code === 'KeyH' ? 'x' : 'y');
    }
    if (e.key === '9') return $('imageFile').click();
    if (e.code === 'KeyQ' && !e.shiftKey) return setToolLock($('toolLock').getAttribute('aria-pressed') !== 'true');
    const tool = shortcuts[e.key.toLowerCase()];
    if (tool) selectTool(tool);
  });

  const CLIP_TYPE = 'sketchsaathi/elements';
  let pointerOnCanvas = false;
  $('canvas').addEventListener('pointerenter', () => { pointerOnCanvas = true; });
  $('canvas').addEventListener('pointerleave', () => { pointerOnCanvas = false; });

  let lastCopied = null;

  function copyTo(e) {
    if (isTyping(document.activeElement)) return false;
    const list = canvas.copySelection();
    if (!list.length) return false;
    lastCopied = JSON.stringify({ type: CLIP_TYPE, elements: list });
    e.clipboardData.setData('text/plain', lastCopied);
    e.preventDefault();
    return true;
  }
  document.addEventListener('copy', e => { if (copyTo(e)) ui.toast('Copied', 'success', 1400); });
  document.addEventListener('cut', e => { if (copyTo(e)) { canvas.deleteSelected(); ui.toast('Cut', 'success', 1400); } });
  document.addEventListener('paste', e => {
    if (isTyping(document.activeElement)) return;
    const imageFile = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
    if (imageFile) { e.preventDefault(); return addImageFile(imageFile, pointerOnCanvas); }
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    try {
      const data = JSON.parse(text);
      if (data && data.type === CLIP_TYPE) return canvas.pasteElements(data.elements, pointerOnCanvas);
    } catch {}
    canvas.pasteText(text);
  });

  const contextMenu = $('contextMenu');
  let copiedStyle = null;

  async function menuCopy(cut) {
    const list = canvas.copySelection();
    if (!list.length) return;
    lastCopied = JSON.stringify({ type: CLIP_TYPE, elements: list });
    try { await navigator.clipboard.writeText(lastCopied); } catch {}
    if (cut) canvas.deleteSelected();
    ui.toast(cut ? 'Cut' : 'Copied', 'success', 1400);
  }

  async function menuPaste() {
    const fromClipboard = navigator.clipboard && navigator.clipboard.readText
      ? navigator.clipboard.readText().catch(() => null) : Promise.resolve(null);
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), 400));
    const text = (await Promise.race([fromClipboard, timeout])) || lastCopied;
    if (!text) return ui.toast('Nothing to paste yet. Copy something first.', 'info');
    try {
      const data = JSON.parse(text);
      if (data && data.type === CLIP_TYPE) return canvas.pasteElements(data.elements, true);
    } catch {}
    canvas.pasteText(text);
  }

  async function copyAsPng() {
    const blob = await canvas.selectionToBlob();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      ui.toast('Copied as PNG', 'success', 1600);
    } catch {
      ui.toast('Your browser blocked copying images. Use Export PNG instead.', 'error');
    }
  }

  function copyStyles() {
    copiedStyle = canvas.getSelectionStyle();
    if (copiedStyle) ui.toast('Styles copied', 'success', 1400);
  }
  function pasteStyles() {
    if (!copiedStyle) return ui.toast('Copy styles from a shape first.', 'info');
    applyStyle(copiedStyle);
  }

  function closeContextMenu() {
    if (contextMenu.contains(document.activeElement)) document.activeElement.blur();
    contextMenu.hidden = true;
  }

  function openContextMenu({ clientX, clientY, locked }) {
    const many = canvas.getSelectedList().length;
    const items = locked ? [
      { label: 'Unlock', action: () => canvas.unlock(locked.id) },
    ] : many ? [
      { label: 'Cut', keys: 'Ctrl+X', action: () => menuCopy(true) },
      { label: 'Copy', keys: 'Ctrl+C', action: () => menuCopy(false) },
      { label: 'Paste', keys: 'Ctrl+V', action: menuPaste },
      '-',
      { label: 'Wrap selection in frame', action: () => canvas.wrapSelectionInFrame() },
      { label: 'Copy to clipboard as PNG', keys: 'Shift+Alt+C', action: copyAsPng },
      '-',
      { label: 'Copy styles', keys: 'Ctrl+Alt+C', action: copyStyles },
      { label: 'Paste styles', keys: 'Ctrl+Alt+V', action: pasteStyles, disabled: !copiedStyle },
      '-',
      { label: 'Send backward', keys: 'Ctrl+[', action: () => canvas.reorderSelected('backward') },
      { label: 'Bring forward', keys: 'Ctrl+]', action: () => canvas.reorderSelected('forward') },
      { label: 'Send to back', keys: 'Ctrl+Shift+[', action: () => canvas.reorderSelected('back') },
      { label: 'Bring to front', keys: 'Ctrl+Shift+]', action: () => canvas.reorderSelected('front') },
      '-',
      { label: 'Flip horizontal', keys: 'Shift+H', action: () => canvas.flipSelected('x') },
      { label: 'Flip vertical', keys: 'Shift+V', action: () => canvas.flipSelected('y') },
      '-',
      { label: 'Duplicate', keys: 'Ctrl+D', action: () => canvas.duplicateSelected() },
      { label: 'Lock', keys: 'Ctrl+Shift+L', action: () => canvas.lockSelected() },
      '-',
      { label: many > 1 ? `Delete ${many} shapes` : 'Delete', keys: 'Delete', danger: true, action: () => canvas.deleteSelected() },
    ] : [
      { label: 'Paste', keys: 'Ctrl+V', action: menuPaste },
      { label: 'Select all', keys: 'Ctrl+A', action: () => { selectTool('select'); canvas.selectAll(); }, disabled: canvas.isEmpty() },
      '-',
      { label: 'Zoom to fit', keys: 'Shift+1', action: () => canvas.zoomToFit(), disabled: canvas.isEmpty() },
      { label: 'Reset zoom', keys: 'Ctrl+0', action: () => canvas.zoomReset() },
      { label: $('gridState').textContent === 'On' ? 'Hide grid' : 'Show grid', keys: "Ctrl+'",
        action: () => setGrid($('gridState').textContent !== 'On') },
      '-',
      { label: 'Clear page', danger: true, action: clearPage, disabled: canvas.isEmpty() },
    ];

    contextMenu.innerHTML = '';
    items.forEach(item => {
      if (item === '-') {
        contextMenu.appendChild(Object.assign(document.createElement('hr'), { role: 'separator' }));
        return;
      }
      const button = document.createElement('button');
      button.className = 'context-item' + (item.danger ? ' danger' : '');
      button.setAttribute('role', 'menuitem');
      button.disabled = Boolean(item.disabled);
      button.innerHTML = '<span></span><kbd></kbd>';
      button.querySelector('span').textContent = item.label;
      button.querySelector('kbd').textContent = item.keys || '';
      button.addEventListener('click', () => { closeContextMenu(); item.action(); });
      contextMenu.appendChild(button);
    });

    contextMenu.hidden = false;
    const { offsetWidth: w, offsetHeight: h } = contextMenu;
    contextMenu.style.left = `${Math.min(clientX, innerWidth - w - 8)}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(clientY, innerHeight - h - 8))}px`;
    contextMenu.querySelector('.context-item:not(:disabled)')?.focus({ preventScroll: true });
  }

  canvas.on('contextmenu', openContextMenu);
  document.addEventListener('pointerdown', e => { if (!contextMenu.hidden && !contextMenu.contains(e.target)) closeContextMenu(); });
  contextMenu.addEventListener('contextmenu', e => e.preventDefault());
  contextMenu.addEventListener('keydown', e => {
    const items = [...contextMenu.querySelectorAll('.context-item:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(index + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeContextMenu(); }
  });
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('resize', closeContextMenu);

  const sendDrawing = event => collab.send({ ...event, page: pageId });

  canvas.on('add', element => sendDrawing({ type: 'add', element }));
  canvas.on('update', element => sendDrawing({ type: 'update', element }));
  canvas.on('remove', id => sendDrawing({ type: 'remove', id }));
  canvas.on('clear', () => sendDrawing({ type: 'clear' }));
  canvas.on('order', ids => sendDrawing({ type: 'order', ids }));
  canvas.on('cursor', ([x, y]) => collab.send({ type: 'cursor', x, y, page: pageId }));
  canvas.on('laser', ([x, y, start]) => collab.send({ type: 'laser', x, y, start, page: pageId }));
  canvas.on('change', () => scheduleSave());

  collab.onState(setStatus);
  collab.onEvent(event => {
    if (event.type === 'join') collab.send({ type: 'hello' });
    if (event.type === 'pages') return refreshPages();
    if (event.page && event.page !== pageId) {
      if (event.type === 'cursor') presence.handle({ ...event, type: 'hello' });
      return;
    }
    if (event.type === 'background') return showBackground(event.color);
    if (event.type === 'laser') {
      presence.handle({ ...event, type: 'hello' });
      return canvas.showRemoteLaser(event.cid, presence.colorFor(event.cid), event.x, event.y, event.start);
    }
    if (!presence.handle(event)) canvas.applyRemote(event);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) autoSave();
  });

  window.addEventListener('beforeunload', event => {
    // ask before leaving while changes are still unsaved, so nothing is lost by accident
    if (saveTimer || saving || saveFailed) {
      event.preventDefault();
      event.returnValue = '';
    }
    if (saveTimer && pageId) {
      fetch(`/api/pages/${pageId}/`, {
        method: 'PATCH',
        keepalive: true,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '',
        },
        body: JSON.stringify({ elements: canvas.getElements(), background: canvas.getBackground() }),
      });
    }
  });

  SketchSaathi.ready = true;
  const params = new URLSearchParams(location.search);
  const sharedBoard = (location.pathname.match(/^\/b\/([0-9a-f-]{36})\/?$/i) || [])[1];
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch {}
  canvas.resize();
  refreshPanel();
  newBoard();

  // sketches made without an account move into the account on first login
  async function importGuestWork() {
    const boards = SketchSaathi.localStore.boardsWithContent();
    if (!boards.length) { SketchSaathi.localStore.clear(); return null; }
    let lastBoard = null;
    for (const board of boards) {
      const created = await api.createBoard(board.title || 'Untitled');
      const [first, ...rest] = board.pages.sort((a, b) => a.position - b.position);
      await api.updatePage(created.pages[0].uuid, { name: first.name, elements: first.elements, background: first.background });
      for (const page of rest) {
        const added = await api.addPage(created.uuid, page.name);
        await api.updatePage(added.uuid, { elements: page.elements, background: page.background });
      }
      lastBoard = created.uuid;
    }
    SketchSaathi.localStore.clear();
    ui.toast(boards.length === 1 ? 'Your sketch is now saved in your account'
                                 : `${boards.length} sketches are now saved in your account`, 'success', 4500);
    return lastBoard;
  }

  (async () => {
    let imported = null;
    if (!GUEST) {
      try { imported = await importGuestWork(); } catch {
        ui.toast('Some sketches from this browser could not be moved to your account yet.', 'error', 5000);
      }
    }
    refreshBoardList().catch(() => ui.toast('Cannot reach the server. Is it running?', 'error', 5000));
    if (imported) return openBoard(imported);
    if (sharedBoard || params.get('board')) {
      return openBoard(sharedBoard || params.get('board'), params.get('page'))
        .catch(() => ui.toast('Board not found. It may have been deleted.', 'error', 5000));
    }
    if (last && last.board) {
      return openBoard(last.board, last.page).catch(() => {
        try { localStorage.removeItem(LAST_KEY); } catch {}
      });
    }
    if (GUEST) ui.toast('You’re sketching without an account – your work is saved in this browser.', 'info', 4500);
  })();
})();
