// app.js
// SPA + Telegram WebApp + local account slots + admin search fixes

const GAS_URL = "https://script.google.com/macros/s/AKfycbyXbnpE6gEiaLbLM23GpzSbyXhWwZShVEVYTJxJ2agSEB2-ytDBBdji5T9WA8zcJ5R4/exec";
const POLL_MS = 10_000;

const CACHE_TTL = {
  getProfile: 60_000,
  adminListUsers: 20_000,
  getHomework: 60_000,
};

const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

(() => {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isTelegram = /Telegram/i.test(ua);
  if (!isIOS || !isTelegram) return;

  const CLICKABLE = ".btn, .tile, .option, .card-tile, button";

  document.addEventListener(
    "contextmenu",
    (e) => {
      const t = e.target;
      if (t && t.closest?.(CLICKABLE)) e.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener(
    "selectstart",
    (e) => {
      const t = e.target;
      if (t && t.closest?.(CLICKABLE)) e.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener(
    "dragstart",
    (e) => {
      const t = e.target;
      if (t && (t.closest?.(CLICKABLE) || t.tagName === "IMG")) e.preventDefault();
    },
    { passive: false }
  );
})();

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");

const screens = {
  loading: $("screen-loading"),
  accounts: $("screen-accounts"),
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

const ACCOUNT_SCOPED_KEYS = new Set(["name", "dob", "profile_cache"]);

const state = {
  tgId: null,
  initData: "",
  accountId: null,
  isAdmin: false,
  profile: null,
  isRegistering: false,
  onboardingMode: "create", // create | edit
};

let pollTimer = null;
let navStack = [];
let isTransitioning = false;
let allAdminUsers = [];
let filteredAdminUsers = [];

function hImpact(style = "light") { try { tg?.HapticFeedback?.impactOccurred?.(style); } catch {} }
function hNotify(type = "success") { try { tg?.HapticFeedback?.notificationOccurred?.(type); } catch {} }
function hSelect() { try { tg?.HapticFeedback?.selectionChanged?.(); } catch {} }

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

function getScopedStorageKey(key){
  if (!ACCOUNT_SCOPED_KEYS.has(key)) return key;
  if (state.tgId && state.accountId) return `hs:${state.tgId}:${state.accountId}:${key}`;
  return key;
}

function localGet(key){ return localStorage.getItem(getScopedStorageKey(key)) || ""; }
function localSet(key, val){ localStorage.setItem(getScopedStorageKey(key), String(val)); }
function localRemove(key){ localStorage.removeItem(getScopedStorageKey(key)); }

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
      body: JSON.stringify({
        action,
        initData: state.initData,
        account_id: state.accountId || "",
        local_account_name: state.profile?.name || "",
        ...payload,
      }),
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

function formatDobRu(dob){
  if (!dob) return "";
  const s = String(dob);

  if (s.includes("T")) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    }
    const ymd = s.slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return ymd;
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;

  const m2 = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m2) return s;

  return s;
}

const inFlight = new Map();
const memCache = new Map();

function cacheKey(action, payload){
  return action + "::" + JSON.stringify(payload || {}) + "::" + (state.accountId || "");
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

function clearMemCache(prefix){
  memCache.forEach((_, k) => { if (!prefix || k.startsWith(prefix)) memCache.delete(k); });
}

function accountsKey(){ return state.tgId ? `hs:${state.tgId}:accounts` : "hs:accounts"; }
function activeAccountKey(){ return state.tgId ? `hs:${state.tgId}:active-account` : "hs:active-account"; }

function getStoredAccounts(){
  try {
    const raw = localStorage.getItem(accountsKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveStoredAccounts(accounts){
  localStorage.setItem(accountsKey(), JSON.stringify(accounts));
}

function getActiveAccountId(){
  return localStorage.getItem(activeAccountKey()) || "";
}

function setActiveAccountId(accountId){
  if (!accountId) {
    localStorage.removeItem(activeAccountKey());
    return;
  }
  localStorage.setItem(activeAccountKey(), accountId);
}

function normalizeAccountRecord(acc){
  return {
    id: String(acc?.id || ""),
    name: String(acc?.name || "").trim(),
    dob: String(acc?.dob || "").trim(),
    bible: Number(acc?.bible || 0),
    truth: Number(acc?.truth || 0),
    behavior: Number(acc?.behavior || 0),
    lastUsedAt: Number(acc?.lastUsedAt || Date.now()),
  };
}

function makeAccountId(){
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentAccountRecord(){
  const list = getStoredAccounts();
  return list.find((x) => x.id === state.accountId) || null;
}

function upsertStoredAccount(profile = state.profile){
  if (!state.accountId || !profile) return;
  const list = getStoredAccounts();
  const entry = normalizeAccountRecord({
    id: state.accountId,
    name: profile.name,
    dob: profile.dob,
    bible: profile.bible,
    truth: profile.truth,
    behavior: profile.behavior,
    lastUsedAt: Date.now(),
  });

  const idx = list.findIndex((x) => x.id === state.accountId);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.unshift(entry);

  list.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  saveStoredAccounts(list);
}

function ensureLegacyAccountMigrated(){
  if (!state.tgId) return;
  const existing = getStoredAccounts();
  if (existing.length) return;

  const legacyName = (localStorage.getItem("name") || "").trim();
  const legacyDob = (localStorage.getItem("dob") || "").trim();
  const legacyCache = localStorage.getItem("profile_cache");
  if (!legacyName || !legacyDob) return;

  const accountId = makeAccountId();
  state.accountId = accountId;
  setActiveAccountId(accountId);
  localSet("name", legacyName);
  localSet("dob", legacyDob);
  if (legacyCache) localSet("profile_cache", legacyCache);
  saveStoredAccounts([normalizeAccountRecord({ id: accountId, name: legacyName, dob: legacyDob })]);
}

function getCachedProfile(){
  if (state.profile?.name && state.profile?.dob) return { isAdmin: state.isAdmin, profile: state.profile };

  try {
    const raw = localGet("profile_cache");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.profile) return null;
    if (Date.now() - (obj.ts || 0) > 24*60*60*1000) return null;
    return { isAdmin: !!obj.isAdmin, profile: obj.profile };
  } catch {
    return null;
  }
}

function hasLocalProfile(){
  const acc = getCurrentAccountRecord();
  if (acc?.name && acc?.dob) return true;
  const n = localGet("name").trim();
  const d = localGet("dob").trim();
  return !!(n && d);
}

function setCachedProfile(p){
  state.isAdmin = !!p.isAdmin;

  const localIdentity = getCurrentAccountRecord();
  const serverProfile = p.profile || {};
  state.profile = {
    ...serverProfile,
    name: localIdentity?.name || serverProfile.name || state.profile?.name || localGet("name") || "",
    dob: localIdentity?.dob || serverProfile.dob || state.profile?.dob || localGet("dob") || "",
  };

  if (state.profile?.name) localSet("name", state.profile.name);
  if (state.profile?.dob) localSet("dob", state.profile.dob);

  localSet("profile_cache", JSON.stringify({
    ts: Date.now(),
    isAdmin: state.isAdmin,
    profile: state.profile,
  }));

  upsertStoredAccount(state.profile);
  refreshMenuSummary();
}

function routeFromHash(){
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return "loading";
  const parts = h.split("/").filter(Boolean);
  return parts[0] || "loading";
}

function canAccess(route){
  const hasProfile = !!(state.profile?.name && state.profile?.dob) || hasLocalProfile();
  if (hasProfile) return true;
  return ["loading","accounts","onboarding","hello"].includes(route);
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
    next.scrollTop = 0;
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
  if (!canAccess(route)) route = getStoredAccounts().length ? "accounts" : "onboarding";

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
    navigate(hasLocalProfile() ? "menu" : (getStoredAccounts().length ? "accounts" : "onboarding"), { replace: true });
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

let gamesInited = { match: false, word: false };

function onRouteEnter(route){
  hideModal(modalHomework);
  hideModal(modalProfile);

  try {
    if (tg?.BackButton) {
      if (["menu","onboarding","accounts","loading"].includes(route)) tg.BackButton.hide();
      else {
        tg.BackButton.show();
        tg.BackButton.onClick(goBack);
      }
    }
  } catch {}

  if (route === "accounts") renderAccounts();
  if (route === "menu") refreshMenuSummary();
  if (route === "onboarding") syncOnboardingModeUi();

  if (route === "match" && !gamesInited.match) {
    window.MatchGame?.init?.({ hImpact, hNotify, hSelect, onNav: navigate, onBack: goBack });
    gamesInited.match = true;
  }

  if (route === "word" && !gamesInited.word) {
    window.WordGame?.init?.({ hImpact, hNotify, hSelect });
    gamesInited.word = true;
  }
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

function onboardingValidate(){
  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("btn-confirm").disabled = !(name && dob) || state.isRegistering;
}

function syncOnboardingModeUi(){
  const hasAccounts = getStoredAccounts().length > 0;
  const switchBtn = $("btn-onboarding-switch");
  if (switchBtn) switchBtn.classList.toggle("hidden", !hasAccounts);
}

function refreshMenuSummary(){
  const profile = state.profile || getCurrentAccountRecord() || {};
  const activeAcc = getCurrentAccountRecord();
  const totalAccounts = getStoredAccounts().length;

  const name = profile.name || activeAcc?.name || "Без имени";
  const dob = profile.dob || activeAcc?.dob || "";

  if ($("menu-active-name")) $("menu-active-name").textContent = name;
  if ($("menu-active-meta")) {
    const suffix = totalAccounts > 1 ? ` • ${totalAccounts} профиля на устройстве` : "";
    $("menu-active-meta").textContent = `${dob ? formatDobRu(dob) : "Дата рождения не указана"}${suffix}`;
  }

  if ($("menu-stat-bible")) $("menu-stat-bible").textContent = Number(profile.bible || 0);
  if ($("menu-stat-truth")) $("menu-stat-truth").textContent = Number(profile.truth || 0);
  if ($("menu-stat-behavior")) $("menu-stat-behavior").textContent = Number(profile.behavior || 0);
}

function applyProfileToUI(profile){
  if (!profile) return;
  refreshMenuSummary();

  if (isVisible(modalProfile)){
    const accountCount = getStoredAccounts().length;
    $("profile-name").textContent = profile.name || "Пользователь";
    $("profile-dob").textContent = profile.dob ? formatDobRu(profile.dob) : "";
    $("star-bible").textContent = profile.bible ?? 0;
    $("star-truth").textContent = profile.truth ?? 0;
    $("star-behavior").textContent = profile.behavior ?? 0;
    $("profile-account-badge").textContent = accountCount > 1
      ? `Активный профиль • ${accountCount} на устройстве`
      : "Локальный профиль на этом устройстве";
  }
}

function applyHomeworkToUI(homeworkText){
  if (isVisible(modalHomework)) {
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

  try {
    const p = await apiFast("getProfile", {}, { ttl: CACHE_TTL.getProfile });
    setCachedProfile(p);
    applyProfileToUI(state.profile);
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  } catch {}

  const needHomework = isVisible(modalHomework) || (screens.admin && screens.admin.classList.contains("is-active"));
  if (needHomework){
    try {
      const hw = await apiFast("getHomework", {}, { ttl: CACHE_TTL.getHomework });
      applyHomeworkToUI(hw.homework_text || "");
    } catch {}
  }
}

function seedStateFromActiveAccount(){
  const activeId = getActiveAccountId();
  const accounts = getStoredAccounts();
  const fallbackId = activeId || accounts[0]?.id || null;
  if (!fallbackId) {
    state.accountId = null;
    state.profile = null;
    return;
  }

  state.accountId = fallbackId;
  setActiveAccountId(fallbackId);
  const acc = accounts.find((x) => x.id === fallbackId) || null;
  if (acc) {
    state.profile = {
      name: acc.name,
      dob: acc.dob,
      bible: acc.bible || 0,
      truth: acc.truth || 0,
      behavior: acc.behavior || 0,
    };
  }
}

function renderAccounts(){
  const wrap = $("accounts-list");
  if (!wrap) return;

  const accounts = getStoredAccounts();
  wrap.innerHTML = "";

  if (!accounts.length) {
    wrap.innerHTML = `<div class="account-empty">На этом устройстве пока нет сохранённых профилей.</div>`;
  } else {
    accounts.forEach((acc) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `account-item ${acc.id === state.accountId ? "active" : ""}`;
      const initial = (acc.name || "?").trim().charAt(0).toUpperCase() || "?";
      item.innerHTML = `
        <div class="account-item-main">
          <div class="account-avatar">${escapeHtml(initial)}</div>
          <div>
            <div class="account-name">${escapeHtml(acc.name || "Без имени")}</div>
            <div class="account-meta">${escapeHtml(formatDobRu(acc.dob) || "Дата не указана")}</div>
          </div>
        </div>
        <div class="account-tag">${acc.id === state.accountId ? "Активный" : "Открыть"}</div>
      `;
      item.addEventListener("click", async () => {
        await activateAccount(acc.id);
      });
      wrap.appendChild(item);
    });
  }

  $("btn-accounts-back").textContent = hasLocalProfile() ? "← Вернуться" : "← К регистрации";
}

async function activateAccount(accountId){
  const accounts = getStoredAccounts();
  const acc = accounts.find((x) => x.id === accountId);
  if (!acc) return;

  state.accountId = accountId;
  setActiveAccountId(accountId);
  state.onboardingMode = "edit";
  state.profile = {
    name: acc.name,
    dob: acc.dob,
    bible: acc.bible || 0,
    truth: acc.truth || 0,
    behavior: acc.behavior || 0,
  };

  localSet("name", acc.name || "");
  localSet("dob", acc.dob || "");
  clearMemCache();
  refreshMenuSummary();
  applyProfileToUI(state.profile);

  try {
    const r = await apiFast("getProfile", {}, { ttl: CACHE_TTL.getProfile, force: true });
    setCachedProfile(r);
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  } catch {}

  navigate("menu", { replace: true });
}

function beginCreateAccount(){
  state.onboardingMode = "create";
  state.accountId = null;
  state.profile = null;
  $("inp-name").value = "";
  $("inp-dob").value = "";
  $("onboarding-error").textContent = "";
  onboardingValidate();
  navigate("onboarding");
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
    $("onboarding-error").textContent = "Открой это приложение внутри Telegram (WebApp), чтобы всё работало.";
    return;
  }

  ensureLegacyAccountMigrated();
  seedStateFromActiveAccount();

  const cached = getCachedProfile();
  if (cached?.profile) {
    state.isAdmin = !!cached.isAdmin;
    state.profile = cached.profile;
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  }

  startPolling();

  try {
    if (state.accountId) {
      const p = await apiFast("getProfile", {}, { ttl: CACHE_TTL.getProfile, force: true });
      setCachedProfile(p);
      if (state.isAdmin) $("btn-admin").classList.remove("hidden");
    }

    if ((state.profile?.name && state.profile?.dob) || hasLocalProfile()) {
      navigate("menu", { replace: true });
      return;
    }

    if (getStoredAccounts().length) {
      navigate("accounts", { replace: true });
      return;
    }

    navigate("onboarding", { replace: true });
  } catch (e) {
    if (hasLocalProfile()) {
      navigate("menu", { replace: true });
      return;
    }

    if (getStoredAccounts().length) {
      navigate("accounts", { replace: true });
      return;
    }

    navigate("onboarding", { replace: true });
    $("onboarding-error").textContent = e.message;
    hNotify("error");
  }
}

async function doRegister(){
  if (state.isRegistering) return;

  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("onboarding-error").textContent = "";

  const btn = $("btn-confirm");
  const prevText = btn.textContent;

  state.isRegistering = true;
  btn.disabled = true;
  btn.textContent = "Загрузка…";

  if (!state.accountId || state.onboardingMode === "create") {
    state.accountId = makeAccountId();
    setActiveAccountId(state.accountId);
  }

  state.profile = { name, dob, bible: 0, truth: 0, behavior: 0 };
  localSet("name", name);
  localSet("dob", dob);
  localSet("profile_cache", JSON.stringify({
    ts: Date.now(),
    isAdmin: false,
    profile: state.profile,
  }));
  upsertStoredAccount(state.profile);

  try {
    const r = await apiFast("register", { name, dob, account_id: state.accountId }, { force: true });
    setCachedProfile(r);
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  } catch (e) {
    $("onboarding-error").textContent = `Профиль сохранён на устройстве, но сервер не подтвердил регистрацию: ${e.message}`;
  } finally {
    $("hello-title").textContent = `Отлично, рад познакомиться, ${name}!`;
    btn.textContent = prevText;
    state.isRegistering = false;
    state.onboardingMode = "edit";
    onboardingValidate();
    refreshMenuSummary();
    hNotify("success");
    navigate("hello", { replace: true });
  }
}

async function openProfile(){
  showModal(modalProfile);
  hImpact("light");

  const profile = state.profile || getCachedProfile()?.profile || getCurrentAccountRecord() || {
    name: localGet("name") || "Пользователь",
    dob: localGet("dob") || "",
    bible: 0,
    truth: 0,
    behavior: 0,
  };
  applyProfileToUI(profile);

  try {
    if (!state.accountId) return;
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
  wrap.innerHTML = `<div class="admin-user"><div class="small center">Загрузка пользователей…</div></div>`;

  try {
    const r = await apiFast("adminListUsers", {}, { ttl: CACHE_TTL.adminListUsers, force: true });
    allAdminUsers = Array.isArray(r.users) ? r.users : [];
    executeAdminSearch();
  } catch (e) {
    wrap.innerHTML = '<div class="error">Ошибка: ' + escapeHtml(e.message) + '</div>';
    $("admin-users-count").textContent = "Ошибка загрузки";
    $("admin-search-status").textContent = "Ошибка";
  }
}

function renderAdminUsers(users){
  const wrap = $("admin-users");
  wrap.innerHTML = "";

  const countText = `${users.length} ${users.length === 1 ? "пользователь" : (users.length >= 2 && users.length <= 4 ? "пользователя" : "пользователей")}`;
  $("admin-users-count").textContent = countText;

  if (!users || users.length === 0) {
    wrap.innerHTML = '<div class="muted center" style="padding: 12px;">Никого не найдено</div>';
    return;
  }

  users.forEach(u => {
    const el = document.createElement("div");
    el.className = "admin-user";
    el.innerHTML = `
      <div class="admin-user-header">
        <div>
          <span class="admin-user-name">${escapeHtml(u.name || "Без имени")}</span>
          <span class="admin-user-dob">${escapeHtml(formatDobRu(u.dob))}</span>
        </div>
        <div class="admin-user-id">id: ${escapeHtml(String(u.tg_id ?? ""))}</div>
      </div>

      <div class="admin-user-scores">
        <div class="score-item" title="Домашнее задание">
          <span>📚</span>
          <input type="number" min="0" step="1" value="${Number(u.bible ?? 0)}" data-k="bible" />
        </div>
        <div class="score-item" title="Активное участие">
          <span>🔥</span>
          <input type="number" min="0" step="1" value="${Number(u.truth ?? 0)}" data-k="truth" />
        </div>
        <div class="score-item" title="Поведение">
          <span>😇</span>
          <input type="number" min="0" step="1" value="${Number(u.behavior ?? 0)}" data-k="behavior" />
        </div>
        <button class="btn primary btn-save-user" data-act="save" type="button">✓</button>
      </div>
      <div class="small center" style="margin-top: 6px;" data-msg></div>
    `;

    el.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const bible = Number(el.querySelector('[data-k="bible"]').value || 0);
      const truth = Number(el.querySelector('[data-k="truth"]').value || 0);
      const behavior = Number(el.querySelector('[data-k="behavior"]').value || 0);
      const msg = el.querySelector("[data-msg]");
      msg.textContent = "⏳ Сохранение...";

      try {
        await apiFast("adminUpdateStars", { tg_id: u.tg_id, bible, truth, behavior }, { force: true });
        clearMemCache("adminListUsers::");
        msg.textContent = "✅ Сохранено";
        msg.style.color = "var(--primary-dark)";
        hNotify("success");
        setTimeout(() => { if (msg) msg.textContent = ""; }, 2000);
      } catch(e){
        msg.textContent = "❌ Ошибка: " + e.message;
        msg.style.color = "var(--danger)";
        hNotify("error");
      }
    });

    wrap.appendChild(el);
  });
}

function normalizeSearchValue(value){
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function executeAdminSearch() {
  const inputEl = $("admin-search-user");
  if (!inputEl) return;

  const query = normalizeSearchValue(inputEl.value);
  if (!query) {
    filteredAdminUsers = [...allAdminUsers];
    $("admin-search-status").textContent = "Все";
    renderAdminUsers(filteredAdminUsers);
    return;
  }

  filteredAdminUsers = allAdminUsers.filter((u) => {
    const haystack = [
      u.name,
      u.tg_id,
      u.dob,
      formatDobRu(u.dob),
    ].map(normalizeSearchValue).join(" | ");

    return haystack.includes(query);
  });

  $("admin-search-status").textContent = `Найдено: ${filteredAdminUsers.length}`;
  renderAdminUsers(filteredAdminUsers);
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

$("inp-name").addEventListener("input", onboardingValidate);
$("inp-dob").addEventListener("input", onboardingValidate);
$("btn-confirm").addEventListener("click", doRegister);
$("btn-onboarding-switch").addEventListener("click", () => navigate("accounts"));

$("btn-forward").addEventListener("click", () => navigate("menu", { replace: true }));

$("btn-games").addEventListener("click", () => navigate("games"));
$("btn-games-back").addEventListener("click", () => navigate("menu"));

$("btn-homework").addEventListener("click", openHomework);
bindModalClose(modalHomework, $("btn-homework-close"));

$("btn-profile").addEventListener("click", openProfile);
$("btn-profile-switch-account").addEventListener("click", () => {
  hideModal(modalProfile);
  navigate("accounts");
});
bindModalClose(modalProfile, $("btn-profile-close"));

$("btn-switch-account").addEventListener("click", () => navigate("accounts"));
$("btn-account-create").addEventListener("click", beginCreateAccount);
$("btn-accounts-back").addEventListener("click", () => {
  if (hasLocalProfile()) navigate("menu", { replace: true });
  else navigate("onboarding", { replace: true });
});

$("btn-admin").addEventListener("click", openAdmin);
$("btn-admin-back").addEventListener("click", () => navigate("menu"));

$("btn-admin-save-homework").addEventListener("click", async () => {
  $("admin-homework-msg").textContent = "Сохранение...";
  try {
    await apiFast("adminSetHomework", { homework_text: $("admin-homework").value }, { force: true });
    clearMemCache("getHomework::");
    $("admin-homework-msg").textContent = "Сохранено ✅";
    hNotify("success");
  } catch(e){
    $("admin-homework-msg").textContent = "Ошибка: " + e.message;
    hNotify("error");
  }
});

const searchBtn = $("btn-admin-search");
if (searchBtn) searchBtn.addEventListener("click", executeAdminSearch);

const searchInput = $("admin-search-user");
if (searchInput) {
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeAdminSearch();
      searchInput.blur();
    }
  });

  searchInput.addEventListener("input", executeAdminSearch);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pollTick();
});

wireNavDelegation();
wireSwipeBack();
boot();
