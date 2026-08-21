// Подписка на status + страховки: реконнект, возврат вкладки из фона,
// периодическая сверка. Клиент не должен залипнуть в устаревшем состоянии.

import { sb, fetchStatus } from './supabase.js';

// Fail-safe: до того как прочитан status, форма считается закрытой.
export const status = { round: null, open: false, known: false };

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
  // При возврате перечитываем status обычным SELECT, а не ждём события.
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
        if (row) apply(row.round_number, row.is_open);
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

export async function refreshStatus({ quiet = false } = {}) {
  try {
    const row = await fetchStatus();
    if (!row) {
      // строки status нет — приём не откроется, но и падать незачем
      apply(null, false);
      onLink('live');
      return;
    }
    apply(row.round_number, row.is_open);
    onLink('live');
  } catch {
    if (!quiet) onLink('offline');
  }
}

// Сравниваем ОБА поля: 1→2 меняет только is_open (блокировка без очистки),
// 2→3 меняет ещё и round_number (полная очистка).
function apply(round, open) {
  const prevRound = status.round;
  const prevOpen = status.open;
  const first = !status.known;

  status.round = round;
  status.open = open === true;
  status.known = true;

  if (first || prevRound !== status.round || prevOpen !== status.open) {
    onStatus({
      round: status.round,
      open: status.open,
      roundChanged: !first && prevRound !== status.round,
      first,
    });
  }
}

export function stopRealtime() {
  clearInterval(pollTimer);
  if (channel) sb.removeChannel(channel);
}
