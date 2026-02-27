// app.js (SPA + animations + Telegram haptics)

// ❗ ВАЖНО: сюда вставь Web app URL ИЗ ТОГО Apps Script, где ты поменял verifyTelegramInitData_()
// Deploy -> Manage deployments -> Web app URL (заканчивается на /exec)
const GAS_URL = "https://script.google.com/macros/s/AKfycbyXbnpE6gEiaLbLM23GpzSbyXhWwZShVEVYTJxJ2agSEB2-ytDBBdji5T9WA8zcJ5R4/exec";
const POLL_MS = 10_000;

const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

const $ = (id) => document.getElementById(id);

const viewport = $("viewport");

const screens = {
  loading: $("screen-loading"),
  onboarding: $("screen-onboarding"),
  hello: $("screen-hello"),
  menu: $("screen-menu"),
  games: $("screen-games"),
  match: $("screen-match"),
  word: $("screen-word"),
  admin: $("screen-admin"),
};

const modalHomework = $("modal-homework");
const modalProfile = $("modal-profile");

const state = {
  tgId: null,
  initData: "",
  isAdmin: false,
  profile: null,
};

let pollTimer = null;
let navStack = []; // {route}
let isTransitioning = false;

// -----------------------
// Telegram Haptics helpers
// -----------------------
function hImpact(style = "light") {
  try { tg?.HapticFeedback?.impactOccurred?.(style); } catch {}
}
function hNotify(type = "success") {
  try { tg?.HapticFeedback?.notificationOccurred?.(type); } catch {}
}
function hSelect() {
  try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
}

// -----------------------
// Small UI helpers
// -----------------------
function showModal(el){ el.classList.remove("hidden"); }
function hideModal(el){ el.classList.add("hidden"); }
function isVisible(el){ return el && !el.classList.contains("hidden"); }

function bindModalClose(modalEl, closeBtnEl){
  if (!modalEl || !closeBtnEl) return;

  const close = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    hImpact("light");
    hideModal(modalEl);
  };

  closeBtnEl.addEventListener("click", close);
  closeBtnEl.addEventListener("touchend", close, { passive: false });

  modalEl.addEventListener("click", (ev) => {
    if (ev.target === modalEl) hideModal(modalEl);
  });
  modalEl.addEventListener("touchend", (ev) => {
    if (ev.target === modalEl) hideModal(modalEl);
  }, { passive: true });
}

function localGet(key){ return localStorage.getItem(key) || ""; }
function localSet(key,val){ localStorage.setItem(key, String(val)); }

function getTelegramIdentity(){
  if (!tg) return null;
  const u = tg.initDataUnsafe?.user;
  if (!u?.id) return null;
  return { id: String(u.id) };
}

/**
 * ✅ Самый стабильный запрос для iOS Telegram WebView:
 * - НИКАКИХ headers (чтобы не было preflight/OPTIONS)
 * - redirect follow
 * - таймаут
 */
async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action,
        initData: state.initData,
        ...payload,
      }),
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Сервер вернул не-JSON: " + text.slice(0, 160));
    }

    if (!data.ok) throw new Error(data.error || "API error");
    return data;

  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Таймаут запроса (15с)");
    throw new Error(e?.message || "Load failed");
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

// -----------------------
// SPA Router + Transitions
// -----------------------
function routeFromHash(){
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return "menu";
  const parts = h.split("/").filter(Boolean);
  return parts[0] || "menu";
}

function canAccess(route){
  const hasProfile = !!(state.profile?.name && state.profile?.dob);
  if (hasProfile) return true;
  return ["onboarding","hello","loading"].includes(route);
}

