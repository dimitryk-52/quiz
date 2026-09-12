// Подписка на status + страховки: реконнект, возврат вкладки из фона,
// периодическая сверка. Клиент не должен залипнуть в устаревшем состоянии.
//
// В status теперь лежит и game_id: игр в базе несколько, и смена игры —
// такое же событие, как смена раунда, только более разрушительное
// (команды у каждой игры свои).

import { sb, fetchStatus, fetchCurrentGame } from './supabase.js';

// Fail-safe: до того как прочитан status, форма считается закрытой.
export const status = {
  gameId: null,
  round: null,
  open: false,
  known: false,
  // конфигурация идущей игры; null, пока не прочитана
  game: null,        // { id, title, rounds, betRounds, roundNames, theme, design }
  isBetRound: false,
  roundName: '',     // название идущего раунда, '' — если его нет
};

let onStatus = () => {};
let onLink = () => {};
let channel = null;
let pollTimer = null;

export function initRealtime(handlers) {
  onStatus = handlers.onStatus ?? (() => {});
  onLink = handlers.onLink ?? (() => {});

  subscribe();
  refreshStatus();

  // Типичный сценарий на телефоне: вкладка ушла в фон, WebSocket отвалился.
  // При возврате перечитываем status обычным запросом, а не ждём события.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshStatus();
      ensureSubscribed();
    }
  });

  window.addEventListener('online', () => {
    refreshStatus();
    ensureSubscribed();
  });
  window.addEventListener('offline', () => onLink('offline'));

  // Тихая сверка раз в 20 секунд — дешёвая страховка от залипания
  // на случай, если и реконнект не отработал.
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshStatus({ quiet: true });
  }, 20000);
}

function subscribe() {
  channel = sb
    .channel('status-watch')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'status', filter: 'id=eq.1' },
      (payload) => {
        const row = payload.new;
        if (!row) return;

        // Игра сменилась — в событии её конфигурации нет, а без неё
        // неизвестно, ставочный ли раунд. Идём за ней отдельным запросом.
        if (row.game_id !== status.gameId || !status.game) {
          refreshStatus({ quiet: true });
          return;
        }

        apply(row.game_id, row.round_number, row.is_open);
      }
    )
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        onLink('live');
        // После реконнекта принудительно перечитываем status: пока связи
        // не было, раунд мог смениться, и события об этом уже не придёт.
        refreshStatus({ quiet: true });
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        onLink('reconnecting');
        setTimeout(ensureSubscribed, 2000);
      } else if (state === 'CLOSED') {
        onLink('offline');
      }
    });
}

function ensureSubscribed() {
  const state = channel?.state;
  if (state === 'joined' || state === 'joining') return;
  try {
    if (channel) sb.removeChannel(channel);
  } catch {
    /* канал уже мёртв — не важно */
  }
  subscribe();
}

// Полная сверка: и статус, и конфигурация игры, одним вызовом.
// Дешевле, чем кажется, и заведомо непротиворечиво — обе части
// читаются в одной транзакции на сервере.
export async function refreshStatus({ quiet = false } = {}) {
  try {
    const data = await fetchCurrentGame();

    if (!data || data.ok !== true || !data.game) {
      // игра не выбрана в хабе — приём не откроется, но и падать незачем
      status.game = null;
      apply(null, null, false);
      onLink('live');
      return;
    }

    status.game = {
      id: data.game.id,
      title: data.game.title,
      rounds: Number(data.game.rounds),
      betRounds: (data.game.bet_rounds ?? []).map(Number),
      // позиционный массив из базы: имя раунда N лежит на месте N
      roundNames: (data.game.round_names ?? []).map((v) => String(v ?? '')),
      // оформление страницы: у каждой игры своё, применяет app.js
      theme: String(data.game.theme ?? 'standard'),
      // Цвета игры: посчитаны в хабе и отправлены оттуда же, здесь их
      // только расставляют по переменным. null — обычное состояние:
      // игра без оформления идёт на палитре страницы.
      design: data.game.design ?? null,
    };
    apply(
      data.game.id,
      data.round,
      data.is_open,
      data.is_bet_round === true,
      data.round_name ?? ''
    );
    onLink('live');
  } catch {
    if (!quiet) onLink('offline');
    // Резервный путь: RPC не прошёл, но обычный SELECT может пройти —
    // тогда хотя бы раунд и открытость будут свежими.
    try {
      const row = await fetchStatus();
      if (row) {
        apply(row.game_id, row.round_number, row.is_open);
        onLink('live');
      }
    } catch {
      /* связи действительно нет */
    }
  }
}

// Сравниваем ВСЕ три поля: 1→2 меняет только is_open (блокировка без
// очистки), 2→3 меняет ещё и round_number (полная очистка), смена
// game_id — это ещё и чужая команда в localStorage.
function apply(gameId, round, open, isBetRound, roundName) {
  const prevGame = status.gameId;
  const prevRound = status.round;
  const prevOpen = status.open;
  const first = !status.known;

  status.gameId = gameId ?? null;
  status.round = round ?? null;
  status.open = open === true;
  status.known = true;

  // Из события Realtime флаг не приходит — считаем сами по кэшу игры.
  status.isBetRound =
    isBetRound ??
    (status.game?.betRounds ?? []).some((r) => r === Number(status.round));

  // Название раунда — так же: событие несёт только номер, имя берём
  // из уже прочитанной конфигурации игры.
  status.roundName =
    roundName ??
    (status.round ? (status.game?.roundNames?.[Number(status.round) - 1] ?? '') : '');

  const gameChanged = !first && prevGame !== status.gameId;

  if (first || gameChanged || prevRound !== status.round || prevOpen !== status.open) {
    onStatus({
      gameId: status.gameId,
      round: status.round,
      open: status.open,
      isBetRound: status.isBetRound,
      gameChanged,
      roundChanged: !first && prevRound !== status.round,
      first,
    });
  }
}

export function stopRealtime() {
  clearInterval(pollTimer);
  if (channel) sb.removeChannel(channel);
}
