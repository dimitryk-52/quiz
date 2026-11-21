// 12 блоков вопросов: отправка, ставка, строка «Принятый ответ»,
// статусы ошибок.

import { QUESTIONS } from './config.js';
import { submitAnswer, getMyAnswers, setBet } from './supabase.js';
import { team } from './team.js';

const REASONS = {
  closed: 'Раунд закрыт',
  empty: 'Пустой ответ',
  bad_question: 'Ошибка номера вопроса',
  unknown_team: 'Команда не найдена',
  other_game: 'Началась другая игра — выберите команду заново',
  not_bet_round: 'В этом раунде ставок нет',
};

const rows = new Map(); // number -> элементы строки вопроса
let formEnabled = false;
let betMode = false; // идёт ли раунд со ставкой
let list = null; // .questions — на нём висит класс закрытого приёма

// Сообщить наверх, что база больше не считает нашу команду своей.
// Ставится из app.js: answers.js про экран выбора команды не знает.
let onTeamRejected = () => {};
export function onTeamGone(fn) {
  onTeamRejected = fn ?? (() => {});
}

export function buildQuestions(container) {
  list = container;
  container.innerHTML = '';

  for (let n = 1; n <= QUESTIONS; n++) {
    const row = document.createElement('div');
    row.className = 'q';
    row.innerHTML = `
      <div class="q-line">
        <span class="q-num">${n}.</span>
        <input class="q-input" type="text" inputmode="text"
               autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" placeholder="Ответ" disabled>
        <button class="q-send" type="button" aria-label="Отправить ответ ${n}" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>
        </button>
      </div>
      <label class="q-bet" hidden>
        <input type="checkbox" class="q-bet-box" disabled>
        <span class="q-bet-text">Ставка <b>+1</b></span>
      </label>
      <div class="q-accepted" hidden><span class="q-accepted-label">Принятый ответ:</span> <span class="q-accepted-text"></span></div>
      <div class="q-status" hidden><span class="q-status-text"></span><button type="button" class="q-retry" hidden>повторить</button></div>
    `;
    container.appendChild(row);

    const els = {
      root: row,
      input: row.querySelector('.q-input'),
      button: row.querySelector('.q-send'),
      bet: row.querySelector('.q-bet'),
      betBox: row.querySelector('.q-bet-box'),
      accepted: row.querySelector('.q-accepted'),
      acceptedText: row.querySelector('.q-accepted-text'),
      status: row.querySelector('.q-status'),
      statusText: row.querySelector('.q-status-text'),
      retry: row.querySelector('.q-retry'),
    };
    rows.set(n, els);

    els.button.addEventListener('click', () => send(n));
    // На телефоне Enter — основной способ отправки, кнопка вторична.
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send(n);
      }
    });
    els.retry.addEventListener('click', () => send(n));
    els.betBox.addEventListener('change', () => sendBet(n));
  }
}

// Подсказки раунда — в плейсхолдеры полей: «гр. или исп-ль» вместо
// «Ответ». map — { "вопрос": "подсказка" } или null; вопрос без подсказки
// остаётся с «Ответ». Приглушены они стилем плейсхолдера (style.css).
export function setHints(map) {
  for (const [n, els] of rows) {
    const hint = String(map?.[String(n)] ?? '').trim();
    const text = hint || 'Ответ';
    if (els.input.placeholder !== text) els.input.placeholder = text;
  }
}

// Раунд открыт → поля активны; закрыт → всё disabled.
// Класс is-locked гасит поля целиком: disabled-атрибут сам по себе
// на телефоне читается плохо, и капитан не понимает, почему не печатается.
export function setEnabled(on) {
  formEnabled = on;
  list?.classList.toggle('is-locked', !on);
  for (const els of rows.values()) {
    els.input.disabled = !on;
    els.button.disabled = !on;
    els.betBox.disabled = !on || !betMode;
  }
}

// Ставочный раунд: у каждого вопроса появляется своя галочка.
// Ограничения по числу ставок нет — команда вправе поставить хоть на все.
export function setBetMode(on) {
  betMode = on === true;
  list?.classList.toggle('is-bet', betMode);
  for (const els of rows.values()) {
    els.bet.hidden = !betMode;
    els.betBox.disabled = !formEnabled || !betMode;
    if (!betMode) {
      els.betBox.checked = false;
      els.root.classList.remove('has-bet');
    } else {
      // Галочку мог восстановить restoreAccepted ещё до того, как стало
      // известно, что раунд ставочный, — подсветку синхронизируем здесь.
      els.root.classList.toggle('has-bet', els.betBox.checked);
    }
  }
}

// Переход на следующий раунд: чистим инпуты, ставки и «Принятый ответ».
export function clearAll() {
  for (const els of rows.values()) {
    els.input.value = '';
    els.betBox.checked = false;
    els.root.classList.remove('has-bet');
    setAccepted(els, null);
    setStatus(els, null);
  }
}

