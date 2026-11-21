// Сборка публичной страницы.

import { initTeam, restoreTeam, dropTeam, team } from './team.js';
import {
  buildQuestions, setEnabled, setBetMode, setHints, clearAll, restoreAccepted, onTeamGone,
} from './answers.js';
import { initRealtime, status } from './realtime.js';

const roundLabel = document.getElementById('round-label');
const roundNameEl = document.getElementById('round-name');
const stateNote = document.getElementById('state-note');
const link = document.getElementById('link-indicator');

// Оформление идущей игры; null — игра его не прислала. Объявлено здесь,
// а не рядом с applyDesign ниже: initTheme() на следующих строках уже
// перекрашивает страницу и читает эту переменную.
let design = null;

// Таблицы и константы оформления объявлены здесь, а не рядом со своими
// функциями ниже, и по той же причине, что и design выше: initTheme()
// на следующих строках перекрашивает страницу в первом же кадре, а
// const до своей строки не существует — не «пустой», а недоступный.
const SKIN_KEY = 'quiz.skin';
const SKIN_RE = /^[a-z][a-z0-9-]{0,19}$/;

const DESIGN_VERSION = 1;

// Что игра вправе перекрасить. Список закрытый: он же документирует,
// какие переменные оформление трогает, а какие остаются за страницей.
const DESIGN_VARS = [
  ['counter', '--g-counter'],
  ['timer', '--g-timer'],
  ['answer', '--g-answer'],
  ['bg', '--bg'],
  ['head', '--head'],
  ['plate', '--card'],
  ['well', '--card-2'],
  ['stroke', '--plate-stroke'],
  ['text', '--text'],
  ['muted', '--muted'],
  ['faint', '--faint'],
  ['line', '--line'],
];

const HEX = /^#[0-9a-f]{6}$/i;

initTheme();
buildQuestions(document.getElementById('questions'));

// База отказала команде (её удалили или она из прошлой игры) — уводим
// на экран выбора. Решение принимает team.js, знание приходит из answers.js.
onTeamGone((reason) => dropTeam(reason));

initTeam({
  onChange: async (t) => {
    // Сменилась команда — подтягиваем её принятые ответы текущего раунда.
    clearAll();
    if (t.id) await restoreAccepted();
    render();
  },
});

initRealtime({
  onStatus: async ({ roundChanged, gameChanged, first }) => {
    // Новый раунд — чистим и инпуты, и ставки, и строки «Принятый ответ».
    // Просто закрытие приёма ничего не чистит: команда должна
    // иметь возможность свериться с экраном результатов.
    if (roundChanged || gameChanged) clearAll();
    render();

    // Сменилась игра — сохранённая команда почти наверняка из прошлой.
    // restoreTeam сам сходит в базу, не найдёт её (политика на teams
    // показывает только команды идущей игры) и откроет экран выбора.
    if (gameChanged) {
      await restoreTeam();
      return;
    }

    // При первой загрузке и при смене раунда восстанавливаем ответы из базы
    if ((first || roundChanged) && team.id) restoreAccepted();
  },
  onLink: (state) => {
    link.dataset.state = state;
    link.textContent =
      state === 'live' ? 'на связи' : state === 'reconnecting' ? 'переподключаемся…' : 'нет связи';
  },
});

// Возврат вкладки из фона — перечитываем принятые ответы,
// чтобы капитан не увидел пустые поля и не начал переотправлять всё заново.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && team.id) restoreAccepted();
});

restoreTeam();
render();

function render() {
  // Оформление приходит вместе с конфигурацией игры. Пока status ещё
  // не прочитан, не трогаем: на экране уже стоит тема прошлой игры,
  // восстановленная из localStorage, и сбрасывать её на стандартную
  // ради полусекунды до ответа базы — это мигание на весь зал.
  if (status.known) applySkin(status.game?.theme);
  if (status.known) applyDesign(status.game?.design ?? null);

  roundLabel.textContent = status.round ? `РАУНД ${status.round}` : 'РАУНД —';
  roundLabel.classList.toggle('is-bet', status.isBetRound === true);

  // Название раунда под номером. Шапка не растёт: номер стал чуть
  // мельче, а тема встала на освободившееся место.
  const name = status.roundName ?? '';
  roundNameEl.textContent = name;
  roundNameEl.hidden = !name;
  roundNameEl.classList.toggle('is-bet', status.isBetRound === true);

  // Подсказки к полям — по идущему раунду; между раундами их нет.
  setHints(status.round ? (status.game?.hints?.[String(status.round)] ?? null) : null);

  const ready = status.known && status.open && Boolean(team.id);
  setEnabled(ready);
  // Галочки показываем в ставочном раунде всегда, даже при закрытом
  // приёме: команда должна видеть, на что она поставила.
  setBetMode(status.known && status.isBetRound === true && Boolean(team.id));

  if (!status.known) {
    note('Ожидайте…');
  } else if (status.gameId == null) {
    note('Игра ещё не началась');
  } else if (!team.id) {
    note('Выберите или создайте команду');
  } else if (!status.round) {
    note('Игра ещё не началась');
  } else if (!status.open) {
    note('Приём ответов закрыт', 'closed');
  } else if (status.isBetRound) {
    // Правило начисления должно быть на экране в момент, когда команда
    // жмёт галочку, — а не в памяти с объявления ведущего.
    note('Раунд со ставкой: верный ответ со ставкой +2, неверный −1', 'bet');
  } else {
    // Раньше при открытом приёме плашка просто пропадала, и «открыт»
    // приходилось выводить из того, что поля стали активны.
    note('Приём ответов открыт', 'open');
  }
}

