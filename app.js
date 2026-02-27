// app.js

const GAS_URL = "https://script.google.com/macros/s/AKfycbyvBrRd7lXpHfzVZlB7s7EOl7gVIv8aCt-haf5l4o2ciGkZSa_NRFK4ajwiusidPnGuDQ/exec";
const POLL_MS = 10_000;

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

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function showModal(el){ el.classList.remove("hidden"); }
function hideModal(el){ el.classList.add("hidden"); }

function isVisible(el){
  return el && !el.classList.contains("hidden");
}

// На iOS внутри Telegram иногда "клик" по кнопке в overlay
// может не отрабатывать стабильно.
function bindModalClose(modalEl, closeBtnEl){
  if (!modalEl || !closeBtnEl) return;

  const close = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
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

function getTelegramIdentity(){
  if (!tg) return null;
  const u = tg.initDataUnsafe?.user;
  if (!u?.id) return null;
  return { id: String(u.id) };
}

/**
 * ✅ FIX iOS Telegram WebView / GAS:
 * Не используем application/json, чтобы не было preflight OPTIONS -> "Load failed"
 * Отправляем JSON строкой с Content-Type text/plain;charset=utf-8 (simple request)
 * + таймаут, чтобы не зависало.
 */
async function api(action, payload = {}){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        action,
        initData: state.initData,
        ...payload,
      })
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Сервер вернул не-JSON: " + text.slice(0, 120));
    }

    if (!data.ok) throw new Error(data.error || "API error");
    return data;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Таймаут запроса (15с). Проверь GAS / сеть.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function localGet(key){ return localStorage.getItem(key) || ""; }
function localSet(key,val){ localStorage.setItem(key, String(val)); }

function onboardingValidate(){
  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("btn-confirm").disabled = !(name && dob);
}

function applyProfileToUI(profile){
  if (!profile) return;

  // если открыт профиль — обновим цифры/имя/дату
  if (isVisible(modalProfile)){
    $("profile-name").textContent = profile.name || localGet("name") || "Пользователь";
    $("profile-dob").textContent = profile.dob || localGet("dob") || "";

    $("star-bible").textContent = profile.bible ?? 0;
    $("star-truth").textContent = profile.truth ?? 0;
    $("star-behavior").textContent = profile.behavior ?? 0;
  }
}

function applyHomeworkToUI(homeworkText){
  // если открыта модалка домашки — обновим текст
  if (isVisible(modalHomework)){
    $("homework-text").textContent = homeworkText || "Пока нет задания 🙂";
  }

  // если открыт экран админа — обновим textarea, но НЕ перезатираем, если пользователь редактирует
  if (screens.admin && !screens.admin.classList.contains("hidden")){
    const ta = $("admin-homework");
    const isEditing = document.activeElement === ta;
    if (ta && !isEditing){
      ta.value = homeworkText || "";
    }
  }
}

/** ✅ Поллинг каждые 10 секунд */
function startPolling(){
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, POLL_MS);
}

function stopPolling(){
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function pollTick(){
  // не долбим сеть, когда вкладка не активна
  if (document.hidden) return;
  // нет initData — нет смысла
  if (!state.initData) return;

  // обновляем профиль (звёзды/данные)
  try{
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    // подстрахуем локальное (чтобы не терялось)
    if (state.profile?.name) localSet("name", state.profile.name);
    if (state.profile?.dob) localSet("dob", state.profile.dob);

    applyProfileToUI(state.profile);
  }catch{ /* молча */ }

  // обновляем домашку, но только если она сейчас нужна (модалка/админ)
  const needHomework = isVisible(modalHomework) || (screens.admin && !screens.admin.classList.contains("hidden"));
  if (needHomework){
    try{
      const hw = await api("getHomework");
      applyHomeworkToUI(hw.homework_text || "");
    }catch{ /* молча */ }
  }
}

async function boot(){
  // прячем модалки на старте
  hideModal(modalHomework);
  hideModal(modalProfile);

  state.initData = tg?.initData || "";
  const ident = getTelegramIdentity();
  state.tgId = ident?.id || null;

  if (!state.tgId || !state.initData) {
    showScreen("onboarding");
    $("onboarding-error").textContent = "Открой это приложение внутри Telegram (WebApp), чтобы всё работало.";
    return;
  }

  // ✅ запускаем автообновление
  startPolling();

  try {
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    if (state.profile?.name) localSet("name", state.profile.name);
    if (state.profile?.dob) localSet("dob", state.profile.dob);

    // If already registered -> go hello
    if (state.profile?.name && state.profile?.dob) {
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
    $("homework-text").textContent = "Не удалось загрузить задание: " + e.message;
    showModal(modalHomework);
  }
}

async function openProfile(){
  try {
    const r = await api("getProfile");
    state.isAdmin = !!r.isAdmin;
    state.profile = r.profile;

    applyProfileToUI(state.profile);
    showModal(modalProfile);
  } catch (e) {
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
bindModalClose(modalHomework, $("btn-homework-close"));

$("btn-profile").addEventListener("click", openProfile);
bindModalClose(modalProfile, $("btn-profile-close"));

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

// чтобы поллинг не работал, когда приложение скрыто
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  pollTick();
});

boot();
