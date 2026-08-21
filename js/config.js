// Публичные значения проекта Supabase: URL и anon-ключ.
// Их можно спокойно коммитить — anon-ключ ровно для того и существует.
// Права anon-роли ограничены схемой (см. supabase/schema.sql):
// SELECT на status и teams + EXECUTE на четыре RPC-функции.

export const SUPABASE_URL = 'https://pwggweedkrzktedpaqzy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_oshDWlCPyTAR0EQJxzJq7Q_B7os3Huh';

// Количество вопросов в раунде. Меняется вместе со схемой базы
// (колонки answer_1 … answer_12), поэтому не «настройка», а константа.
export const QUESTIONS = 12;

// Разумный лимит длины названия — чтобы не разъезжалась таблица на стриме.
export const TEAM_NAME_MAX = 40;
