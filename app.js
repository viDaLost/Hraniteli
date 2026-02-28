// app.js (FAST UI + cache + dedupe)
// Always start with LOADING -> check server -> route
// SPA + animations + Telegram haptics

const GAS_URL = "https://script.google.com/macros/s/AKfycbyXbnpE6gEiaLbLM23GpzSbyXhWwZShVEVYTJxJ2agSEB2-ytDBBdji5T9WA8zcJ5R4/exec";
const POLL_MS = 10_000;

// Client cache TTL (UI should respond instantly)
const CACHE_TTL = {
  getProfile: 60_000,
  adminListUsers: 20_000,
  getHomework: 60_000,
};

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
  isRegistering: false, // ✅ FIX: блокируем повторные регистрации + контролим UI кнопки
};

let pollTimer = null;
let navStack = [];
let isTransitioning = false;

// -----------------------
// Telegram Haptics helpers
// -----------------------
function hImpact(style = "light") { try { tg?.HapticFeedback?.impactOccurred?.(style); } catch {} }
function hNotify(type = "success") { try { tg?.HapticFeedback?.notificationOccurred?.(type); } catch {} }
function hSelect() { try { tg?.HapticFeedback?.selectionChanged?.(); } catch {} }

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

  modalEl.addEventListener("click", (ev) => { if (ev.target === modalEl) hideModal(modalEl); });
  modalEl.addEventListener("touchend", (ev) => { if (ev.target === modalEl) hideModal(modalEl); }, { passive: true });
}

function localGet(key){ return localStorage.getItem(key) || ""; }
function localSet(key,val){ localStorage.setItem(key, String(val)); }

function getTelegramIdentity(){
  if (!tg) return null;
  const u = tg.initDataUnsafe?.user;
  if (!u?.id) return null;
  return { id: String(u.id) };
}

async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action, initData: state.initData, ...payload }),
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("Сервер вернул не-JSON: " + text.slice(0, 160)); }

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
// ✅ FIX: DOB formatting (no timezone shift) + RU format DD.MM.YYYY
// -----------------------
function formatDobRu(dob){
  if (!dob) return "";
  const s = String(dob);

  // 1) Если пришло ISO (есть T) — парсим и берём ЛОКАЛЬНУЮ дату (не UTC)
  // Пример: 1998-02-22T21:00:00.000Z -> в +03 это уже 1998-02-23
  if (s.includes("T")) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    }
    // fallback, если почему-то не распарсилось
    const ymd = s.slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return ymd;
  }

  // 2) Если пришло просто YYYY-MM-DD — конвертим напрямую
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;

  // 3) Если уже DD.MM.YYYY — оставляем
  const m2 = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m2) return s;

  return s;
}

// -----------------------
// ✅ Dedupe + TTL cache for API calls
// -----------------------
const inFlight = new Map(); // key -> Promise
const memCache = new Map(); // key -> {ts, data}

function cacheKey(action, payload){
  return action + "::" + JSON.stringify(payload || {});
}

