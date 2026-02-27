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

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function showModal(el) {
  if (!el) return;
  el.classList.remove("hidden");
}
function hideModal(el) {
  if (!el) return;
  el.classList.add("hidden");
}

/**
 * Надёжный "тап" для iOS/Telegram WebView:
 * - touchend (чтобы не было проблем с click)
 * - click (для остальных)
 */
function addTap(el, handler) {
  if (!el) return;

  const wrapped = (e) => {
    // чтобы не происходили "двойные" срабатывания и странности iOS
    try { e.preventDefault?.(); } catch {}
    try { e.stopPropagation?.(); } catch {}
    handler(e);
  };

  el.addEventListener("touchend", wrapped, { passive: false });
  el.addEventListener("click", wrapped);
}

function getTelegramIdentity() {
  // In Telegram WebApp, user is in initDataUnsafe.user
  if (!tg) return null;
  const u = tg.initDataUnsafe?.user;
  if (!u?.id) return null;
  return { id: String(u.id) };
}

async function api(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      initData: state.initData,
      ...payload,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "API error");
  return data;
}

function localGet(key) {
  return localStorage.getItem(key) || "";
}
function localSet(key, val) {
  localStorage.setItem(key, String(val));
}

function onboardingValidate() {
  const name = $("inp-name").value.trim();
  const dob = $("inp-dob").value.trim();
  $("btn-confirm").disabled = !(name && dob);
}

async function boot() {
  // ✅ ЖЁСТКО скрываем модалки на старте (фикс “модалка открывается сама”)
  hideModal(modalProfile);
  hideModal(modalHomework);

  // Telegram init
  state.initData = tg?.initData || "";
  const ident = getTelegramIdentity();

  state.tgId = ident?.id || null;

  // If opened not from Telegram
  if (!state.tgId || !state.initData) {
    showScreen("onboarding");
    $("onboarding-error").textContent =
      "Открой это приложение внутри Telegram (WebApp), чтобы всё работало.";
    return;
  }

  // Try getProfile
  try {
    const p = await api("getProfile");
    state.isAdmin = !!p.isAdmin;
    state.profile = p.profile;

    // If already registered -> go hello
    if (state.profile?.name && state.profile?.dob) {
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

async function doRegister() {
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
    showScreen("hello");
    if (state.isAdmin) $("btn-admin").classList.remove("hidden");
  } catch (e) {
    $("onboarding-error").textContent = e.message;
  }
}

/** ===== Homework ===== */
async function openHomework() {
  try {
    const r = await api("getHomework");
    $("homework-text").textContent = r.homework_text || "Пока нет домашнего задания.";
  } catch (e) {
    $("homework-text").textContent = "Не удалось загрузить задание: " + e.message;
  }
  showModal(modalHomework);
}

/** ===== Profile ===== */
async function openProfile() {
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
async function openAdmin() {
  showScreen("admin");

  // load homework
  try {
    const hw = await api("getHomework");
    $("admin-homework").value = hw.homework_text || "";
  } catch {}

  // list users
  await refreshAdminUsers();
}

async function refreshAdminUsers() {
  const wrap = $("admin-users");
  wrap.innerHTML = "Загрузка...";
  try {
    const r = await api("adminListUsers");
    wrap.innerHTML = "";
    r.users.forEach((u) => {
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
            <input type="number" min="0" step="1" value="${u.bible ?? 0}" data-k="bible" />
          </div>
          <div>
            <div class="small">Основы истины</div>
            <input type="number" min="0" step="1" value="${u.truth ?? 0}" data-k="truth" />
          </div>
          <div>
            <div class="small">Поведение</div>
            <input type="number" min="0" step="1" value="${u.behavior ?? 0}" data-k="behavior" />
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
        } catch (e) {
          msg.textContent = "Ошибка: " + e.message;
        }
      });

      wrap.appendChild(el);
    });
  } catch (e) {
    wrap.innerHTML = "Ошибка загрузки пользователей: " + escapeHtml(e.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

/** ===== Bindings ===== */
$("inp-name").addEventListener("input", onboardingValidate);
$("inp-dob").addEventListener("input", onboardingValidate);
addTap($("btn-confirm"), doRegister);

addTap($("btn-forward"), () => showScreen("menu"));

addTap($("btn-games"), () => showScreen("games"));
addTap($("btn-games-back"), () => showScreen("menu"));

addTap($("btn-homework"), openHomework);
addTap($("btn-homework-close"), () => hideModal(modalHomework));

addTap($("btn-profile"), openProfile);
addTap($("btn-profile-close"), () => hideModal(modalProfile));

// ✅ закрытие по тапу на затемнение (вне карточки)
if (modalProfile) {
  modalProfile.addEventListener("click", (e) => {
    if (e.target === modalProfile) hideModal(modalProfile);
  });
  modalProfile.addEventListener("touchend", (e) => {
    if (e.target === modalProfile) hideModal(modalProfile);
  }, { passive: true });
}

if (modalHomework) {
  modalHomework.addEventListener("click", (e) => {
    if (e.target === modalHomework) hideModal(modalHomework);
  });
  modalHomework.addEventListener("touchend", (e) => {
    if (e.target === modalHomework) hideModal(modalHomework);
  }, { passive: true });
}

addTap($("btn-admin"), openAdmin);
addTap($("btn-admin-back"), () => showScreen("menu"));

addTap($("btn-admin-save-homework"), async () => {
  $("admin-homework-msg").textContent = "Сохранение...";
  try {
    await api("adminSetHomework", { homework_text: $("admin-homework").value });
    $("admin-homework-msg").textContent = "Сохранено ✅";
  } catch (e) {
    $("admin-homework-msg").textContent = "Ошибка: " + e.message;
  }
});

boot();
