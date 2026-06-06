/****************************************
 * ХРАНИТЕЛЬ СВЕТА — APPS SCRIPT BACKEND
 * WebApp API + Telegram bot commands + birthday notifications
 ****************************************/

/****************************************
 * НАСТРОЙКИ
 ****************************************/
const SHEET_USERS = 'Users';
const SHEET_CONFIG = 'Config';
const DEFAULT_ACCOUNT_ID = 'main';

const CONFIG_KEYS = {
  HOMEWORK_TEXT: 'homework_text',
  HOMEWORK_NOTIFY_DEFAULT: 'homework_notify_default',
  HOMEWORK_UPDATED_AT: 'homework_updated_at',
  HOMEWORK_UPDATED_BY: 'homework_updated_by',
  BIRTHDAY_NOTIFY_ENABLED: 'birthday_notify_enabled',
  BIRTHDAY_LAST_SENT_DATE: 'birthday_last_sent_date',
  BIRTHDAY_NOTIFY_HOUR: 'birthday_notify_hour'
};

const DEFAULT_CONFIG = {
  homework_text: '',
  homework_notify_default: 'true',
  homework_updated_at: '',
  homework_updated_by: '',
  birthday_notify_enabled: 'true',
  birthday_last_sent_date: '',
  birthday_notify_hour: '9'
};

/****************************************
 * ПРОВЕРКА ДОСТУПА
 ****************************************/
function doGet() {
  return ContentService.createTextOutput('OK');
}

/****************************************
 * WEB APP + TELEGRAM WEBHOOK ENTRY
 ****************************************/
function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw || '{}');

    // Telegram присылает update без поля action.
    // Важно: Telegram повторяет один и тот же update, если webhook не успел корректно ответить.
    // Поэтому сначала быстро отсекаем дубликаты по update_id, а ошибки обработчика логируем,
    // чтобы Telegram всегда получил 200 OK и не начал спамить одной командой.
    if (isTelegramUpdate_(body)) {
      if (!markTelegramUpdateOnce_(body.update_id)) {
        return json_({ ok: true, skipped: 'duplicate_update' });
      }

      try {
        handleTelegramUpdate_(body);
      } catch (telegramErr) {
        Logger.log('Telegram handler error: ' + String(telegramErr && telegramErr.stack ? telegramErr.stack : telegramErr));
      }

      return json_({ ok: true });
    }

    const action = String(body.action || '').trim();
    const initData = body.initData || '';
    const accountId = normalizeAccountId_(body.account_id);

    const tgUser = verifyTelegramInitData_(initData);
    const tgId = String(tgUser.id);
    const isAdmin = isAdmin_(tgId);

    switch (action) {
      case 'register': {
        const name = String(body.name || '').trim();
        const dob = String(body.dob || '').trim();
        if (!name || !dob) throw new Error('Заполни имя и дату рождения');

        upsertUser_(tgId, accountId, name, dob);
        return json_({ ok: true, profile: getUser_(tgId, accountId), isAdmin });
      }

      case 'getProfile': {
        return json_({ ok: true, profile: getUser_(tgId, accountId), isAdmin });
      }

      case 'getHomework': {
        return json_({ ok: true, homework_text: getHomework_(), isAdmin });
      }

      case 'adminListUsers': {
        if (!isAdmin) throw new Error('Нет доступа');
        return json_({ ok: true, users: listUsers_(), isAdmin });
      }

      case 'adminUpdateStars': {
        if (!isAdmin) throw new Error('Нет доступа');
        setStars_(body.tg_id, body.account_id, body.bible, body.truth, body.behavior);
        return json_({ ok: true });
      }

      case 'adminSetHomework': {
        if (!isAdmin) throw new Error('Нет доступа');
        const text = String(body.homework_text || '');
        const shouldNotify = body.notify === true || body.notify === 'true' || body.notify === 1 || body.notify === '1' ||
          body.notify_users === true || body.notify_users === 'true' || body.notify_users === 1 || body.notify_users === '1';
        setHomework_(text, tgId);

        let notifyResult = null;
        if (shouldNotify) {
          notifyResult = notifyHomeworkChanged_(text, tgUser.first_name || tgUser.username || tgId);
        }

        return json_({ ok: true, notified: notifyResult });
      }

      default:
        throw new Error('Неизвестное действие');
    }
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/****************************************
 * TELEGRAM BOT HANDLER
 ****************************************/
