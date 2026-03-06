<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>Хранитель света</title>
  <meta name="theme-color" content="#F9F6F0" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <div class="app app-wrapper">
    <div class="viewport" id="viewport">

      <section id="screen-loading" class="screen center" data-route="loading">
        <div class="spinner" aria-hidden="true"></div>
        <h1 class="big">Загрузка…</h1>
        <p class="muted">Проверяем ваши данные</p>
      </section>

      <section id="screen-onboarding" class="screen hidden" data-route="onboarding">
        <img class="mascot-img" src="assets/mascot_onboarding.png" alt="">
        <div class="screen-header">
          <h1>Привет! Я Хранитель света</h1>
          <p class="muted">
            Я твой проводник и помощник в изучении священного писания.
            Для начала давай познакомимся: укажи своё настоящее имя и дату рождения.
          </p>
        </div>

        <div class="card">
          <div class="input-group">
            <label>Имя</label>
            <input id="inp-name" type="text" placeholder="Например: Миша" autocomplete="name" />
          </div>
          <div class="input-group">
            <label>Дата рождения</label>
            <input id="inp-dob" type="date" />
          </div>
          <button id="btn-confirm" class="btn primary" disabled type="button">Подтвердить</button>
          <div id="onboarding-error" class="error"></div>
        </div>
      </section>

      <section id="screen-hello" class="screen hidden" data-route="hello">
        <div class="screen-content center">
          <img class="mascot-img" src="assets/mascot_hello.png" alt="">
          <h1 id="hello-title">Отлично, рад познакомиться!</h1>
          <p class="muted">А теперь давай окунёмся в мир знаний.</p>
        </div>
        <div class="bottom-action">
          <button id="btn-forward" class="btn primary" type="button">Вперёд</button>
        </div>
      </section>

      <section id="screen-menu" class="screen hidden" data-route="menu">
        <div class="screen-header">
          <img class="mascot-img" src="assets/mascot_menu.png" alt="">
          <h1>Главное меню</h1>
        </div>

        <div class="menu-grid">
          <div class="tile" id="btn-games" role="button" tabindex="0">
            <span class="tile-icon">🎮</span>
            Библейские игры
          </div>
          <div class="tile" id="btn-homework" role="button" tabindex="0">
            <span class="tile-icon">📚</span>
            Домашнее задание
          </div>
          <div class="tile" id="btn-profile" role="button" tabindex="0">
            <span class="tile-icon">👤</span>
            Мой профиль
          </div>
          <div class="tile admin hidden" id="btn-admin" role="button" tabindex="0">
            <span class="tile-icon">⚙️</span>
            Админ
          </div>
        </div>
      </section>

      <section id="screen-games" class="screen hidden" data-route="games">
        <div class="screen-header">
          <img class="mascot-img" src="assets/mascot_games.png" alt="">
          <h1>Библейские игры</h1>
        </div>

        <div class="menu-grid">
          <div class="tile" data-nav="match" role="button" tabindex="0">
            <span class="tile-icon">🃏</span>
            Найди пару
          </div>
          <div class="tile" data-nav="word" role="button" tabindex="0">
            <span class="tile-icon">🔤</span>
            Найди слово
          </div>
        </div>

        <div class="bottom-action">
          <button class="btn secondary" id="btn-games-back" type="button">← Главное меню</button>
        </div>
      </section>

      <section id="screen-match" class="screen hidden" data-route="match">
        <div class="screen-header">
          <img class="mascot-img" src="assets/mascot_match.png" alt="">
          <h1>Найди пару</h1>
          <p class="muted">Переворачивай карточки и ищи совпадения</p>
        </div>

        <div id="match-pick" class="card">
          <h2>Размер поля</h2>
          <div class="menu-grid">
            <div class="tile" data-match-size="4" role="button" tabindex="0">4 × 4</div>
            <div class="tile" data-match-size="6" role="button" tabindex="0">6 × 6</div>
            <div class="tile" data-match-size="8" role="button" tabindex="0">8 × 8</div>
          </div>
          <div class="action-row">
            <button class="btn secondary" data-back type="button">← Назад</button>
            <button class="btn secondary" data-nav="menu" type="button">В меню</button>
          </div>
        </div>

        <div id="match-game" class="hidden">
          <div class="top-actions">
            <button class="btn secondary small" id="match-btn-back" type="button">← Сменить поле</button>
            <button class="btn secondary small" data-nav="menu" type="button">Меню</button>
          </div>
          <div id="match-board" class="board"></div>
        </div>

        <div id="match-win" class="modal hidden">
          <div class="modal-backdrop"></div>
          <div class="modal-card center">
            <img class="mascot-img" src="assets/mascot_win.png" alt="">
            <h2>Молодец! Ты нашёл всем пару!</h2>
            <button class="btn primary" id="match-btn-win-close" type="button">Закрыть</button>
          </div>
        </div>
      </section>

      <section id="screen-word" class="screen hidden" data-route="word">
        <div class="screen-header">
          <img class="mascot-img" src="assets/mascot_word.png" alt="">
          <h1>Найди слово</h1>
          <p class="muted">Выбери слово, которое подходит в пропуск.</p>
        </div>

        <div class="card verse-card">
          <div id="word-verse" class="verse"></div>
          <div id="word-ref" class="muted word-ref"></div>
        </div>

        <div id="word-options" class="menu-grid options-grid"></div>

        <div class="bottom-action row">
          <button class="btn secondary" data-back type="button">← Назад</button>
          <button class="btn primary" id="word-btn-next" type="button">Следующее</button>
        </div>
      </section>

      <section id="screen-admin" class="screen hidden" data-route="admin">
        <div class="screen-header">
          <h1>Админ-панель</h1>
        </div>

        <div class="card">
          <h2>Домашнее задание</h2>
          <textarea id="admin-homework" rows="4" placeholder="Введите текст для всех учеников..."></textarea>
          <button id="btn-admin-save-homework" class="btn primary" type="button" style="margin-top: 12px;">Сохранить задание</button>
          <div id="admin-homework-msg" class="muted center" style="margin-top: 8px;"></div>
        </div>

        <div class="card">
          <h2>Пользователи</h2>
          <div style="display: flex; gap: 8px; margin-bottom: 16px;">
            <input type="text" id="admin-search-user" placeholder="Имя или ID..." style="margin-bottom: 0; flex: 1;" />
            <button id="btn-admin-search" class="btn primary" type="button" style="width: auto; padding: 0 16px;">Искать</button>
          </div>
          
          <div id="admin-users" class="admin-users"></div>
        </div>

        <div class="bottom-action">
          <button class="btn secondary" id="btn-admin-back" type="button">← Главное меню</button>
        </div>
      </section>

    </div>

    <div id="modal-homework" class="modal hidden">
      <div class="modal-backdrop"></div>
      <div class="modal-card bottom-sheet">
        <div class="drag-handle"></div>
        <img class="mascot-img small-mascot" src="assets/mascot_homework.png" alt="">
        <h2>Домашнее задание</h2>
        <div class="homework-content">
          <p id="homework-text" class="muted"></p>
        </div>
        <button class="btn primary" id="btn-homework-close" type="button">Понятно</button>
      </div>
    </div>

    <div id="modal-profile" class="modal hidden">
      <div class="modal-backdrop"></div>
      <div class="modal-card bottom-sheet">
        <div class="drag-handle"></div>
        <img class="mascot-img small-mascot" src="assets/mascot_profile.png" alt="">
        <h2 id="profile-name" class="center big"></h2>
        <div id="profile-dob" class="center muted"></div>

        <div class="stars-container">
          <div class="star-row">
            <span class="star-label">За домашнее задание</span>
            <span class="badge blue"><span id="star-bible">0</span> ⭐️</span>
          </div>
          <div class="star-row">
            <span class="star-label">За активное участие</span>
            <span class="badge gold"><span id="star-truth">0</span> ⭐️</span>
          </div>
          <div class="star-row">
            <span class="star-label">За поведение</span>
            <span class="badge green"><span id="star-behavior">0</span> ⭐️</span>
          </div>
        </div>

        <button class="btn secondary" id="btn-profile-close" type="button">Закрыть</button>
      </div>
    </div>

  </div>

  <script src="games/match.js" defer></script>
  <script src="games/word.js" defer></script>
  <script src="app.js" defer></script>
</body>
</html>
