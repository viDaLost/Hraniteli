(function(){
  let hImpact = () => {};
  let hNotify = () => {};
  let hSelect = () => {};

  let data = [];
  let activePuzzle = null;
  let gridSize = 3;
  let moves = 0;
  let startedAt = 0;
  let pieces = [];
  let dragState = null;
  let timerId = null;

  let screenEl, headerEl, pickerCardEl,
    boardEl, listEl, titleEl, metaEl, previewEl, startEl, gameEl, finishEl, infoEl,
    winImageEl, captionEl, trayEl, referenceEl, completeEl, trayHintEl;

  const preventTouchScroll = (ev) => {
    if (dragState) ev.preventDefault();
  };

  const preventWheelScroll = (ev) => {
    if (dragState) ev.preventDefault();
  };

  function qs(id){ return document.getElementById(id); }

  async function init(deps = {}){
    hImpact = deps.hImpact || hImpact;
    hNotify = deps.hNotify || hNotify;
    hSelect = deps.hSelect || hSelect;

    screenEl = qs('screen-puzzle');
    headerEl = qs('puzzle-header');
    pickerCardEl = qs('puzzle-picker-card');
    boardEl = qs('puzzle-board');
    listEl = qs('puzzle-list');
    titleEl = qs('puzzle-title');
    metaEl = qs('puzzle-meta');
    previewEl = qs('puzzle-preview');
    startEl = qs('puzzle-start');
    gameEl = qs('puzzle-game');
    finishEl = qs('puzzle-finish');
    infoEl = qs('puzzle-info');
    winImageEl = qs('puzzle-win-image');
    captionEl = qs('puzzle-caption');
    trayEl = qs('puzzle-tray');
    referenceEl = qs('puzzle-reference');
    completeEl = qs('puzzle-complete');
    trayHintEl = qs('puzzle-tray-hint');

    bindOnce('puzzle-btn-restart', 'click', () => {
      if (!activePuzzle) return;
      hImpact('light');
      startGame(activePuzzle, gridSize);
    });
    bindOnce('puzzle-btn-change', 'click', () => {
      hImpact('light');
      showPicker();
    });
    bindOnce('puzzle-btn-win-close', 'click', () => {
      finishEl?.classList.add('hidden');
      hNotify('success');
    });

    if (trayEl && !trayEl.dataset.boundScroll) {
      trayEl.dataset.boundScroll = '1';
      trayEl.addEventListener('scroll', updateTrayHint, { passive: true });
    }

    document.querySelectorAll('[data-puzzle-size]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!activePuzzle) return;
        hSelect();
        startGame(activePuzzle, Number(btn.dataset.puzzleSize || 3));
      });
    });

    await loadList();
    renderList();
    showPicker();
  }

  async function loadList(){
    try {
      const r = await fetch('data/puzzles.json', { cache: 'no-store' });
      const json = await r.json();
      data = Array.isArray(json?.items) ? json.items : [];
    } catch(e) {
      console.error('Ошибка загрузки списка пазлов:', e);
      data = [];
    }
  }

  function bindOnce(id, event, fn){
    const el = qs(id);
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener(event, fn);
  }

  function renderList(){
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!data.length) {
      listEl.innerHTML = '<div class="card card-soft"><p class="muted center">В папке <b>assets/puzzles</b> пока нет изображений. Добавь файл и GitHub Action сам обновит список пазлов.</p></div>';
      return;
    }

    data.forEach((item, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'puzzle-card';
      card.innerHTML = `
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="puzzle-card-image">
        <div class="puzzle-card-body">
          <div class="puzzle-card-title">${escapeHtml(item.title)}</div>
          <div class="puzzle-card-sub">${escapeHtml(item.theme || 'Библейский пазл')}</div>
        </div>`;
      card.addEventListener('click', () => {
        hSelect();
        pickPuzzle(idx);
      });
      listEl.appendChild(card);
    });

    if (data[0] && !activePuzzle) pickPuzzle(0);
  }

  function pickPuzzle(idx){
    activePuzzle = data[idx] || null;
    if (!activePuzzle) return;
    titleEl.textContent = activePuzzle.title || 'Пазл';
    metaEl.textContent = activePuzzle.verse || activePuzzle.theme || 'Собери картинку целиком';
    previewEl.src = activePuzzle.image;
    previewEl.alt = activePuzzle.title || 'Пазл';
    if (referenceEl) {
      referenceEl.src = activePuzzle.image;
      referenceEl.alt = activePuzzle.title || 'Пазл';
    }
    captionEl.textContent = activePuzzle.caption || activePuzzle.theme || '';
    showPicker();
  }

  function showPicker(){
    startEl?.classList.remove('hidden');
    gameEl?.classList.add('hidden');
    screenEl?.classList.remove('puzzle-playing', 'drag-lock');
    document.documentElement.classList.remove('drag-lock');
    document.body.classList.remove('drag-lock');
    headerEl?.classList.remove('hidden');
    pickerCardEl?.classList.remove('hidden');
    stopDrag();
    stopTimer();
    
    // Возвращаем свайпы для главного меню
    try { 
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.enableVerticalSwipes(); 
      }
    } catch (e) {}
  }

  function startGame(item, size){
    if (!item || !boardEl || !trayEl) return;
    activePuzzle = item;
    gridSize = size;
    moves = 0;
    startedAt = Date.now();
    pieces = createPieces(size);

    startEl?.classList.add('hidden');
    gameEl?.classList.remove('hidden');
    finishEl?.classList.add('hidden');
    completeEl?.classList.add('hidden');
    if(completeEl) completeEl.style.backgroundImage = `url("${item.image}")`;
    if(referenceEl) referenceEl.src = item.image;
    
    screenEl?.classList.add('puzzle-playing');
    headerEl?.classList.add('hidden');
    pickerCardEl?.classList.add('hidden');

    renderBoard();
    renderTray();
    updateInfo();
    startTimer();
    
    requestAnimationFrame(() => { 
      trayEl?.scrollTo({ left: 0, top: 0 }); 
      updateTrayHint(); 
    });

    // Настройки Telegram Web App для экрана игры
    try { 
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.expand();
        window.Telegram.WebApp.disableVerticalSwipes(); 
      }
    } catch (e) {}
    
    hImpact('medium');
  }

  function createPieces(size){
    const total = size * size;
    const arr = Array.from({ length: total }, (_, i) => ({
      id: i,
      slot: i,
      placed: false,
    }));
    shuffle(arr);
    return arr;
  }

  function shuffle(arr){
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function renderBoard(){
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--puzzle-size', String(gridSize));
    const frag = document.createDocumentFragment();
    for (let i = 0; i < gridSize * gridSize; i++) {
      const slot = document.createElement('div');
      slot.className = 'puzzle-slot';
      slot.dataset.slot = String(i);
      const piece = pieces.find(p => p.placed && p.slot === i);
      if (piece) slot.appendChild(createPieceEl(piece, true));
      frag.appendChild(slot);
    }
    boardEl.appendChild(frag);
  }

  function renderTray(){
    trayEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    pieces.filter(p => !p.placed).forEach(piece => frag.appendChild(createPieceEl(piece, false)));
    trayEl.appendChild(frag);
    requestAnimationFrame(updateTrayHint);
  }

  function createPieceEl(piece, locked){
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'puzzle-piece' + (locked ? ' locked' : '');
    el.dataset.pieceId = String(piece.id);
    applyPieceImage(el, piece.id);
    if (!locked) {
      el.addEventListener('pointerdown', onPiecePointerDown);
    }
    return el;
  }

  function applyPieceImage(el, pieceId){
    const row = Math.floor(pieceId / gridSize);
    const col = pieceId % gridSize;
    const step = gridSize > 1 ? 100 / (gridSize - 1) : 100;
    el.style.backgroundImage = `url("${activePuzzle.image}")`;
    el.style.backgroundSize = `${gridSize * 100}% ${gridSize * 100}%`;
    el.style.backgroundPosition = `${col * step}% ${row * step}%`;
  }

  function onPiecePointerDown(ev){
    const sourceEl = ev.currentTarget;
    const pieceId = Number(sourceEl.dataset.pieceId);
    const piece = pieces.find(p => p.id === pieceId && !p.placed);
    if (!piece) return;

    ev.preventDefault();
    const rect = sourceEl.getBoundingClientRect();
    const ghost = sourceEl.cloneNode(true);
    
    // Копируем стили фона для призрака
    ghost.style.backgroundImage = sourceEl.style.backgroundImage;
    ghost.style.backgroundSize = sourceEl.style.backgroundSize;
    ghost.style.backgroundPosition = sourceEl.style.backgroundPosition;
    
    ghost.classList.add('dragging');
    ghost.style.position = 'fixed';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);
    sourceEl.classList.add('holding');
    
    try { sourceEl.setPointerCapture(ev.pointerId); } catch {}
    
    screenEl?.classList.add('drag-lock');
    document.body.classList.add('drag-lock');
    document.documentElement.classList.add('drag-lock');
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    document.addEventListener('wheel', preventWheelScroll, { passive: false });

    dragState = {
      pieceId,
      sourceEl,
      ghost,
      offsetX: ev.clientX - rect.left,
      offsetY: ev.clientY - rect.top,
      overSlot: null,
    };

    moveGhost(ev.clientX, ev.clientY);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false, once: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: false, once: true });
    hSelect();
  }

  function onPointerMove(ev){
    if (!dragState) return;
    ev.preventDefault();
    moveGhost(ev.clientX, ev.clientY);
    updateHoveredSlot(ev.clientX, ev.clientY, dragState.pieceId);
  }

  function moveGhost(clientX, clientY){
    const { ghost, offsetX, offsetY } = dragState;
    ghost.style.left = (clientX - offsetX) + 'px';
    ghost.style.top = (clientY - offsetY) + 'px';
  }

  function updateHoveredSlot(clientX, clientY, pieceId){
    const elements = document.elementsFromPoint(clientX, clientY);
    let hovered = null;
    for (let el of elements) {
      if (el.classList.contains('puzzle-slot')) {
        hovered = el;
        break;
      }
    }
    
    document.querySelectorAll('.puzzle-slot.hover-ok, .puzzle-slot.hover-bad').forEach(el => el.classList.remove('hover-ok', 'hover-bad'));
    dragState.overSlot = null;
    
    if (!hovered) return;
    
    const slotIndex = Number(hovered.dataset.slot);
    const piece = pieces.find(p => p.id === pieceId);
    if (!piece) return;
    
    const occupied = pieces.some(p => p.placed && p.slot === slotIndex);
    const ok = !occupied && slotIndex === piece.id;
    hovered.classList.add(ok ? 'hover-ok' : 'hover-bad');
    dragState.overSlot = hovered;
  }

  function onPointerUp(ev){
    if (!dragState) return;
    ev.preventDefault();
    updateHoveredSlot(ev.clientX, ev.clientY, dragState.pieceId);

    const { pieceId, sourceEl, ghost, overSlot } = dragState;
    sourceEl.classList.remove('holding');
    ghost.remove();
    document.querySelectorAll('.puzzle-slot.hover-ok, .puzzle-slot.hover-bad').forEach(el => el.classList.remove('hover-ok', 'hover-bad'));
    window.removeEventListener('pointermove', onPointerMove);

    const piece = pieces.find(p => p.id === pieceId);
    const slotIndex = overSlot ? Number(overSlot.dataset.slot) : -1;
    const occupied = pieces.some(p => p.placed && p.slot === slotIndex);

    if (piece && slotIndex === piece.id && !occupied) {
      piece.placed = true;
      piece.slot = slotIndex;
      moves += 1;
      renderBoard();
      renderTray();
      updateInfo();
      hImpact('light');
      if (isSolved()) onWin();
    } else {
      hImpact('rigid');
    }

    stopDrag();
  }

  function stopDrag(){
    if (dragState?.sourceEl) dragState.sourceEl.classList.remove('holding');
    if (dragState?.ghost) dragState.ghost.remove();
    dragState = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointercancel', onPointerUp);
    document.removeEventListener('touchmove', preventTouchScroll);
    document.removeEventListener('wheel', preventWheelScroll);
    document.querySelectorAll('.puzzle-slot.hover-ok, .puzzle-slot.hover-bad').forEach(el => el.classList.remove('hover-ok', 'hover-bad'));
    screenEl?.classList.remove('drag-lock');
    document.body.classList.remove('drag-lock');
    document.documentElement.classList.remove('drag-lock');
  }

  function updateTrayHint(){
    if (!trayEl || !trayHintEl) return;
    const canScrollX = trayEl.scrollWidth - trayEl.clientWidth > 16;
    const atStart = trayEl.scrollLeft <= 8;
    const atEnd = trayEl.scrollLeft + trayEl.clientWidth >= trayEl.scrollWidth - 8;
    trayHintEl.hidden = !canScrollX;
    trayEl.classList.toggle('is-scrollable', canScrollX);
    trayEl.classList.toggle('show-left-fade', canScrollX && !atStart);
    trayEl.classList.toggle('show-right-fade', canScrollX && !atEnd);
    trayHintEl.textContent = atStart ? 'Листай детали вбок →' : (atEnd ? '← Можно листать назад' : '← Листай в обе стороны →');
  }

  function isSolved(){
    return pieces.length > 0 && pieces.every(p => p.placed && p.slot === p.id);
  }

  function onWin(){
    stopTimer();
    boardEl.classList.add('solved');
    completeEl?.classList.remove('hidden');
    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    qs('puzzle-win-title').textContent = `Готово! ${activePuzzle?.title || 'Пазл'} собран.`;
    qs('puzzle-win-meta').textContent = `Деталей: ${gridSize * gridSize} • Ходы: ${moves} • Время: ${formatTime(secs)}`;
    winImageEl.src = activePuzzle.image;
    winImageEl.alt = activePuzzle.title || 'Собранный пазл';
    finishEl?.classList.remove('hidden');
    hNotify('success');
  }

  function updateInfo(){
    if (!infoEl) return;
    const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const left = pieces.filter(p => !p.placed).length;
    infoEl.textContent = `Осталось: ${left} • Ходы: ${moves} • Время: ${formatTime(secs)}`;
  }

  function startTimer(){
    stopTimer();
    boardEl.classList.remove('solved');
    timerId = setInterval(updateInfo, 1000);
  }

  function stopTimer(){
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function formatTime(secs){
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
  }

  window.PuzzleGame = { init };
})();