function handleTelegramUpdate_(update) {
  const msg = update.message || update.edited_message;
  const cb = update.callback_query;

  if (cb) {
    answerCallbackQuery_(cb.id);
    return;
  }

  if (!msg || !msg.chat) return;

  const chatId = String(msg.chat.id);
  const from = msg.from || {};
  const fromId = String(from.id || '');
  const text = String(msg.text || '').trim();

  if (fromId) rememberBotChat_(from, msg.chat);

  if (!text) return;

  const parsed = parseCommand_(text);
  if (!parsed.command) return;

  const isAdmin = isAdmin_(fromId);

  try {
    switch (parsed.command) {
      case '/start': {
        sendBotWelcome_(chatId, fromId, isAdmin);
        return;
      }

      case '/help': {
        sendTelegramMessage_(chatId, getBotHelpText_(isAdmin));
        return;
      }

      case '/notify_on':
      case '/notifications_on': {
        setBotNotifications_(fromId, true);
        sendTelegramMessage_(chatId, '✅ Уведомления включены. Теперь бот сможет присылать тебе новости о домашнем задании и важных событиях.');
        return;
      }

      case '/notify_off':
      case '/notifications_off': {
        setBotNotifications_(fromId, false);
        sendTelegramMessage_(chatId, '🔕 Уведомления отключены. Включить обратно можно командой /notify_on.');
        return;
      }

      case '/dz': {
        if (!isAdmin) {
          sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
          return;
        }

        const dz = parseDzArguments_(parsed.args);
        if (!dz.text) {
          sendTelegramMessage_(chatId, getDzUsageText_());
          return;
        }

        const defaultNotify = getConfigBool_(CONFIG_KEYS.HOMEWORK_NOTIFY_DEFAULT, true);
        const shouldNotify = dz.notify === null ? defaultNotify : dz.notify;

        setHomework_(dz.text, fromId);

        let tail = '';
        if (shouldNotify) {
          const result = notifyHomeworkChanged_(dz.text, getDisplayNameFromTelegramUser_(from));
          tail = '\n\n📣 Уведомление отправлено: ' + result.sent + '. Ошибок: ' + result.failed + '.';
        } else {
          tail = '\n\n🔕 Уведомление не отправлялось.';
        }

        sendTelegramMessage_(chatId, '✅ Домашнее задание обновлено.' + tail);
        return;
      }

      case '/dz_on':
      case '/dz_notify_on': {
        if (!isAdmin) return sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
        setConfig_(CONFIG_KEYS.HOMEWORK_NOTIFY_DEFAULT, 'true');
        sendTelegramMessage_(chatId, '✅ По умолчанию команда /dz будет отправлять уведомление всем пользователям.');
        return;
      }

      case '/dz_off':
      case '/dz_notify_off': {
        if (!isAdmin) return sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
        setConfig_(CONFIG_KEYS.HOMEWORK_NOTIFY_DEFAULT, 'false');
        sendTelegramMessage_(chatId, '🔕 По умолчанию команда /dz будет менять задание тихо, без рассылки. Для разовой рассылки используй /dz --notify текст задания.');
        return;
      }

      case '/birthday_on':
      case '/birthdays_on': {
        if (!isAdmin) return sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
        setConfig_(CONFIG_KEYS.BIRTHDAY_NOTIFY_ENABLED, 'true');
        sendTelegramMessage_(chatId, '✅ Автоуведомления о днях рождения включены.');
        return;
      }

      case '/birthday_off':
      case '/birthdays_off': {
        if (!isAdmin) return sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
        setConfig_(CONFIG_KEYS.BIRTHDAY_NOTIFY_ENABLED, 'false');
        sendTelegramMessage_(chatId, '🔕 Автоуведомления о днях рождения отключены.');
        return;
      }

      case '/birthdays': {
        if (!isAdmin) return sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
        const birthdayUsers = getTodaysBirthdayUsers_();
        sendTelegramMessage_(chatId, buildBirthdayMessage_(birthdayUsers, false));
        return;
      }

      case '/birthday_check':
      case '/birthdays_check': {
        if (!isAdmin) return sendTelegramMessage_(chatId, '⛔ Команда доступна только администраторам.');
        const result = checkBirthdaysDaily(true);
        sendTelegramMessage_(chatId, '✅ Проверка дней рождения выполнена. Отправлено: ' + result.sent + '. Ошибок: ' + result.failed + '.');
        return;
      }

      default: {
        sendTelegramMessage_(chatId, 'Не понял команду. Напиши /help, чтобы посмотреть список команд.');
      }
    }
  } catch (err) {
    sendTelegramMessage_(chatId, '❌ Ошибка: ' + String(err && err.message ? err.message : err));
  }
}

