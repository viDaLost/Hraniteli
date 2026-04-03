(function(){
  let hImpact = () => {};
  let hNotify = () => {};
  let hSelect = () => {};

  let data = [];
  let activePuzzle = null;
  let gridSize = 3;
  let emptyIndex = 0;
  let moves = 0;
  let startedAt = 0;
  let board = [];
  let boardEl, listEl, titleEl, metaEl, previewEl, startEl, gameEl, finishEl, infoEl, winImageEl, captionEl;
  let selectedIndex = -1;

  function qs(id){ return document.getElementById(id); }

  async function init(deps = {}){
    hImpact = deps.hImpact || hImpact;
    hNotify = deps.hNotify || hNotify;
    hSelect = deps.hSelect || hSelect;

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

    document.querySelectorAll('[data-puzzle-size]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!activePuzzle) return;
        hSelect();
        startGame(activePuzzle, Number(btn.dataset.puzzleSize || 3));
      });
    });

    boardEl?.addEventListener('click', onBoardClick);

    await loadList();
    renderList();
    showPicker();
  }

  async function loadList(){
    const r = await fetch('data/puzzles.json', { cache: 'no-store' });
    const json = await r.json();
    data = Array.isArray(json?.items) ? json.items : [];
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
    captionEl.textContent = activePuzzle.caption || activePuzzle.theme || '';
    showPicker();
  }

  function showPicker(){
    startEl?.classList.remove('hidden');
    gameEl?.classList.add('hidden');
  }

  function startGame(item, size){
    if (!item || !boardEl) return;
    activePuzzle = item;
    gridSize = size;
    selectedIndex = -1;
    moves = 0;
    startedAt = Date.now();
    emptyIndex = size * size - 1;
    board = Array.from({ length: size * size }, (_, i) => i);

    do {
      shuffleBoard();
    } while (!isSolvable(board, size) || isSolved());

    startEl?.classList.add('hidden');
    gameEl?.classList.remove('hidden');
    finishEl?.classList.add('hidden');

    renderBoard();
    updateInfo();
    hImpact('medium');
  }

  function shuffleBoard(){
    for (let i = board.length - 2; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [board[i], board[j]] = [board[j], board[i]];
    }
    board[board.length - 1] = emptyIndex;
  }

  function isSolved(){
    return board.every((v, i) => v === i);
  }

  function onBoardClick(e){
    const tile = e.target.closest('.puzzle-tile');
    if (!tile || tile.dataset.empty === '1') return;
    const index = Number(tile.dataset.index);
    if (!Number.isFinite(index)) return;

    if (canMove(index)) {
      moveTile(index);
      return;
    }

    if (selectedIndex === index) {
      selectedIndex = -1;
      renderBoard();
      return;
    }

    const canSelect = canReachEmptyByLine(index);
    if (canSelect) {
      selectedIndex = index;
      renderBoard();
      hSelect();
    }
  }

  function canMove(index){
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    const erow = Math.floor(emptyIndex / gridSize);
    const ecol = emptyIndex % gridSize;
    return (row === erow && Math.abs(col - ecol) === 1) || (col === ecol && Math.abs(row - erow) === 1);
  }

  function canReachEmptyByLine(index){
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    const erow = Math.floor(emptyIndex / gridSize);
    const ecol = emptyIndex % gridSize;
    return row === erow || col === ecol;
  }

  function moveTile(index){
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    const erow = Math.floor(emptyIndex / gridSize);
    const ecol = emptyIndex % gridSize;

    const indices = [];
    if (row === erow) {
      const dir = col < ecol ? 1 : -1;
      for (let c = ecol - dir; c !== col - dir; c -= dir) indices.push(row * gridSize + c);
    } else if (col === ecol) {
      const dir = row < erow ? 1 : -1;
      for (let r = erow - dir; r !== row - dir; r -= dir) indices.push(r * gridSize + col);
    } else {
      return;
    }

    for (let i = 0; i < indices.length; i++) {
      const src = indices[i];
      const dst = i === 0 ? emptyIndex : indices[i - 1];
      [board[dst], board[src]] = [board[src], board[dst]];
    }

    emptyIndex = index;
    selectedIndex = -1;
    moves += 1;
    renderBoard();
    updateInfo();
    hImpact('light');

    if (isSolved()) onWin();
  }

  function onWin(){
    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    qs('puzzle-win-title').textContent = `Готово! ${activePuzzle?.title || 'Пазл'} собран.`;
    qs('puzzle-win-meta').textContent = `Ходов: ${moves} • Время: ${formatTime(secs)} • Сетка: ${gridSize}×${gridSize}`;
    winImageEl.src = activePuzzle.image;
    winImageEl.alt = activePuzzle.title || 'Собранный пазл';
    finishEl?.classList.remove('hidden');
    hNotify('success');
  }

  function updateInfo(){
    if (!infoEl) return;
    const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    infoEl.textContent = `Сетка ${gridSize}×${gridSize} • Ходы: ${moves} • Время: ${formatTime(secs)}`;
  }

  function renderBoard(){
    if (!boardEl || !activePuzzle) return;
    boardEl.style.setProperty('--puzzle-size', String(gridSize));
    boardEl.innerHTML = '';

    const step = 100 / (gridSize - 1 || 1);

    board.forEach((piece, index) => {
      const isEmpty = piece === gridSize * gridSize - 1;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'puzzle-tile' + (isEmpty ? ' empty' : '') + (selectedIndex === index ? ' selected' : '');
      tile.dataset.index = String(index);
      tile.dataset.empty = isEmpty ? '1' : '0';
      tile.style.width = '100%';
      tile.style.aspectRatio = '1 / 1';

      if (!isEmpty) {
        const pieceRow = Math.floor(piece / gridSize);
        const pieceCol = piece % gridSize;
        tile.style.backgroundImage = `url("${activePuzzle.image}")`;
        tile.style.backgroundSize = `${gridSize * 100}% ${gridSize * 100}%`;
        tile.style.backgroundPosition = `${pieceCol * step}% ${pieceRow * step}%`;
      }

      boardEl.appendChild(tile);
    });
  }

  function isSolvable(arr, size){
    const values = arr.filter(v => v !== size * size - 1);
    let inversions = 0;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (values[i] > values[j]) inversions++;
      }
    }
    if (size % 2 === 1) return inversions % 2 === 0;
    const blankRowFromBottom = size - Math.floor(arr.indexOf(size * size - 1) / size);
    return blankRowFromBottom % 2 === 0 ? inversions % 2 === 1 : inversions % 2 === 0;
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
