// app.js

const GAS_URL = "https://script.google.com/macros/s/AKfycbyBN0uymqGot1ulvpuSUonOQmZ8ifgQER3I5Ehov5rREjxB2izwf2M68oNuNiFZfmeKzA/exec";
const POLL_MS = 10000;

const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

const $ = (id) => document.getElementById(id);

const screens = {
  onboarding: $("screen-onboarding"),
  hello: $("screen-hello"),
  menu: $("screen-menu"),
  games: $("screen-games"),
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

/* ================= UI ================= */

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function showModal(el){ el.classList.remove("hidden"); }
function hideModal(el){ el.classList.add("hidden"); }

function isVisible(el){
  return el && !el.classList.contains("hidden");
}

/* ================= TELEGRAM ================= */

function getTelegramIdentity(){
  if (!tg) return null;
  const u = tg.initDataUnsafe?.user;
  if (!u?.id) return null;
  return { id: String(u.id) };
}

/* ================= API (СТАБИЛЬНАЯ ВЕРСИЯ) ================= */

async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      // ❗ ВАЖНО: никаких headers
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
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 140)}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Сервер вернул не-JSON: " + text.slice(0, 140));
    }

    if (!data.ok) throw new Error(data.error || "API error");
    return data;

  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Таймаут запроса (15с)");
    }
    throw new Error(e?.message || "Load failed");
  } finally {
    clearTimeout(timeout);
  }
}

/* ================= LOCAL ================= */

function localGet(key){ return localStorage.getItem(key) || ""; }
function localSet(key,val){ localStorage.setItem(key, String(val)); }

/* ================= PROFILE ================= */

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

/* ================= HOMEWORK ================= */

function applyHomeworkToUI(homeworkText){
  if (isVisible(modalHomework)){
    $("homework-text").textContent = homeworkText || "Пока нет задания 🙂";
  }

  if (screens.admin && !screens.admin.classList.contains("hidden")){
    const ta = $("admin-homework");
    if (ta && document.activeElement !== ta){
      ta.value = homeworkText || "";
    }
  }
}

/* ================= POLLING ================= */

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

  const needHomework =
    isVisible(modalHomework) ||
    (screens.admin && !screens.admin.classList.contains("hidden"));

  if (needHomework){
    try{
      const hw = await api("getHomework");
      applyHomeworkToUI(hw.homework_text || "");
    }catch{}
  }
}

/* ================= BOOT ================= */

async function boot(){
  hideModal(modalHomework);
  hideModal(modalProfile);

  state.initData = tg?.initData || "";
  const ident = getTelegramIdentity();
  state.tgId = ident?.id || null;

  if (!state.tgId || !state.initData) {
    showScreen("onboarding");
    $("onboarding-error").textContent =
      "Открой это приложение внутри Telegram.";
    return;
  }

  startPolling();

  try {
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    if (state.profile?.name && state.profile?.dob) {
      $("hello-title").textContent =
        `Отлично, рад познакомиться, ${state.profile.name}!`;
      showScreen("hello");
      if (state.isAdmin) $("btn-admin").classList.remove("hidden");
      return;
    }

    showScreen("onboarding");
  } catch (e) {
    showScreen("onboarding");
    $("onboarding-error").textContent = e.message;
  }
}

/* ================= ACTIONS ================= */

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

    $("hello-title").textContent =
      `Отлично, рад познакомиться, ${name}!`;

    if (state.isAdmin) $("btn-admin").classList.remove("hidden");

    showScreen("hello");
  } catch (e) {
    $("onboarding-error").textContent = e.message;
  }
}

async function openHomework(){
  try {
    const r = await api("getHomework");
    $("homework-text").textContent =
      r.homework_text || "Пока нет задания 🙂";
  } catch (e) {
    $("homework-text").textContent =
      "Ошибка: " + e.message;
  }
  showModal(modalHomework);
}

async function openProfile(){
  try {
    const r = await api("getProfile");
    state.profile = r.profile;
    applyProfileToUI(state.profile);
  } catch {}
  showModal(modalProfile);
}

/* ================= BINDINGS ================= */

$("btn-confirm").addEventListener("click", doRegister);
$("btn-forward").addEventListener("click", () => showScreen("menu"));
$("btn-games").addEventListener("click", () => showScreen("games"));
$("btn-games-back").addEventListener("click", () => showScreen("menu"));
$("btn-homework").addEventListener("click", openHomework);
$("btn-profile").addEventListener("click", openProfile);
$("btn-homework-close").addEventListener("click", () => hideModal(modalHomework));
$("btn-profile-close").addEventListener("click", () => hideModal(modalProfile));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pollTick();
});

boot();
