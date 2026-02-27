// games/word.js (SPA version)
// Exposes window.WordGame.init()

(function(){
  let data = null;
  let idx = 0;
  let locked = false;

  let verseEl, refEl, optEl, nextBtn;

  let hImpact = () => {};
  let hNotify = () => {};
  let hSelect = () => {};

  async function init(deps = {}){
    hImpact = deps.hImpact || hImpact;
    hNotify = deps.hNotify || hNotify;
    hSelect = deps.hSelect || hSelect;

    verseEl = document.getElementById("word-verse");
    refEl = document.getElementById("word-ref");
    optEl = document.getElementById("word-options");
    nextBtn = document.getElementById("word-btn-next");

    if (nextBtn && !nextBtn.dataset.bound){
      nextBtn.dataset.bound = "1";
      nextBtn.addEventListener("click", () => {
        if (!data) return;
        hSelect();
        idx = (idx + 1) % data.items.length;
        render();
      });
    }

    if (!data) await load();
    else render();
  }

  async function load(){
    const r = await fetch("data/word_game.json", { cache: "no-store" });
    data = await r.json();
    idx = 0;
    render();
  }

  function render(){
    if (!data || !verseEl || !refEl || !optEl) return;

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

    if (ok){
      hNotify("success");
      hImpact("light");
      return;
    }

    hNotify("error");

    [...optEl.children].forEach(b => {
      if (b.textContent === data.items[idx].answer) b.classList.add("ok");
    });
  }

  function shuffle(arr){
    for (let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  window.WordGame = { init };
})();