async function apiFast(action, payload = {}, { ttl = 0, force = false } = {}) {
  const key = cacheKey(action, payload);

  if (!force && ttl > 0) {
    const hit = memCache.get(key);
    if (hit && (Date.now() - hit.ts) < ttl) return hit.data;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const p = api(action, payload)
    .then((data) => {
      if (ttl > 0) memCache.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

function setCachedProfile(p){
  state.isAdmin = !!p.isAdmin;
  state.profile = p.profile || state.profile;

  if (state.profile?.name) localSet("name", state.profile.name);
  if (state.profile?.dob) localSet("dob", state.profile.dob);

  if (state.profile) {
    localSet("profile_cache", JSON.stringify({
      ts: Date.now(),
      isAdmin: state.isAdmin,
      profile: state.profile
    }));
  }
}

function getCachedProfile(){
  if (state.profile?.name && state.profile?.dob) return { isAdmin: state.isAdmin, profile: state.profile };

  try{
    const raw = localGet("profile_cache");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.profile) return null;
    if (Date.now() - (obj.ts || 0) > 24*60*60*1000) return null;
    return { isAdmin: !!obj.isAdmin, profile: obj.profile };
  }catch{
    return null;
  }
}

// -----------------------
// ✅ FIX: local-profile checker (prevents bouncing back to onboarding)
// -----------------------
function hasLocalProfile(){
  const n = localGet("name").trim();
  const d = localGet("dob").trim();
  return !!(n && d);
}

// -----------------------
// SPA Router + Transitions
// -----------------------
function routeFromHash(){
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return "loading";
  const parts = h.split("/").filter(Boolean);
  return parts[0] || "loading";
}

function canAccess(route){
  // ✅ FIX: считаем "зарегистрирован", если есть state.profile ИЛИ localStorage
  const hasProfile = !!(state.profile?.name && state.profile?.dob) || hasLocalProfile();
  if (hasProfile) return true;
  return ["loading","onboarding","hello"].includes(route);
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
  if (!canAccess(route)) route = "onboarding";

  const current = navStack.length ? navStack[navStack.length - 1].route : null;

  if (replace) {
    if (navStack.length) navStack[navStack.length - 1] = { route };
    else navStack.push({ route });
  } else {
    if (current !== route) navStack.push({ route });
  }

  const newHash = `#${route}`;
  if (replace) history.replaceState({ route }, "", newHash);
  else history.pushState({ route }, "", newHash);

  setActiveScreen(route, "forward");
  onRouteEnter(route);
}

function goBack(){
  if (navStack.length <= 1) {
    navigate("menu", { replace: true });
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
    window.MatchGame?.init?.({ hImpact, hNotify, hSelect, onNav: navigate, onBack: goBack });
    gamesInited.match = true;
  }

  if (route === "word" && !gamesInited.word) {
    window.WordGame?.init?.({ hImpact, hNotify, hSelect });
    gamesInited.word = true;
  }
}

// -----------------------
// Fancy button effects
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

function wireSwipeBack(){
  if (!viewport) return;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.clientX > 18) return;
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
  // ✅ FIX: если идёт регистрация — кнопка не активна
  $("btn-confirm").disabled = !(name && dob) || state.isRegistering;
}

function applyProfileToUI(profile){
  if (!profile) return;
  if (isVisible(modalProfile)){
    $("profile-name").textContent = profile.name || localGet("name") || "Пользователь";
    $("profile-dob").textContent = profile.dob ? formatDobRu(profile.dob) : (localGet("dob") || "");
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
    if (ta && !isEditing) ta.value = homeworkText || "";
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
    const p = await apiFast("getProfile", {}, { ttl: CACHE_TTL.getProfile });
    setCachedProfile(p);
    applyProfileToUI(state.profile);
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  }catch{}

  const needHomework = isVisible(modalHomework) || (screens.admin && screens.admin.classList.contains("is-active"));
  if (needHomework){
    try{
      const hw = await apiFast("getHomework", {}, { ttl: CACHE_TTL.getHomework });
      applyHomeworkToUI(hw.homework_text || "");
    }catch{}
  }
}

async function boot(){
  hideModal(modalHomework);
  hideModal(modalProfile);

  navStack = [{ route: "loading" }];
  history.replaceState({ route: "loading" }, "", "#loading");
  setActiveScreen("loading", "forward");
  onRouteEnter("loading");

  state.initData = tg?.initData || "";
  const ident = getTelegramIdentity();
  state.tgId = ident?.id || null;

  if (!state.tgId || !state.initData) {
    navigate("onboarding", { replace: true });
    $("onboarding-error").textContent =
      "Открой это приложение внутри Telegram (WebApp), чтобы всё работало.";
    return;
  }

  const cached = getCachedProfile();
  if (cached?.profile) {
    state.isAdmin = !!cached.isAdmin;
    state.profile = cached.profile;
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  }

  startPolling();

  try {
    const p = await apiFast("getProfile", {}, { ttl: CACHE_TTL.getProfile, force: true });
    setCachedProfile(p);
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");

    // ✅ FIX: если профиль уже есть (state или localStorage) — сразу в меню
    if ((state.profile?.name && state.profile?.dob) || hasLocalProfile()) {
      navigate("menu", { replace: true });
      return;
    }
    navigate("onboarding", { replace: true });

  } catch (e) {
    // ✅ FIX: если сервер временно не ответил, но localStorage уже есть — всё равно пускаем в меню
    if (hasLocalProfile()) {
      state.profile = state.profile || {
        name: localGet("name"),
        dob: localGet("dob"),
        bible: 0,
        truth: 0,
        behavior: 0,
      };
      navigate("menu", { replace: true });
      return;
    }

    navigate("onboarding", { replace: true });
    $("onboarding-error").textContent = e.message;
    hNotify("error");
  }
}

// ✅ FIX: "Подтвердить" -> "Загрузка..." пока идёт запрос + защита от повторов
async function doRegister(){
  if (state.isRegistering) return;

  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("onboarding-error").textContent = "";

  const btn = $("btn-confirm");
  const prevText = btn.textContent;

  // UI: сразу показать загрузку и заблокировать кнопку
  state.isRegistering = true;
  btn.disabled = true;
  btn.textContent = "Загрузка…";

  // ✅ ключевой фикс от "отката": сохраняем профиль локально ДО ответа сервера
  localSet("name", name);
  localSet("dob", dob);
  state.profile = { name, dob, bible: 0, truth: 0, behavior: 0 };

  // обновим кэш профиля (минимальный), чтобы canAccess() не кидал назад
  localSet("profile_cache", JSON.stringify({
    ts: Date.now(),
    isAdmin: false,
    profile: state.profile
  }));

  try {
    const r = await apiFast("register", { name, dob }, { force: true });
    // если сервер вернул профиль/админа — применяем
    setCachedProfile(r);

    $("hello-title").textContent = `Отлично, рад познакомиться, ${name}!`;
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
    hNotify("success");

    // ✅ replace=true чтобы назад не возвращало на onboarding
    navigate("hello", { replace: true });
  } catch (e) {
    $("onboarding-error").textContent = e.message;
    hNotify("error");
  } finally {
    // возвращаем кнопку в норму (если мы остались на onboarding)
    btn.textContent = prevText;
    state.isRegistering = false;
    onboardingValidate();
  }
}

// Profile: open instantly, fill from cache, then refresh in bg
async function openProfile(){
  showModal(modalProfile);
  hImpact("light");

  const cached = getCachedProfile();
  if (cached?.profile) {
    $("profile-name").textContent = cached.profile.name || localGet("name") || "Пользователь";
    $("profile-dob").textContent = cached.profile.dob ? formatDobRu(cached.profile.dob) : (localGet("dob") || "");
    $("star-bible").textContent = cached.profile.bible ?? 0;
    $("star-truth").textContent = cached.profile.truth ?? 0;
    $("star-behavior").textContent = cached.profile.behavior ?? 0;
  } else {
    $("profile-name").textContent = localGet("name") || "Пользователь";
    $("profile-dob").textContent = localGet("dob") || "";
  }

  try {
    const r = await apiFast("getProfile", {}, { ttl: CACHE_TTL.getProfile });
    setCachedProfile(r);
    applyProfileToUI(state.profile);
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  } catch {}
}

async function openHomework(){
  showModal(modalHomework);
  $("homework-text").textContent = "Загрузка…";

  try {
    const r = await apiFast("getHomework", {}, { ttl: CACHE_TTL.getHomework });
    $("homework-text").textContent = r.homework_text || "Пока нет задания 🙂";
  } catch (e) {
    $("homework-text").textContent = "Не удалось загрузить: " + e.message;
  }
}

async function openAdmin(){
  navigate("admin");
  hImpact("light");

  $("admin-homework").value = "Загрузка...";
  try {
    const hw = await apiFast("getHomework", {}, { ttl: CACHE_TTL.getHomework });
    $("admin-homework").value = hw.homework_text || "";
  } catch {
    $("admin-homework").value = "";
  }

  await refreshAdminUsersFast();
}

async function refreshAdminUsersFast(){
  const wrap = $("admin-users");
  wrap.innerHTML = `
    <div class="admin-user"><div class="small">Загрузка пользователей…</div></div>
    <div class="admin-user"><div class="small">Почти готово…</div></div>
  `;

  try {
    const r = await apiFast("adminListUsers", {}, { ttl: CACHE_TTL.adminListUsers });
    renderAdminUsers(r.users);
  } catch (e) {
    wrap.innerHTML = "Ошибка загрузки пользователей: " + escapeHtml(e.message);
  }
}

function renderAdminUsers(users){
  const wrap = $("admin-users");
  wrap.innerHTML = "";

  users.forEach(u => {
    const el = document.createElement("div");
    el.className = "admin-user";
    el.innerHTML = `
      <div class="top">
        <div>
          <div><b>${escapeHtml(u.name || "(без имени)")}</b></div>
          <div class="small">${escapeHtml(formatDobRu(u.dob))}</div>
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
        await apiFast("adminUpdateStars", { tg_id: u.tg_id, bible, truth, behavior }, { force: true });
        memCache.forEach((_, k) => { if (k.startsWith("adminListUsers::")) memCache.delete(k); });
        msg.textContent = "Готово ✅";
        hNotify("success");
      } catch(e){
        msg.textContent = "Ошибка: " + e.message;
        hNotify("error");
      }
    });

    wrap.appendChild(el);
  });
}

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

// ✅ FIX: после "Вперёд" сразу меню и replace=true, чтобы не возвращало/не прыгало
$("btn-forward").addEventListener("click", () => navigate("menu", { replace: true }));

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
    await apiFast("adminSetHomework", { homework_text: $("admin-homework").value }, { force: true });
    memCache.forEach((_, k) => { if (k.startsWith("getHomework::")) memCache.delete(k); });
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