function parseCommand_(text) {
  const trimmed = String(text || '').trim();
  const firstSpace = trimmed.search(/\s/);
  const rawCommand = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const args = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
  const command = rawCommand.split('@')[0].toLowerCase();
  return { command, args };
}

function parseDzArguments_(args) {
  let text = String(args || '').trim();
  let notify = null;

  if (!text) return { text: '', notify };

  const silentPatterns = [
    /^--silent\s+/i,
    /^--quiet\s+/i,
    /^-s\s+/i,
    /^тихо\s+/i,
    /^без\s+уведомлен(?:ия|ий)\s+/i,
    /^без\s+рассылки\s+/i
  ];

  const notifyPatterns = [
    /^--notify\s+/i,
    /^--send\s+/i,
    /^-n\s+/i,
    /^с\s+уведомлением\s+/i,
    /^с\s+рассылкой\s+/i
  ];

  silentPatterns.some(function (re) {
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      notify = false;
      return true;
    }
    return false;
  });

  notifyPatterns.some(function (re) {
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      notify = true;
      return true;
    }
    return false;
  });

  return { text, notify };
}

function getDzUsageText_() {
  return [
    'Команда для смены домашнего задания:',
    '',
    '<code>/dz текст задания</code> — сохранить и отправить уведомление, если рассылка включена по умолчанию.',
    '<code>/dz --silent текст задания</code> — сохранить без уведомления.',
    '<code>/dz --notify текст задания</code> — сохранить и принудительно отправить уведомление.',
    '',
    'Примеры:',
    '<code>/dz Прочитать Иоанна 3:16 и выучить стих</code>',
    '<code>/dz тихо Повторить прошлое задание</code>'
  ].join('\n');
}

function getBotHelpText_(isAdmin) {
  const base = [
    '✨ <b>Хранитель света</b>',
    '',
    '<b>Команды пользователя:</b>',
    '/start — подключить бота',
    '/notify_on — включить уведомления',
    '/notify_off — отключить уведомления',
    '/help — помощь'
  ];

  if (isAdmin) {
    base.push(
      '',
      '<b>Команды администратора:</b>',
      '/dz текст — поменять домашнее задание',
      '/dz --silent текст — поменять без уведомления',
      '/dz --notify текст — поменять и отправить уведомление',
      '/dz_on — включить рассылку для /dz по умолчанию',
      '/dz_off — выключить рассылку для /dz по умолчанию',
      '/birthdays — показать сегодняшние дни рождения',
      '/birthday_check — проверить дни рождения и отправить уведомление',
      '/birthday_on — включить автоуведомления о днях рождения',
      '/birthday_off — отключить автоуведомления о днях рождения'
    );
  }

  return base.join('\n');
}

function sendBotWelcome_(chatId, fromId, isAdmin) {
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || '';
  const text = [
    '✨ Привет! Я бот приложения <b>Хранитель света</b>.',
    '',
    'Я буду присылать уведомления о домашнем задании и важных событиях.',
    'Отключить уведомления можно командой /notify_off.',
    '',
    isAdmin ? 'Ты распознан как администратор. Напиши /help, чтобы увидеть админ-команды.' : 'Напиши /help, чтобы увидеть команды.'
  ].join('\n');

  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (webAppUrl) {
    payload.reply_markup = {
      inline_keyboard: [[
        { text: 'Открыть мини-приложение', web_app: { url: webAppUrl } }
      ]]
    };
  }

  telegramApi_('sendMessage', payload);
}

/****************************************
 * HOMEWORK NOTIFICATIONS
 ****************************************/
