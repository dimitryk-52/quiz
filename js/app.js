// Сборка публичной страницы.

import { initTeam, restoreTeam, team } from './team.js';
import { buildQuestions, setEnabled, clearAll, restoreAccepted } from './answers.js';
import { initRealtime, status } from './realtime.js';

const roundLabel = document.getElementById('round-label');
const stateNote = document.getElementById('state-note');
const link = document.getElementById('link-indicator');

buildQuestions(document.getElementById('questions'));

initTeam({
  onChange: async (t) => {
    // Сменилась команда — подтягиваем её принятые ответы текущего раунда.
    clearAll();
    if (t.id) await restoreAccepted();
    render();
  },
});

initRealtime({
  onStatus: ({ round, open, roundChanged, first }) => {
    // Новый раунд — чистим и инпуты, и строки «Принятый ответ».
    // Просто закрытие приёма ничего не чистит: команда должна
    // иметь возможность свериться с экраном результатов.
    if (roundChanged) clearAll();
    render();
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
  roundLabel.textContent = status.round ? `РАУНД ${status.round}` : 'РАУНД —';

  const ready = status.known && status.open && Boolean(team.id);
  setEnabled(ready);

  if (!status.known) {
    note('Ожидайте…');
  } else if (!team.id) {
    note('Выберите или создайте команду');
  } else if (!status.round) {
    note('Игра ещё не началась');
  } else if (!status.open) {
    note(`Приём ответов закрыт`);
  } else {
    note('');
  }
}

function note(text) {
  stateNote.textContent = text;
  stateNote.hidden = !text;
}
