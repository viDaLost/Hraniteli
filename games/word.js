let data = null;
let idx = 0;
let locked = false;

const verseEl = document.getElementById("verse");
const refEl = document.getElementById("ref");
const optEl = document.getElementById("options");

document.getElementById("btn-next").addEventListener("click", () => {
  if (!data) return;
  idx = (idx + 1) % data.items.length;
  render();
});

async function load(){
  const r = await fetch("../data/word_game.json", { cache: "no-store" });
  data = await r.json();
  render();
}

function render(){
  locked = false;
  optEl.innerHTML = "";

  const item = data.items[idx];
  verseEl.textContent = item.text;
  refEl.textContent = item.ref;

  const options = shuffle([item.answer, ...item.wrong]);
  options.forEach(w => {
    const b = document.createElement("button");
    b.className = "btn tile option";
    b.textContent = w;
    b.addEventListener("click", () => choose(b, w === item.answer));
    optEl.appendChild(b);
  });
}

function choose(btn, ok){
  if (locked) return;
  locked = true;
  btn.classList.add(ok ? "ok" : "bad");

  // подсветим правильный вариант
  if (!ok){
    [...optEl.children].forEach(b => {
      if (b.textContent === data.items[idx].answer) b.classList.add("ok");
    });
  }
}

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

load();