function notifyHomeworkChanged_(homeworkText, adminName) {
  const preview = String(homeworkText || '').trim();
  const safePreview = preview.length > 1200 ? preview.slice(0, 1200) + '…' : preview;
  const updatedBy = adminName ? '\nИзменил: <b>' + escapeHtml_(adminName) + '</b>' : '';

  const text = [
    '📚 <b>Домашнее задание обновлено</b>',
    updatedBy,
    '',
    safePreview ? escapeHtml_(safePreview) : 'Новое задание пока пустое.',
    '',
    'Открой мини-приложение, чтобы посмотреть задание полностью.'
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  return sendBroadcast_(text, { kind: 'homework' });
}

/****************************************
 * BIRTHDAY NOTIFICATIONS
 ****************************************/
function checkBirthdaysDaily(force) {
  const forceMode = force === true;
  const enabled = getConfigBool_(CONFIG_KEYS.BIRTHDAY_NOTIFY_ENABLED, true);
  if (!enabled && !forceMode) return { sent: 0, failed: 0, skipped: true, reason: 'birthday notifications disabled' };

  const tz = getTimeZone_();
  const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const lastSent = getConfig_(CONFIG_KEYS.BIRTHDAY_LAST_SENT_DATE, '');
  if (!forceMode && lastSent === todayKey) return { sent: 0, failed: 0, skipped: true, reason: 'already sent today' };

  const birthdayUsers = getTodaysBirthdayUsers_();
  if (!birthdayUsers.length) return { sent: 0, failed: 0, skipped: true, reason: 'no birthdays today' };

  const message = buildBirthdayMessage_(birthdayUsers, true);
  const result = sendBroadcast_(message, { kind: 'birthday' });

  if (!result.failed || result.sent > 0) {
    setConfig_(CONFIG_KEYS.BIRTHDAY_LAST_SENT_DATE, todayKey);
  }

  return result;
}

function getTodaysBirthdayUsers_() {
  const sh = usersSheet_();
  const rows = sh.getDataRange().getValues();
  const h = getUsersHeaderMap_(sh);
  const tz = getTimeZone_();
  const today = Utilities.formatDate(new Date(), tz, 'MM-dd');
  const seen = {};
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[h.name] || '').trim();
    const dob = row[h.dob];
    if (!name || !dob) continue;

    const parts = extractBirthdayParts_(dob);
    if (!parts || parts.key !== today) continue;

    const identity = String(row[h.tg_id] || '') + '::' + String(row[h.account_id] || DEFAULT_ACCOUNT_ID) + '::' + name;
    if (seen[identity]) continue;
    seen[identity] = true;

    result.push({
      tg_id: String(row[h.tg_id] || ''),
      account_id: String(row[h.account_id] || DEFAULT_ACCOUNT_ID),
      name: name,
      dob: parts.display
    });
  }

  return result;
}

function buildBirthdayMessage_(birthdayUsers, broadcastMode) {
  if (!birthdayUsers.length) return 'Сегодня в таблице нет дней рождения.';

  const lines = birthdayUsers.map(function (u) {
    return '• <b>' + escapeHtml_(u.name) + '</b>' + (u.dob ? ' — ' + escapeHtml_(u.dob) : '');
  });

  return [
    '🎉 <b>Сегодня день рождения!</b>',
    '',
    lines.join('\n'),
    '',
    broadcastMode ? 'Поздравим и подарим тёплые слова ✨' : 'Это список на сегодня.'
  ].join('\n');
}

function extractBirthdayParts_(value) {
  const tz = getTimeZone_();

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return {
      key: Utilities.formatDate(value, tz, 'MM-dd'),
      display: Utilities.formatDate(value, tz, 'dd.MM.yyyy')
    };
  }

  const s = String(value || '').trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { key: m[2] + '-' + m[3], display: m[3] + '.' + m[2] + '.' + m[1] };

  m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  if (m) return { key: m[2] + '-' + m[1], display: m[1] + '.' + m[2] + '.' + m[3] };

  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) {
    const dd = ('0' + m[1]).slice(-2);
    const mm = ('0' + m[2]).slice(-2);
    return { key: mm + '-' + dd, display: dd + '.' + mm + '.' + m[3] };
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return {
      key: Utilities.formatDate(d, tz, 'MM-dd'),
      display: Utilities.formatDate(d, tz, 'dd.MM.yyyy')
    };
  }

  return null;
}

/****************************************
 * TELEGRAM API
 ****************************************/
function telegramApi_(method, payload) {
  const token = getBotToken_();
  const url = 'https://api.telegram.org/bot' + token + '/' + method;

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });

  const text = res.getContentText() || '{}';
  let data;
  try { data = JSON.parse(text); } catch (err) { data = { ok: false, description: text }; }

  if (!data.ok) {
    throw new Error('Telegram API ' + method + ': ' + (data.description || text));
  }

  return data.result;
}

function sendTelegramMessage_(chatId, text, extra) {
  const payload = Object.assign({
    chat_id: String(chatId),
    text: String(text || ''),
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }, extra || {});

  return telegramApi_('sendMessage', payload);
}