function setActiveScreen(route, direction = "forward"){
  const next = screens[route];
  if (!next) return;

  const currentRoute = navStack.length ? navStack[navStack.length - 1].route : null;
  const current = currentRoute ? screens[currentRoute] : null;

  if (current === next) {
    Object.values(screens).forEach(s => s?.classList?.add("hidden"));
    next.classList.remove("hidden");
    next.classList.add("is-active");
    return;
  }

  if (isTransitioning) return;
  isTransitioning = true;

  Object.values(screens).forEach(s => {
    if (!s) return;
    if (s !== current && s !== next) {
      s.classList.add("hidden");
      s.classList.remove("is-active","is-entering","is-leaving","slide-in-from-right","slide-in-from-left","slide-out-to-left","slide-out-to-right");
    }
  });

  if (current) {
    current.classList.remove("hidden");
    current.classList.add("is-active");
  }

  next.classList.remove("hidden");

  next.classList.remove("is-active","is-entering","is-leaving","slide-in-from-right","slide-in-from-left","slide-out-to-left","slide-out-to-right");
  if (direction === "back") {
    next.classList.add("slide-in-from-left");
    if (current) current.classList.add("slide-out-to-right");
  } else {
    next.classList.add("slide-in-from-right");
    if (current) current.classList.add("slide-out-to-left");
  }

  void next.offsetWidth;

  next.classList.add("is-entering");
  if (current) current.classList.add("is-leaving");

  requestAnimationFrame(() => {
    next.classList.add("is-active");
    next.classList.remove("slide-in-from-right","slide-in-from-left");
    if (current) {
      current.classList.remove("is-active");
      current.classList.remove("slide-out-to-left","slide-out-to-right");
    }
  });

  const done = () => {
    next.classList.remove("is-entering");
    if (current) {
      current.classList.add("hidden");
      current.classList.remove("is-leaving");
    }
    isTransitioning = false;
  };

  let settled = false;
  const onEnd = (ev) => {
    if (ev.target !== next) return;
    if (settled) return;
    settled = true;
    next.removeEventListener("transitionend", onEnd);
    done();
  };
  next.addEventListener("transitionend", onEnd);
  setTimeout(() => {
    if (settled) return;
    settled = true;
    next.removeEventListener("transitionend", onEnd);
    done();
  }, 520);
}

function navigate(route, { replace = false } = {}){
  if (!screens[route]) route = "menu";

  if (!canAccess(route)) {
    route = "onboarding";
  }

  const current = navStack.length ? navStack[navStack.length - 1].route : null;
  const direction = (replace || !current) ? "forward" : "forward";

  if (replace) {
    if (navStack.length) navStack[navStack.length - 1] = { route };
    else navStack.push({ route });
  } else {
    if (current !== route) navStack.push({ route });
  }

  const newHash = `#${route}`;
  if (replace) history.replaceState({ route }, "", newHash);
  else history.pushState({ route }, "", newHash);

  setActiveScreen(route, direction);
  onRouteEnter(route);
}

function goBack(){
  if (navStack.length <= 1) {
    if (navStack[0]?.route !== "menu") navigate("menu", { replace: true });
    return;
  }

  const current = navStack[navStack.length - 1]?.route;
  if (current === "match") window.MatchGame?.reset?.();
  history.back();
}

window.addEventListener("popstate", () => {
  const r = routeFromHash();
  const last = navStack.length ? navStack[navStack.length - 1].route : null;
  if (last === r) return;

  let idx = -1;
  for (let i = navStack.length - 1; i >= 0; i--) {
    if (navStack[i].route === r) { idx = i; break; }
  }

  if (idx >= 0) {
    navStack = navStack.slice(0, idx + 1);
    setActiveScreen(r, "back");
  } else {
    navStack.push({ route: r });
    setActiveScreen(r, "forward");
  }
  onRouteEnter(r);
});

// -----------------------
// Route enter hooks
// -----------------------
let gamesInited = { match: false, word: false };

function onRouteEnter(route){
  hideModal(modalHomework);
  hideModal(modalProfile);

  try {
    if (tg?.BackButton) {
      if (["menu","onboarding","loading"].includes(route)) tg.BackButton.hide();
      else {
        tg.BackButton.show();
        tg.BackButton.onClick(goBack);
      }
    }
  } catch {}

  if (route === "match" && !gamesInited.match) {
    window.MatchGame?.init?.({
      hImpact,
      hNotify,
      hSelect,
      onNav: navigate,
      onBack: goBack,
    });
    gamesInited.match = true;
  }

  if (route === "word" && !gamesInited.word) {
    window.WordGame?.init?.({
      hImpact,
      hNotify,
      hSelect,
    });
    gamesInited.word = true;
  }
}

// -----------------------
// Global fancy button effects
// -----------------------
function addRipple(btn, x, y){
  const r = document.createElement("span");
  r.className = "ripple";
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  r.style.width = r.style.height = `${size}px`;
  r.style.left = `${x - rect.left - size/2}px`;
  r.style.top  = `${y - rect.top  - size/2}px`;
  btn.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

function wireFancyButtons(){
  document.addEventListener("pointerdown", (ev) => {
    const btn = ev.target?.closest?.(".btn");
    if (!btn) return;
    btn.classList.remove("spring");
    void btn.offsetWidth;
    btn.classList.add("spring");
    addRipple(btn, ev.clientX, ev.clientY);
    hImpact("light");
  }, { passive: true });
}

// -----------------------
// Swipe back gesture (soft)
// -----------------------
function wireSwipeBack(){
  if (!viewport) return;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.clientX > 18) return; // left-edge only
    tracking = true;
    startX = ev.clientX;
    startY = ev.clientY;
  }, { passive: true });

  viewport.addEventListener("pointermove", (ev) => {
    if (!tracking) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dx > 26 && Math.abs(dy) < 22) hSelect();
  }, { passive: true });

  viewport.addEventListener("pointerup", (ev) => {
    if (!tracking) return;
    tracking = false;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dx > 84 && Math.abs(dy) < 40) {
      goBack();
      hImpact("medium");
    }
  }, { passive: true });
}