function note(text, kind = '') {
  stateNote.textContent = text;
  stateNote.hidden = !text;
  if (kind) stateNote.dataset.kind = kind;
  else delete stateNote.dataset.kind;
}

// --- Оформление игры ----------------------------------------------
//
// Светлая/тёмная тема — выбор игрока. Оформление (skin) — свойство игры:
// лежит в games.theme, выбирается в хабе, приходит сюда вместе с
// конфигурацией. Это разные вещи, и живут они в разных атрибутах:
// data-theme и data-skin.
//
// Неизвестное имя не применяем вовсе: CSS для него нет, а писать
// в атрибут что попало из базы — лишний способ получить сюрприз
// в селекторах. Стандартное оформление — это отсутствие атрибута.

function applySkin(next) {
  const clean = SKIN_RE.test(next ?? '') ? next : 'standard';

  // Что стоит сейчас, спрашиваем у атрибута, а не у своей переменной:
  // его же выставил inline-скрипт в <head> до загрузки этого модуля,
  // и второй источник правды разошёлся бы с ним на первом же кадре.
  if (clean === (document.documentElement.dataset.skin ?? 'standard')) return;

  if (clean === 'standard') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = clean;

  // Запоминаем, чтобы при перезагрузке телефон открылся сразу в теме
  // идущей игры, а не мигнул стандартной. Восстанавливает — inline-скрипт
  // в <head>, до первой отрисовки.
  try {
    localStorage.setItem(SKIN_KEY, clean);
  } catch {
    /* приватный режим — тема доживёт до перезагрузки */
  }

  paintThemeColor();
}

// --- Оформление игры ----------------------------------------------
//
// Цвета приходят из games.design вместе с остальной конфигурацией
// идущей игры — посчитанные, обеих тем сразу. Здесь их только
// расставляют по переменным CSS: считать на телефоне нечего, а если
// бы считали, двадцать телефонов в зале делали бы это каждый сам.
//
// Порядок такой: тема выбирается игроком, оформление приходит из базы,
// и на экране должны оказаться цвета ВЫБРАННОЙ темы. Поэтому applyDesign
// зовётся и при смене конфигурации, и при переключении темы.
//
// Незнакомая версия формата не применяется вовсе. Телефон в зале
// не должен показать половину палитры от формата, которого он не знает.

function applyDesign(next) {
  design = next && Number(next.v) === DESIGN_VERSION ? next : null;
  paintDesign();
}

function paintDesign() {
  const root = document.documentElement;
  const side = design?.[currentTheme()];

  if (!side) {
    root.removeAttribute('data-design');
    for (const [, cssVar] of DESIGN_VARS) root.style.removeProperty(cssVar);
    root.style.removeProperty('--plate-stroke-w');
    root.style.removeProperty('--radius');
    paintThemeColor();
    return;
  }

  // Атрибут — переключатель для CSS: по нему включаются правила плашки
  // (обводка вместо рамки, цветной акцент вместо стандартного).
  root.dataset.design = 'game';

  for (const [key, cssVar] of DESIGN_VARS) {
    const v = side[key];
    // Цвет проверяем здесь, а не доверяем базе: в переменную CSS уходит
    // строка из сети, и мусор в ней тихо ломает не одно правило, а все,
    // где переменная участвует.
    if (HEX.test(v ?? '')) root.style.setProperty(cssVar, v);
  }

  const plate = design.plate ?? {};
  if (Number.isFinite(plate.strokeW)) root.style.setProperty('--plate-stroke-w', plate.strokeW + 'px');
  if (Number.isFinite(plate.radius)) root.style.setProperty('--radius', plate.radius + 'px');

  paintThemeColor();
}

// --- Тема ---------------------------------------------------------
// По умолчанию тёмная: играют в полутёмном зале. Выбор запоминается,
// переключатель — в шапке рядом с индикатором связи.

const THEME_KEY = 'quiz.theme';

function initTheme() {
  applyTheme(currentTheme());
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* приватный режим — тема доживёт до перезагрузки */
    }
    applyTheme(next);
  });
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  const btn = document.getElementById('theme-toggle');
  // Подпись — то, куда переключимся, а не то, что сейчас.
  btn.textContent = theme === 'light' ? '☾' : '☀';
  btn.title = theme === 'light' ? 'Тёмная тема' : 'Светлая тема';

  // Оформление игры держит цвета обеих тем: перекрашиваем под новую,
  // иначе на светлой остались бы тёмные цвета игры. paintDesign зовёт
  // paintThemeColor сам — второй раз он не нужен.
  paintDesign();
}

// Строка состояния браузера на телефоне. Цвет читаем из --bg: список
// литералов врал бы и при смене палитры, и при смене оформления игры
// (см. css/by.css). Зовут отсюда оба переключателя — и темы, и скина.
function paintThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.content = bg;
}