function answerCallbackQuery_(callbackQueryId) {
  if (!callbackQueryId) return;
  try { telegramApi_('answerCallbackQuery', { callback_query_id: callbackQueryId }); } catch (err) {}
}

function sendBroadcast_(text, meta) {
  const recipients = getBroadcastRecipients_(meta && meta.kind);
  let sent = 0;
  let failed = 0;

  recipients.forEach(function (chatId) {
    try {
      sendTelegramMessage_(chatId, text);
      sent += 1;
    } catch (err) {
      failed += 1;
      markBotDeliveryError_(chatId, String(err && err.message ? err.message : err));
    }
  });

  return { sent: sent, failed: failed, total: recipients.length };
}

function getBroadcastRecipients_(kind) {
  const sh = usersSheet_();
  const rows = sh.getDataRange().getValues();
  const h = getUsersHeaderMap_(sh);
  const seen = {};
  const result = [];

  function add(chatId) {
    const id = String(chatId || '').trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    result.push(id);
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tgId = String(row[h.tg_id] || '').trim();
    const chatId = h.bot_chat_id === undefined ? '' : String(row[h.bot_chat_id] || '').trim();
    const notifications = h.bot_notifications === undefined ? 'true' : String(row[h.bot_notifications] || 'true');

    if (notifications.toLowerCase() === 'false') continue;
    add(chatId || tgId);
  }

  getAdminIds_().forEach(add);
  return result;
}

function getBotToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!token) throw new Error('Не задан BOT_TOKEN в Script Properties');
  return token;
}

function getDisplayNameFromTelegramUser_(u) {
  if (!u) return '';
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id || '');
}

function escapeHtml_(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c];
  });
}

/****************************************
 * TELEGRAM UPDATE DEDUPE
 ****************************************/
function isTelegramUpdate_(body) {
  return !!(
    body &&
    body.update_id !== undefined &&
    (body.message || body.edited_message || body.callback_query)
  );
}

function markTelegramUpdateOnce_(updateId) {
  if (updateId === undefined || updateId === null || updateId === '') return true;

  const key = 'tg_update_' + String(updateId);
  const lock = LockService.getScriptLock();

  try {
    lock.tryLock(1000);

    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;

    cache.put(key, '1', 21600); // 6 часов
    return true;
  } catch (err) {
    Logger.log('markTelegramUpdateOnce_ error: ' + String(err));
    return true;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/****************************************
 * TELEGRAM WEBHOOK SETUP HELPERS
 ****************************************/
function setTelegramWebhook() {
  const scriptUrl = PropertiesService
    .getScriptProperties()
    .getProperty('SCRIPT_WEBAPP_URL');

  if (!scriptUrl) {
    throw new Error('Не задан SCRIPT_WEBAPP_URL в Script Properties');
  }

  if (!/^https:\/\/.+/i.test(scriptUrl)) {
    throw new Error('SCRIPT_WEBAPP_URL должен быть HTTPS-ссылкой. Сейчас указано: ' + scriptUrl);
  }

  const result = telegramApi_('setWebhook', {
    url: scriptUrl,
    drop_pending_updates: true
  });

  Logger.log(JSON.stringify(result));
  return result;
}

function deleteTelegramWebhook() {
  const result = telegramApi_('deleteWebhook', {
    drop_pending_updates: true
  });

  Logger.log(JSON.stringify(result));
  return result;
}

function getTelegramWebhookInfo() {
  const token = PropertiesService
    .getScriptProperties()
    .getProperty('BOT_TOKEN');

  if (!token) {
    throw new Error('Не задан BOT_TOKEN');
  }

  const url = 'https://api.telegram.org/bot' + token + '/getWebhookInfo';
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  const text = res.getContentText();
  Logger.log(text);
  return text;
}

function installBirthdayTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'checkBirthdaysDaily') {
      ScriptApp.deleteTrigger(t);
    }
  });

  const hour = Math.max(0, Math.min(23, Number(getConfig_(CONFIG_KEYS.BIRTHDAY_NOTIFY_HOUR, '9')) || 9));
  ScriptApp.newTrigger('checkBirthdaysDaily')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .create();

  return 'Birthday trigger installed at hour: ' + hour;
}

/****************************************
 * TELEGRAM ПРОВЕРКА WEBAPP INITDATA
 ****************************************/