// -----------------------
// App logic
// -----------------------
function onboardingValidate(){
  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("btn-confirm").disabled = !(name && dob);
}

function applyProfileToUI(profile){
  if (!profile) return;

  if (isVisible(modalProfile)){
    $("profile-name").textContent = profile.name || localGet("name") || "Пользователь";
    $("profile-dob").textContent = profile.dob || localGet("dob") || "";

    $("star-bible").textContent = profile.bible ?? 0;
    $("star-truth").textContent = profile.truth ?? 0;
    $("star-behavior").textContent = profile.behavior ?? 0;
  }
}

function applyHomeworkToUI(homeworkText){
  if (isVisible(modalHomework)){
    $("homework-text").textContent = homeworkText || "Пока нет задания 🙂";
  }

  if (screens.admin && screens.admin.classList.contains("is-active")){
    const ta = $("admin-homework");
    const isEditing = document.activeElement === ta;
    if (ta && !isEditing){
      ta.value = homeworkText || "";
    }
  }
}

function startPolling(){
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, POLL_MS);
}

async function pollTick(){
  if (document.hidden) return;
  if (!state.initData) return;

  try{
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    if (state.profile?.name) localSet("name", state.profile.name);
    if (state.profile?.dob) localSet("dob", state.profile.dob);

    applyProfileToUI(state.profile);
  }catch{}

  const needHomework = isVisible(modalHomework) || (screens.admin && screens.admin.classList.contains("is-active"));
  if (needHomework){
    try{
      const hw = await api("getHomework");
      applyHomeworkToUI(hw.homework_text || "");
    }catch{}
  }
}

async function boot(){
  hideModal(modalHomework);
  hideModal(modalProfile);

  navStack = [];

  state.initData = tg?.initData || "";
  const ident = getTelegramIdentity();
  state.tgId = ident?.id || null;

  const knownUser = !!(localGet("name") && localGet("dob"));
  let firstRoute = routeFromHash();

  if (!state.tgId || !state.initData) {
    firstRoute = "onboarding";
    navStack = [{ route: firstRoute }];
    setActiveScreen(firstRoute, "forward");
    onRouteEnter(firstRoute);
    $("onboarding-error").textContent =
      "Открой это приложение внутри Telegram (WebApp), чтобы всё работало.";
    return;
  }

  if (knownUser && firstRoute === "menu") {
    firstRoute = "loading";
  }

  navStack = [{ route: firstRoute }];
  history.replaceState({ route: firstRoute }, "", `#${firstRoute}`);
  setActiveScreen(firstRoute, "forward");
  onRouteEnter(firstRoute);

  try {
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    if (state.profile?.name) localSet("name", state.profile.name);
    if (state.profile?.dob) localSet("dob", state.profile.dob);

    if (state.profile?.name && state.profile?.dob) {
      if (state.isAdmin) $("btn-admin").classList.remove("hidden");
      startPolling();
      navigate("menu", { replace: true });
      return;
    }

    startPolling();
    navigate("onboarding", { replace: true });

  } catch (e) {
    startPolling();
    navigate("onboarding", { replace: true });
    $("onboarding-error").textContent = e.message;
    hNotify("error");
  }
}

async function doRegister(){
  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("onboarding-error").textContent = "";

  try {
    const r = await api("register", { name, dob });
    state.isAdmin = !!r.isAdmin;
    state.profile = r.profile;

    localSet("name", name);
    localSet("dob", dob);

    $("hello-title").textContent = `Отлично, рад познакомиться, ${name}!`;
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
    hNotify("success");
    navigate("hello");
  } catch (e) {
    $("onboarding-error").textContent = e.message;
    hNotify("error");
  }
}

async function openHomework(){
  try {
    const r = await api("getHomework");
    $("homework-text").textContent = r.homework_text || "Пока нет задания 🙂";
  } catch (e) {
    $("homework-text").textContent = "Не удалось загрузить задание: " + e.message;
  }
  showModal(modalHomework);
}

