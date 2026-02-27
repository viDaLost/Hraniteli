// app.js

const GAS_URL = "https://script.google.com/macros/s/AKfycbzD85Ycs67qZ5Rm-FZ6kyzbfYnm9fYZrFucfM1qeABi_hXEMgDEVEHgcaCbFTWwwUPq/exec";

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

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function showModal(el){ el.classList.remove("hidden"); }
function hideModal(el){ el.classList.add("hidden"); }

function getTelegramIdentity(){
  // In Telegram WebApp, user is in initDataUnsafe.user
  if (!tg) return null;
  const u = tg.initDataUnsafe?.user;
  if (!u?.id) return null;
  return { id: String(u.id) };
}

async function api(action, payload = {}){
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      action,
      initData: state.initData,
      ...payload,
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "API error");
  return data;
}

function localGet(key){ return localStorage.getItem(key) || ""; }
function localSet(key,val){ localStorage.setItem(key, String(val)); }

function onboardingValidate(){
  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("btn-confirm").disabled = !(name && dob);
}

async function boot(){
  // Telegram init
  state.initData = tg?.initData || "";
  const ident = getTelegramIdentity();

  // Для теста в браузере (без Telegram) можно временно подставить ID,
  // но в реальном Telegram этого не нужно.
  state.tgId = ident?.id || null;

  // Если открыли не из Telegram — покажем onboarding, но API не сработает (нет initData)
  if (!state.tgId || !state.initData) {
    showScreen("onboarding");
    $("onboarding-error").textContent = "Открой это приложение внутри Telegram (WebApp), чтобы всё работало.";
    return;
  }

  // Try getProfile
  try {
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    // If already registered -> go hello/menu
    if (state.profile?.name && state.profile?.dob) {
      // store locally too
      localSet("name", state.profile.name);
      localSet("dob", state.profile.dob);

      $("hello-title").textContent = `Отлично, рад познакомиться, ${state.profile.name}!`;
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
    showScreen("hello");
  } catch (e) {
    $("onboarding-error").textContent = e.message;
  }
}

async function openHomework(){
  try {
    const r = await api("getHomework");
    $("homework-text").textContent = r.homework_text || "Пока нет задания 🙂";
    showModal(modalHomework);
  } catch (e) {
    $("homework-text").textContent = "Не удалось загрузить задание.";
    showModal(modalHomework);
  }
}

async function openProfile(){
  try {
    const r = await api("getProfile");
    state.isAdmin = !!r.isAdmin;
    state.profile = r.profile;

    $("profile-name").textContent = state.profile.name || localGet("name") || "Пользователь";
    $("profile-dob").textContent = state.profile.dob || localGet("dob") || "";

    $("star-bible").textContent = state.profile.bible ?? 0;
    $("star-truth").textContent = state.profile.truth ?? 0;
    $("star-behavior").textContent = state.profile.behavior ?? 0;

    showModal(modalProfile);
  } catch (e) {
    // fallback local
    $("profile-name").textContent = localGet("name") || "Пользователь";
    $("profile-dob").textContent = localGet("dob") || "";
    $("star-bible").textContent = "0";
    $("star-truth").textContent = "0";
    $("star-behavior").textContent = "0";
    showModal(modalProfile);
  }
}

/** ===== Admin ===== */
async function openAdmin(){
  showScreen("admin");

  // load homework
  try {
    const hw = await api("getHomework");
    $("admin-homework").value = hw.homework_text || "";
  } catch {}

  // list users
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
        } catch(e){
          msg.textContent = "Ошибка: " + e.message;
        }
      });

      wrap.appendChild(el);
    });
  } catch (e) {
    wrap.innerHTML = "Ошибка загрузки пользователей: " + escapeHtml(e.message);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

/** ===== Bindings ===== */
$("inp-name").addEventListener("input", onboardingValidate);
$("inp-dob").addEventListener("input", onboardingValidate);
$("btn-confirm").addEventListener("click", doRegister);

$("btn-forward").addEventListener("click", () => showScreen("menu"));

$("btn-games").addEventListener("click", () => showScreen("games"));
$("btn-games-back").addEventListener("click", () => showScreen("menu"));

$("btn-homework").addEventListener("click", openHomework);
$("btn-homework-close").addEventListener("click", () => hideModal(modalHomework));

$("btn-profile").addEventListener("click", openProfile);
$("btn-profile-close").addEventListener("click", () => hideModal(modalProfile));

$("btn-admin").addEventListener("click", openAdmin);
$("btn-admin-back").addEventListener("click", () => showScreen("menu"));

$("btn-admin-save-homework").addEventListener("click", async () => {
  $("admin-homework-msg").textContent = "Сохранение...";
  try {
    await api("adminSetHomework", { homework_text: $("admin-homework").value });
    $("admin-homework-msg").textContent = "Сохранено ✅";
  } catch(e){
    $("admin-homework-msg").textContent = "Ошибка: " + e.message;
  }
});

boot();