function verifyTelegramInitData_(initData) {
  if (!initData) throw new Error('Пустой initData');

  const params = {};
  initData.split('&').forEach(function (p) {
    const idx = p.indexOf('=');
    if (idx === -1) return;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    const key = decodeURIComponent(k.replace(/\+/g, ' '));
    const val = decodeURIComponent(v.replace(/\+/g, ' '));
    params[key] = val;
  });

  const hash = params.hash;
  if (!hash) throw new Error('Нет hash в initData');
  if (!params.user) throw new Error('Нет user в initData');
  delete params.hash;

  const dataCheckString = Object.keys(params)
    .sort()
    .map(function (k) { return k + '=' + params[k]; })
    .join('\n');

  const botToken = getBotToken_();

  const tokenBytes = Utilities.newBlob(botToken).getBytes();
  const webAppDataBytes = Utilities.newBlob('WebAppData').getBytes();
  const secretKeyBytes = Utilities.computeHmacSha256Signature(tokenBytes, webAppDataBytes);

  const dataBytes = Utilities.newBlob(dataCheckString).getBytes();
  const computedBytes = Utilities.computeHmacSha256Signature(dataBytes, secretKeyBytes);
  const computedHash = bytesToHex_(computedBytes);

  if (computedHash !== hash) {
    throw new Error('Ошибка проверки Telegram: хэши не совпадают');
  }

  return JSON.parse(params.user);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    return ('0' + ((b & 0xff).toString(16))).slice(-2);
  }).join('');
}

/****************************************
 * ПРОВЕРКА АДМИНА
 ****************************************/
function getAdminIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_IDS') || '';
  return raw.split(',').map(function (s) { return String(s).trim(); }).filter(Boolean);
}

function isAdmin_(tgId) {
  return getAdminIds_().includes(String(tgId));
}

/****************************************
 * ТАБЛИЦЫ И МИГРАЦИЯ
 ****************************************/
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActive();
}

function usersSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_USERS);

  if (!sh) {
    sh = ss.insertSheet(SHEET_USERS);
    sh.appendRow([
      'tg_id', 'account_id', 'name', 'dob', 'bible', 'truth', 'behavior',
      'created_at', 'updated_at', 'bot_chat_id', 'bot_notifications',
      'last_bot_seen', 'bot_last_error'
    ]);
    return sh;
  }

  ensureUsersSchema_(sh);
  return sh;
}

function configSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CONFIG);
    sh.appendRow(['key', 'value']);
  }

  ensureConfigSchema_(sh);
  return sh;
}

function ensureConfigSchema_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 2);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (headers[0] !== 'key') sh.getRange(1, 1).setValue('key');
  if (headers[1] !== 'value') sh.getRange(1, 2).setValue('value');

  Object.keys(DEFAULT_CONFIG).forEach(function (key) {
    ensureConfigKey_(sh, key, DEFAULT_CONFIG[key]);
  });
}

function ensureConfigKey_(sh, key, defaultValue) {
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) return;
  }
  sh.appendRow([key, defaultValue]);
}

function ensureUsersSchema_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

  if (headers[0] !== 'tg_id') {
    throw new Error('В листе Users первый столбец должен быть tg_id');
  }

  if (headers.indexOf('account_id') === -1) {
    sh.insertColumnAfter(1);
    sh.getRange(1, 2).setValue('account_id');

    const lastRow = sh.getLastRow();
    if (lastRow > 1) {
      sh.getRange(2, 2, lastRow - 1, 1).setValue(DEFAULT_ACCOUNT_ID);
    }
  }

  const required = [
    'name', 'dob', 'bible', 'truth', 'behavior', 'created_at', 'updated_at',
    'bot_chat_id', 'bot_notifications', 'last_bot_seen', 'bot_last_error'
  ];

  const freshHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  required.forEach(function (key) {
    if (freshHeaders.indexOf(key) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(key);
    }
  });
}

function getUsersHeaderMap_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const map = {};
  headers.forEach(function (name, idx) {
    map[name] = idx;
  });
  return map;
}

/****************************************
 * CONFIG
 ****************************************/
function getConfig_(key, fallback) {
  const sh = configSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(key)) return rows[i][1] === '' ? fallback : String(rows[i][1]);
  }
  return fallback;
}