async function openProfile(){
  try {
    const r = await api("getProfile");
    state.isAdmin = !!r.isAdmin;
    state.profile = r.profile;
    applyProfileToUI(state.profile);
  } catch {}
  showModal(modalProfile);
}

async function openAdmin(){
  navigate("admin");

  try {
    const hw = await api("getHomework");
    $("admin-homework").value = hw.homework_text || "";
  } catch {}

  await refreshAdminUsers();
}

async function refreshAdminUsers(){
  const wrap = $("admin-users");
  wrap.innerHTML = "Загрузка...";
  try {
    const r = await api("adminListUsers");
    wrap.innerHTML = "";
    r.users.forEach(u => {
      const el = document.createElement("div");
      el.className = "admin-user";
      el.innerHTML = `
        <div class="top">
          <div>
            <div><b>${escapeHtml(u.name || "(без имени)")}</b></div>
            <div class="small">${escapeHtml(u.dob || "")}</div>
            <div class="id">tg_id: ${escapeHtml(u.tg_id)}</div>
          </div>
          <button class="btn" data-act="save">Сохранить</button>
        </div>

        <div class="grid">
          <div>
            <div class="small">Библия</div>
            <input type="number" min="0" step="1" value="${u.bible ?? 0}" data-k="bible"/>
          </div>
          <div>
            <div class="small">Основы истины</div>
            <input type="number" min="0" step="1" value="${u.truth ?? 0}" data-k="truth"/>
          </div>
          <div>
            <div class="small">Поведение</div>
            <input type="number" min="0" step="1" value="${u.behavior ?? 0}" data-k="behavior"/>
          </div>
        </div>
        <div class="small" data-msg></div>
      `;
      el.querySelector('[data-act="save"]').addEventListener("click", async () => {
        const bible = Number(el.querySelector('[data-k="bible"]').value || 0);
        const truth = Number(el.querySelector('[data-k="truth"]').value || 0);
        const behavior = Number(el.querySelector('[data-k="behavior"]').value || 0);
        const msg = el.querySelector("[data-msg]");
        msg.textContent = "Сохранение...";
        try {
          await api("adminUpdateStars", { tg_id: u.tg_id, bible, truth, behavior });
          msg.textContent = "Готово ✅";
          hNotify("success");
        } catch(e){
          msg.textContent = "Ошибка: " + e.message;
          hNotify("error");
        }
      });

      wrap.appendChild(el);
    });
  } catch (e) {
    wrap.innerHTML = "Ошибка загрузки пользователей: " + escapeHtml(e.message);
  }
}

// -----------------------
// Global navigation bindings (data-nav / data-back)
// -----------------------
function wireNavDelegation(){
  document.addEventListener("click", (ev) => {
    const navEl = ev.target?.closest?.("[data-nav]");
    if (navEl){
      ev.preventDefault();
      const r = navEl.getAttribute("data-nav");
      if (r) navigate(r);
      return;
    }

    const backEl = ev.target?.closest?.("[data-back]");
    if (backEl){
      ev.preventDefault();
      goBack();
      return;
    }
  });
}

// -----------------------
// Bindings
// -----------------------
$("inp-name").addEventListener("input", onboardingValidate);
$("inp-dob").addEventListener("input", onboardingValidate);
$("btn-confirm").addEventListener("click", doRegister);

$("btn-forward").addEventListener("click", () => navigate("menu"));

$("btn-games").addEventListener("click", () => navigate("games"));
$("btn-games-back").addEventListener("click", () => navigate("menu"));

$("btn-homework").addEventListener("click", openHomework);
bindModalClose(modalHomework, $("btn-homework-close"));

$("btn-profile").addEventListener("click", openProfile);
bindModalClose(modalProfile, $("btn-profile-close"));

$("btn-admin").addEventListener("click", openAdmin);
$("btn-admin-back").addEventListener("click", () => navigate("menu"));

$("btn-admin-save-homework").addEventListener("click", async () => {
  $("admin-homework-msg").textContent = "Сохранение...";
  try {
    await api("adminSetHomework", { homework_text: $("admin-homework").value });
    $("admin-homework-msg").textContent = "Сохранено ✅";
    hNotify("success");
  } catch(e){
    $("admin-homework-msg").textContent = "Ошибка: " + e.message;
    hNotify("error");
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pollTick();
});

// Init
wireNavDelegation();
wireFancyButtons();
wireSwipeBack();
boot();