// Восстановление после перезагрузки вкладки: строки «Принятый ответ»
// и галочки ставок заполняются тем, что реально лежит в базе.
export async function restoreAccepted() {
  if (!team.id) return;
  let res;
  try {
    res = await getMyAnswers(team.id);
  } catch {
    return; // нет связи — просто не восстановили, ничего не ломаем
  }
  if (!res) return;

  // Команда из прошлой игры или удалённая: страница должна отправить
  // капитана выбирать заново, а не показывать пустые поля.
  if (res.ok !== true) {
    if (res.reason === 'other_game' || res.reason === 'unknown_team') onTeamRejected(res.reason);
    return;
  }

  for (let n = 1; n <= QUESTIONS; n++) {
    const els = rows.get(n);
    const text = res.answers?.[String(n)];
    if (text) setAccepted(els, text);

    const bet = res.bets?.[String(n)] === true;
    els.betBox.checked = bet;
    els.root.classList.toggle('has-bet', bet && betMode);
  }
}

async function send(n) {
  const els = rows.get(n);
  if (!els || els.input.disabled) return;

  const value = els.input.value.trim();

  if (!value) {
    setStatus(els, { text: 'Пустой ответ', kind: 'error', retry: false });
    return;
  }
  if (!team.id) {
    setStatus(els, { text: 'Сначала выберите команду', kind: 'error', retry: false });
    return;
  }

  els.button.classList.add('is-loading');
  els.button.disabled = true;
  setStatus(els, { text: 'Отправляем…', kind: 'pending', retry: false });

  try {
    const res = await submitAnswer(team.id, n, value);

    // Критично: отказ вида { ok:false, reason:'closed' } приходит УСПЕШНЫМ
    // HTTP-ответом, error будет null. Проверяем именно data.ok.
    if (!res || res.ok !== true) {
      setStatus(els, {
        text: REASONS[res?.reason] ?? 'Не отправилось',
        kind: 'error',
        retry: res?.reason !== 'closed' && res?.reason !== 'other_game',
      });
      if (res?.reason === 'other_game' || res?.reason === 'unknown_team') {
        onTeamRejected(res.reason);
      }
      return;
    }

    setAccepted(els, res.answer);
    setStatus(els, { text: 'Принято', kind: 'ok', retry: false });
  } catch {
    setStatus(els, { text: 'Нет связи', kind: 'error', retry: true });
  } finally {
    els.button.classList.remove('is-loading');
    els.button.disabled = !formEnabled;
  }
}

// Ставка уходит сразу по клику: отдельной кнопки «сохранить ставку» нет,
// и галочка обязана означать то, что реально записано в базе. Поэтому
// при отказе она возвращается в прежнее положение.
async function sendBet(n) {
  const els = rows.get(n);
  if (!els) return;

  const wanted = els.betBox.checked;

  if (!team.id) {
    els.betBox.checked = !wanted;
    setStatus(els, { text: 'Сначала выберите команду', kind: 'error', retry: false });
    return;
  }

  els.betBox.disabled = true;
  els.root.classList.toggle('has-bet', wanted);

  try {
    const res = await setBet(team.id, n, wanted);

    if (!res || res.ok !== true) {
      els.betBox.checked = !wanted;
      els.root.classList.toggle('has-bet', !wanted);
      setStatus(els, {
        text: REASONS[res?.reason] ?? 'Ставка не сохранилась',
        kind: 'error',
        retry: false,
      });
      if (res?.reason === 'other_game' || res?.reason === 'unknown_team') {
        onTeamRejected(res.reason);
      }
      return;
    }

    setStatus(els, {
      text: wanted ? 'Ставка принята' : 'Ставка снята',
      kind: 'ok',
      retry: false,
    });
  } catch {
    els.betBox.checked = !wanted;
    els.root.classList.toggle('has-bet', !wanted);
    setStatus(els, { text: 'Нет связи — ставка не сохранилась', kind: 'error', retry: false });
  } finally {
    els.betBox.disabled = !formEnabled || !betMode;
  }
}

function setAccepted(els, text) {
  if (!text) {
    els.accepted.hidden = true;
    els.acceptedText.textContent = '';
    return;
  }
  els.accepted.hidden = false;
  els.acceptedText.textContent = text;
}

function setStatus(els, state) {
  if (!state) {
    els.status.hidden = true;
    els.status.className = 'q-status';
    els.statusText.textContent = '';
    els.retry.hidden = true;
    return;
  }
  els.status.hidden = false;
  els.status.className = `q-status is-${state.kind}`;
  els.statusText.textContent = state.text;
  els.retry.hidden = !state.retry;

  if (state.kind === 'ok') {
    // «Принято» — короткая подсветка, дальше правду показывает
    // строка «Принятый ответ», которая остаётся на экране.
    setTimeout(() => {
      if (els.statusText.textContent === state.text) setStatus(els, null);
    }, 1500);
  }
}
