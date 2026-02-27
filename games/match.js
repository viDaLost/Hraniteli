// games/match.js (SPA version)
// Exposes window.MatchGame.init() and window.MatchGame.reset()

(function(){
  const animals = [
    "🦁","🐯","🐵","🐼","🐸","🐰","🦊","🐻","🐨","🐷","🐮","🐔",
    "🦉","🦄","🐙","🐢","🦋","🐬","🐟","🦓","🦒","🐘","🦜","🦀",
    "🐝","🐍","🦌","🐴","🐱","🐶","🐧","🦦"
  ];

  let pick, game, boardEl, win;
  let first = null;
  let second = null;
  let lock = false;
  let matched = 0;
  let totalPairs = 0;

  let hImpact = () => {};
  let hNotify = () => {};
  let hSelect = () => {};

  function qs(id){ return document.getElementById(id); }

  function init(deps = {}){
    hImpact = deps.hImpact || hImpact;
    hNotify = deps.hNotify || hNotify;
    hSelect = deps.hSelect || hSelect;

    pick = qs("match-pick");
    game = qs("match-game");
    boardEl = qs("match-board");
    win = qs("match-win");

    qs("match-btn-back")?.addEventListener("click", () => {
      hImpact("light");
      game.classList.add("hidden");
      pick.classList.remove("hidden");
      boardEl.innerHTML = "";
    });

    qs("match-btn-win-close")?.addEventListener("click", () => {
      hNotify("success");
      win.classList.add("hidden");
      game.classList.add("hidden");
      pick.classList.remove("hidden");
      boardEl.innerHTML = "";
    });

    pick?.querySelectorAll("[data-match-size]")?.forEach(btn => {
      btn.addEventListener("click", () => {
        hSelect();
        start(Number(btn.dataset.matchSize));
      });
    });

    reset();
  }

  function reset(){
    if (!pick || !game || !boardEl) return;
    game.classList.add("hidden");
    pick.classList.remove("hidden");
    if (win) win.classList.add("hidden");
    boardEl.innerHTML = "";
    first = null;
    second = null;
    lock = false;
    matched = 0;
    totalPairs = 0;
  }

  function start(size){
    pick.classList.add("hidden");
    game.classList.remove("hidden");

    const totalCards = size * size;
    totalPairs = totalCards / 2;
    matched = 0;
    first = null;
    second = null;
    lock = false;

    const pool = animals.slice(0, totalPairs);
    const deck = shuffle([...pool, ...pool]);

    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.innerHTML = "";

    deck.forEach((emoji) => {
      const tile = document.createElement("div");
      tile.className = "card-tile";
      tile.dataset.emoji = emoji;
      tile.dataset.open = "0";
      tile.dataset.done = "0";
      tile.textContent = "❓";

      tile.addEventListener("click", () => onFlip(tile));
      boardEl.appendChild(tile);
    });

    hImpact("medium");
  }

  function onFlip(tile){
    if (lock) return;
    if (tile.dataset.done === "1") return;
    if (tile.dataset.open === "1") return;

    openTile(tile);
    hSelect();

    if (!first){
      first = tile;
      return;
    }

    second = tile;
    lock = true;

    const a = first.dataset.emoji;
    const b = second.dataset.emoji;

    if (a === b){
      markDone(first);
      markDone(second);
      matched++;
      hImpact("light");
      resetTurn();

      if (matched === totalPairs){
        setTimeout(() => {
          win.classList.remove("hidden");
          hNotify("success");
        }, 320);
      }
    } else {
      first.classList.add("wrong","shake");
      second.classList.add("wrong","shake");
      hNotify("error");

      setTimeout(() => {
        first.classList.remove("wrong","shake");
        second.classList.remove("wrong","shake");
        closeTile(first);
        closeTile(second);
        resetTurn();
      }, 650);
    }
  }

  function resetTurn(){
    first = null;
    second = null;
    lock = false;
  }

  function openTile(tile){
    tile.dataset.open = "1";
    tile.textContent = tile.dataset.emoji;
  }

  function closeTile(tile){
    tile.dataset.open = "0";
    tile.textContent = "❓";
  }

  function markDone(tile){
    tile.dataset.done = "1";
    tile.classList.add("done");
  }

  function shuffle(arr){
    for (let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  window.MatchGame = { init, reset };
})();
