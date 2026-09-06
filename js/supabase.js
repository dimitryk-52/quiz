// Единственное место, где создаётся клиент Supabase.
// Остальные модули импортируют готовые функции, а не дёргают клиент напрямую.

// Библиотека лежит рядом, в js/vendor/ — намеренно, а не с CDN.
// На игре двадцать телефонов открывают страницу одновременно через
// мобильный интернет; зависеть при этом от доступности чужого домена
// незачем. Версия зафиксирована: supabase-js 2.112.3.
import { createClient } from './vendor/supabase-js.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

// --- Команды ---------------------------------------------------

export async function listTeams() {
  const { data, error } = await sb
    .from('teams')
    .select('id, name')
    .order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getTeam(id) {
  const { data, error } = await sb
    .from('teams')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data; // null, если команду удалили из хаба
}

export async function registerTeam(name) {
  const { data, error } = await sb.rpc('register_team', { p_name: name });
  if (error) throw error;
  return data; // { ok, id, name } | { ok: false, reason }
}

export async function renameTeam(teamId, name) {
  const { data, error } = await sb.rpc('rename_team', {
    p_team_id: teamId,
    p_name: name,
  });
  if (error) throw error;
  return data; // { ok, id, name } | { ok: false, reason: 'name_taken' | ... }
}

// --- Ставки ----------------------------------------------------

// Раунд, игра и «а ставочный ли это раунд» проверяются на сервере:
// галочку в разметке подделать нечего делать.
export async function setBet(teamId, questionNumber, on) {
  const { data, error } = await sb.rpc('set_bet', {
    p_team_id: teamId,
    p_question_number: questionNumber,
    p_on: on,
  });
  if (error) throw error;
  return data; // { ok: true, round, question, bet } | { ok: false, reason }
}

// --- Ответы ----------------------------------------------------

export async function submitAnswer(teamId, questionNumber, text) {
  const { data, error } = await sb.rpc('submit_answer', {
    p_team_id: teamId,
    p_question_number: questionNumber,
    p_answer_text: text,
  });
  if (error) throw error;
  return data; // { ok: true, round, answer } | { ok: false, reason }
}

export async function getMyAnswers(teamId) {
  const { data, error } = await sb.rpc('get_my_answers', { p_team_id: teamId });
  if (error) throw error;
  // { ok: true, round, answers: { "1": "..." }, bets: { "1": true } }
  // | { ok: false, reason: 'other_game' | 'unknown_team' | 'no_status' }
  return data;
}

// --- Статус и игра ---------------------------------------------

// Одним вызовом: и статус, и конфигурация идущей игры. Двумя запросами
// между ними успевает вклиниться смена раунда, и страница показала бы
// раунд от одной игры со ставками от другой.
export async function fetchCurrentGame() {
  const { data, error } = await sb.rpc('get_current_game');
  if (error) throw error;
  // { ok, game: { id, title, rounds, bet_rounds } | null,
  //   round, is_open, is_bet_round }
  return data;
}

// Сырая строка status — для сверки после события Realtime, когда игра
// не менялась и перечитывать её конфигурацию незачем.
export async function fetchStatus() {
  const { data, error } = await sb
    .from('status')
    .select('game_id, round_number, is_open')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data; // null, если строку забыли создать
}
