// 12 блоков вопросов: отправка, строка «Принятый ответ», статусы ошибок.

import { QUESTIONS } from './config.js';
import { submitAnswer, getMyAnswers } from './supabase.js';
import { team } from './team.js';

const REASONS = {
  closed: 'Раунд закрыт',
  empty: 'Пустой ответ',
  bad_question: 'Ошибка номера вопроса',
  unknown_team: 'Команда не найдена',
};

const rows = new Map(); // number -> { input, button, accepted, status, retry }
let formEnabled = false;
let list = null; // .questions — на нём висит класс закрытого приёма

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
      <div class="q-accepted" hidden><span class="q-accepted-label">Принятый ответ:</span> <span class="q-accepted-text"></span></div>
      <div class="q-status" hidden><span class="q-status-text"></span><button type="button" class="q-retry" hidden>повторить</button></div>
    `;
    container.appendChild(row);

    const els = {
      root: row,
      input: row.querySelector('.q-input'),
      button: row.querySelector('.q-send'),
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
  }
}

// Переход на следующий раунд: чистим и инпуты, и «Принятый ответ».
export function clearAll() {
  for (const els of rows.values()) {
    els.input.value = '';
    setAccepted(els, null);
    setStatus(els, null);
  }
}

// Восстановление после перезагрузки вкладки: строки «Принятый ответ»
// заполняются тем, что реально лежит в базе.
export async function restoreAccepted() {
  if (!team.id) return;
  let res;
  try {
    res = await getMyAnswers(team.id);
  } catch {
    return; // нет связи — просто не восстановили, ничего не ломаем
  }
  if (!res || res.ok !== true) return;

  for (let n = 1; n <= QUESTIONS; n++) {
    const text = res.answers?.[String(n)];
    if (text) setAccepted(rows.get(n), text);
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
        retry: res?.reason !== 'closed',
      });
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
