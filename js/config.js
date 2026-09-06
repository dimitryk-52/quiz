// Публичные значения проекта Supabase: URL и anon-ключ.
// Их можно спокойно коммитить — anon-ключ ровно для того и существует.
// Права anon-роли ограничены схемой (см. supabase/schema.sql): SELECT
// на status, на ИДУЩУЮ игру и её команды + EXECUTE на публичные
// RPC-функции. Игры и команды других игр наружу не отдаются вовсе.

export const SUPABASE_URL = 'https://pwggweedkrzktedpaqzy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_oshDWlCPyTAR0EQJxzJq7Q_B7os3Huh';

// Количество вопросов в раунде. Меняется вместе со схемой базы
// (колонки answer_1 … answer_12 и bet_1 … bet_12), поэтому
// не «настройка», а константа.
//
// Число РАУНДОВ здесь не хранится: оно своё у каждой игры и приходит
// с сервера в get_current_game.
export const QUESTIONS = 12;

// Разумный лимит длины названия — чтобы не разъезжалась таблица на стриме.
export const TEAM_NAME_MAX = 40;