function setConfig_(key, value) {
  const sh = configSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(key)) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function getConfigBool_(key, fallback) {
  const v = String(getConfig_(key, fallback ? 'true' : 'false')).toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

function getTimeZone_() {
  return Session.getScriptTimeZone() || 'Europe/Moscow';
}

/****************************************
 * ПОЛЬЗОВАТЕЛИ
 ****************************************/
function normalizeAccountId_(accountId) {
  const value = String(accountId || '').trim();
  return value || DEFAULT_ACCOUNT_ID;
}

function findUserRowByIdentity_(sh, tgId, accountId) {
  const rows = sh.getDataRange().getValues();
  const h = getUsersHeaderMap_(sh);

  for (let i = 1; i < rows.length; i++) {
    if (
      String(rows[i][h.tg_id]) === String(tgId) &&
      String(rows[i][h.account_id] || DEFAULT_ACCOUNT_ID) === String(accountId)
    ) {
      return i + 1;
    }
  }
  return -1;
}

function findRowsByTgId_(sh, tgId) {
  const rows = sh.getDataRange().getValues();
  const h = getUsersHeaderMap_(sh);
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][h.tg_id]) === String(tgId)) {
      result.push(i + 1);
    }
  }
  return result;
}

function rowToUser_(row, h) {
  return {
    tg_id: String(row[h.tg_id] || ''),
    account_id: String(row[h.account_id] || DEFAULT_ACCOUNT_ID),
    name: row[h.name] || '',
    dob: row[h.dob] || '',
    bible: Number(row[h.bible] || 0),
    truth: Number(row[h.truth] || 0),
    behavior: Number(row[h.behavior] || 0),
    bot_chat_id: h.bot_chat_id === undefined ? '' : String(row[h.bot_chat_id] || ''),
    bot_notifications: h.bot_notifications === undefined ? true : String(row[h.bot_notifications] || 'true').toLowerCase() !== 'false'
  };
}

function upsertUser_(tgId, accountId, name, dob) {
  const sh = usersSheet_();
  const h = getUsersHeaderMap_(sh);
  const rowIndex = findUserRowByIdentity_(sh, tgId, accountId);
  const now = new Date();

  if (rowIndex !== -1) {
    sh.getRange(rowIndex, h.name + 1).setValue(name);
    sh.getRange(rowIndex, h.dob + 1).setValue(dob);
    sh.getRange(rowIndex, h.updated_at + 1).setValue(now);
    return;
  }

  const row = new Array(sh.getLastColumn()).fill('');
  row[h.tg_id] = String(tgId);
  row[h.account_id] = String(accountId);
  row[h.name] = name;
  row[h.dob] = dob;
  row[h.bible] = 0;
  row[h.truth] = 0;
  row[h.behavior] = 0;
  row[h.created_at] = now;
  row[h.updated_at] = now;
  if (h.bot_notifications !== undefined) row[h.bot_notifications] = true;
  sh.appendRow(row);
}

function getUser_(tgId, accountId) {
  const sh = usersSheet_();
  const h = getUsersHeaderMap_(sh);

  const safeTgId = String(tgId || '').trim();
  const safeAccountId = normalizeAccountId_(accountId);

  // 1. Сначала ищем точное совпадение tg_id + account_id.
  let rowIndex = findUserRowByIdentity_(sh, safeTgId, safeAccountId);

  if (rowIndex !== -1) {
    const row = sh.getRange(rowIndex, 1, 1, sh.getLastColumn()).getValues()[0];
    return rowToUser_(row, h);
  }

  // 2. Совместимость со старыми пользователями:
  // если профиля с новым account_id нет, ищем старую запись только по tg_id.
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][h.tg_id]) === safeTgId) {
      const legacyRowIndex = i + 1;

      if (!rows[i][h.account_id]) {
        sh.getRange(legacyRowIndex, h.account_id + 1).setValue(DEFAULT_ACCOUNT_ID);
        rows[i][h.account_id] = DEFAULT_ACCOUNT_ID;
      }

      const user = rowToUser_(rows[i], h);
      user.account_id = String(user.account_id || DEFAULT_ACCOUNT_ID);
      return user;
    }
  }

  // 3. Пользователя действительно нет.
  return {
    tg_id: safeTgId,
    account_id: safeAccountId || DEFAULT_ACCOUNT_ID,
    name: '',
    dob: '',
    bible: 0,
    truth: 0,
    behavior: 0,
    bot_chat_id: '',
    bot_notifications: true
  };
}

function listUsers_() {
  const sh = usersSheet_();
  const rows = sh.getDataRange().getValues();
  const h = getUsersHeaderMap_(sh);
  if (rows.length <= 1) return [];

  return rows.slice(1).map(function (row) {
    return rowToUser_(row, h);
  });
}

