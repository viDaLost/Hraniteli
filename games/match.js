const pick = document.getElementById("screen-pick");
const game = document.getElementById("screen-game");
const boardEl = document.getElementById("board");
const win = document.getElementById("win");

document.getElementById("btn-back").addEventListener("click", () => {
  game.classList.add("hidden");
  pick.classList.remove("hidden");
  boardEl.innerHTML = "";
});

document.getElementById("btn-win-close").addEventListener("click", () => {
  win.classList.add("hidden");
  game.classList.add("hidden");
  pick.classList.remove("hidden");
  boardEl.innerHTML = "";
});

pick.querySelectorAll("[data-size]").forEach(btn => {
  btn.addEventListener("click", () => start(Number(btn.dataset.size)));
});

const animals = ["🦁","🐯","🐵","🐼","🐸","🐰","🦊","🐻","🐨","🐷","🐮","🐔","🦉","🦄","🐙","🐢","🦋","🐬","🐟","🦓","🦒","🐘","🦜","🦀","🐝","🐍","🦌","🐴","🐱","🐶","🐧","🦦"];

let first = null;
let second = null;
let lock = false;
let matched = 0;
let totalPairs = 0;

function start(size){
  pick.classList.add("hidden");
  game.classList.remove("hidden");

  const totalCards = size * size;
  totalPairs = totalCards / 2;
  matched = 0;
  first = null;
  second = null;
  lock = false;

  // choose N pairs, duplicate, shuffle
  const pool = animals.slice(0, totalPairs);
  const deck = shuffle([...pool, ...pool]);

  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.innerHTML = "";

  deck.forEach((emoji, idx) => {
    const tile = document.createElement("div");
    tile.className = "card-tile";
    tile.dataset.emoji = emoji;
    tile.dataset.open = "0";
    tile.dataset.done = "0";
    tile.textContent = "❓";

    tile.addEventListener("click", () => onFlip(tile));
    boardEl.appendChild(tile);
  });
}

function onFlip(tile){
  if (lock) return;
  if (tile.dataset.done === "1") return;
  if (tile.dataset.open === "1") return;

  openTile(tile);

  if (!first){
    first = tile;
    return;
  }

  second = tile;
  lock = true;

  const a = first.dataset.emoji;
  const b = second.dataset.emoji;

  if (a === b){
    // match
    markDone(first);
    markDone(second);
    matched++;
    resetTurn();

    if (matched === totalPairs){
      setTimeout(() => win.classList.remove("hidden"), 350);
    }
  } else {
    // wrong
    first.classList.add("wrong","shake");
    second.classList.add("wrong","shake");

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
