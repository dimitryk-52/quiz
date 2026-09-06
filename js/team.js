// Блок команды: первый вход, обычное состояние, переименование, переключение.
// В localStorage хранится team_id; название — только кэш для мгновенной отрисовки.

import { listTeams, getTeam, registerTeam, renameTeam } from './supabase.js';
import { TEAM_NAME_MAX } from './config.js';

const LS_ID = 'quiz.team_id';
const LS_NAME = 'quiz.team_name';

const REASONS = {
  empty_name: 'Введите название команды',
  too_long: `Слишком длинное название (максимум ${TEAM_NAME_MAX} символов)`,
  name_taken: 'Такое название уже занято другой командой',
  unknown_team: 'Команда не найдена — выберите её из списка заново',
  no_game: 'Игра ещё не началась — ведущий пока не выбрал её',
};

export const team = {
  id: null,
  name: null,
};

let els = {};
let onChange = () => {};

export function initTeam(handlers) {
  onChange = handlers.onChange ?? (() => {});

  els = {
    view: document.getElementById('team-view'),
    viewName: document.getElementById('team-name'),
    editBtn: document.getElementById('team-edit'),

    edit: document.getElementById('team-edit-screen'),
    editTitle: document.getElementById('team-edit-title'),
    editCurrent: document.getElementById('team-edit-current'),
    input: document.getElementById('team-input'),
    submit: document.getElementById('team-submit'),
    cancel: document.getElementById('team-cancel'),
    error: document.getElementById('team-error'),
    list: document.getElementById('team-list'),
    listHint: document.getElementById('team-list-hint'),
  };

  els.input.maxLength = TEAM_NAME_MAX;

  els.editBtn.addEventListener('click', () => openEditor());
  els.cancel.addEventListener('click', () => closeEditor());
  els.submit.addEventListener('click', () => confirmName());
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmName();
    }
  });
}

// Загрузка при старте: восстанавливаем команду по сохранённому id.
export async function restoreTeam() {
  const saved = Number(localStorage.getItem(LS_ID));
  const cachedName = localStorage.getItem(LS_NAME);

  if (!saved) {
    await openEditor({ firstRun: true });
    return;
  }

  // мгновенно рисуем кэш, чтобы не мигать пустотой
  team.id = saved;
  team.name = cachedName ?? '…';
  renderView();

  let fresh = null;
  try {
    fresh = await getTeam(saved);
  } catch {
    // нет связи — остаёмся на кэше, id всё равно верный
    onChange(team);
    return;
  }

  if (!fresh) {
    // команду подчистили из хаба — не падаем, возвращаемся на первый вход
    forget();
    await openEditor({ firstRun: true });
    return;
  }

  // название могли поменять с другого устройства — берём из базы
  setTeam(fresh.id, fresh.name);
}

function setTeam(id, name) {
  team.id = id;
  team.name = name;
  localStorage.setItem(LS_ID, String(id));
  localStorage.setItem(LS_NAME, name);
  renderView();
  onChange(team);
}

function forget() {
  team.id = null;
  team.name = null;
  localStorage.removeItem(LS_ID);
  localStorage.removeItem(LS_NAME);
  onChange(team);
}

// Команды привязаны к игре, поэтому сохранённая в телефоне команда
// прошлой игры — обычное дело, а не сбой. База отвечает other_game
// или просто не отдаёт строку (политика на teams показывает только
// команды идущей игры), а страница отправляет капитана выбирать заново.
export async function dropTeam(reason) {
  forget();
  await openEditor({ firstRun: true });
  const el = document.getElementById('team-error');
  if (el) {
    el.textContent =
      reason === 'other_game'
        ? 'Началась другая игра — выберите или создайте команду заново'
        : 'Команда больше не найдена — выберите или создайте её заново';
  }
}

function renderView() {
  els.viewName.textContent = team.name ?? '';
  els.view.hidden = !team.id;
}

// --- Экран ввода/редактирования --------------------------------

export async function openEditor({ firstRun = false } = {}) {
  els.view.hidden = true;
  els.edit.hidden = false;
  els.error.textContent = '';

  els.editTitle.textContent = firstRun ? 'Название команды' : 'Изменить команду';
  els.cancel.hidden = firstRun; // при первом входе отменять некуда

  // Явно показываем, какая команда сейчас правится, — чтобы капитан
  // случайно не переименовал соперника, ткнув чужую строку в списке.
  if (team.id) {
    els.editCurrent.hidden = false;
    els.editCurrent.textContent = team.name ?? '';
    els.input.value = team.name ?? '';
  } else {
    els.editCurrent.hidden = true;
    els.input.value = '';
  }

  els.input.focus();
  await refreshList();
}

function closeEditor() {
  els.edit.hidden = true;
  renderView();
}

// Список подтягивается при каждом открытии — чтобы команда,
// зарегистрировавшаяся минуту назад, была видна.
async function refreshList() {
  els.list.innerHTML = '';
  els.listHint.textContent = 'Загружаем список команд…';

  let teams = [];
  try {
    teams = await listTeams();
  } catch {
    els.listHint.textContent = 'Не удалось загрузить список команд';
    return;
  }

  if (teams.length === 0) {
    els.listHint.textContent = 'Пока никто не зарегистрировался';
    return;
  }

  els.listHint.textContent = team.id
    ? 'или выберите другую команду:'
    : 'или выберите свою команду, если она уже есть:';

  for (const t of teams) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'team-chip';
    btn.textContent = t.name;
    if (t.id === team.id) btn.classList.add('is-current');
    // Клик по команде — просто переключение на её id, ничего не создаём
    // и ничего не переименовываем.
    btn.addEventListener('click', () => {
      setTeam(t.id, t.name);
      closeEditor();
    });
    els.list.appendChild(btn);
  }
}

async function confirmName() {
  const value = els.input.value.trim();
  els.error.textContent = '';

  if (!value) {
    els.error.textContent = REASONS.empty_name;
    return;
  }

  els.submit.disabled = true;
  els.submit.classList.add('is-loading');

  try {
    // Есть id → переименование (id сохраняется, ответы и оценки на месте).
    // Нет id → регистрация (дубль не создастся, вернётся существующий id).
    const res = team.id
      ? await renameTeam(team.id, value)
      : await registerTeam(value);

    if (!res || res.ok !== true) {
      els.error.textContent = REASONS[res?.reason] ?? 'Не получилось, попробуйте ещё раз';
      if (res?.reason === 'unknown_team') {
        forget();
        await openEditor({ firstRun: true });
      }
      return;
    }

    setTeam(res.id ?? team.id, res.name);
    closeEditor();
  } catch {
    els.error.textContent = 'Нет связи. Проверьте интернет и попробуйте ещё раз';
  } finally {
    els.submit.disabled = false;
    els.submit.classList.remove('is-loading');
  }
}