function setStars_(tgId, accountId, bible, truth, behavior) {
  const sh = usersSheet_();
  const h = getUsersHeaderMap_(sh);
  const safeTgId = String(tgId || '').trim();
  const normalizedAccountId = String(accountId || '').trim();

  if (!safeTgId) throw new Error('Не передан tg_id');

  let rowIndex = -1;

  if (normalizedAccountId) {
    rowIndex = findUserRowByIdentity_(sh, safeTgId, normalizedAccountId);
  } else {
    const matches = findRowsByTgId_(sh, safeTgId);
    if (matches.length === 1) {
      rowIndex = matches[0];
    } else if (matches.length > 1) {
      throw new Error('Для этого Telegram ID найдено несколько профилей. Нужно передавать account_id из фронтенда.');
    }
  }

  if (rowIndex === -1) throw new Error('Пользователь не найден');

  sh.getRange(rowIndex, h.bible + 1).setValue(Number(bible || 0));
  sh.getRange(rowIndex, h.truth + 1).setValue(Number(truth || 0));
  sh.getRange(rowIndex, h.behavior + 1).setValue(Number(behavior || 0));
  sh.getRange(rowIndex, h.updated_at + 1).setValue(new Date());
}

function rememberBotChat_(from, chat) {
  if (!from || !from.id || !chat || !chat.id) return;
  const tgId = String(from.id);
  const chatId = String(chat.id);
  const sh = usersSheet_();
  const h = getUsersHeaderMap_(sh);
  const rows = findRowsByTgId_(sh, tgId);
  const now = new Date();

  if (!rows.length) {
    const row = new Array(sh.getLastColumn()).fill('');
    row[h.tg_id] = tgId;
    row[h.account_id] = DEFAULT_ACCOUNT_ID;
    row[h.name] = getDisplayNameFromTelegramUser_(from);
    row[h.dob] = '';
    row[h.bible] = 0;
    row[h.truth] = 0;
    row[h.behavior] = 0;
    row[h.created_at] = now;
    row[h.updated_at] = now;
    row[h.bot_chat_id] = chatId;
    row[h.bot_notifications] = true;
    row[h.last_bot_seen] = now;
    sh.appendRow(row);
    return;
  }

  rows.forEach(function (rowIndex) {
    sh.getRange(rowIndex, h.bot_chat_id + 1).setValue(chatId);
    const notifyCell = sh.getRange(rowIndex, h.bot_notifications + 1);
    if (String(notifyCell.getValue()).trim() === '') notifyCell.setValue(true);
    sh.getRange(rowIndex, h.last_bot_seen + 1).setValue(now);
    sh.getRange(rowIndex, h.bot_last_error + 1).setValue('');
  });
}

function setBotNotifications_(tgId, enabled) {
  const sh = usersSheet_();
  const h = getUsersHeaderMap_(sh);
  const rows = findRowsByTgId_(sh, tgId);
  const now = new Date();

  if (!rows.length) return;

  rows.forEach(function (rowIndex) {
    sh.getRange(rowIndex, h.bot_notifications + 1).setValue(!!enabled);
    sh.getRange(rowIndex, h.updated_at + 1).setValue(now);
  });
}

function markBotDeliveryError_(chatId, error) {
  try {
    const sh = usersSheet_();
    const rows = sh.getDataRange().getValues();
    const h = getUsersHeaderMap_(sh);

    for (let i = 1; i < rows.length; i++) {
      const rowChatId = String(rows[i][h.bot_chat_id] || rows[i][h.tg_id] || '').trim();
      if (rowChatId === String(chatId)) {
        sh.getRange(i + 1, h.bot_last_error + 1).setValue(error);
      }
    }
  } catch (err) {}
}

/****************************************
 * ДОМАШНЕЕ ЗАДАНИЕ
 ****************************************/
function getHomework_() {
  return String(getConfig_(CONFIG_KEYS.HOMEWORK_TEXT, '') || '');
}

function setHomework_(text, updatedBy) {
  setConfig_(CONFIG_KEYS.HOMEWORK_TEXT, String(text || ''));
  setConfig_(CONFIG_KEYS.HOMEWORK_UPDATED_AT, new Date());
  if (updatedBy) setConfig_(CONFIG_KEYS.HOMEWORK_UPDATED_BY, String(updatedBy));
}

/****************************************
 * JSON RESPONSE
 ****************************************/
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
