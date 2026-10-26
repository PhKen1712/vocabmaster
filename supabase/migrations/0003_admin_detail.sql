-- ===========================================================================
-- VocabMaster — admin: chi tiết người dùng + quản lý từ điển (v3)
--
-- Cùng nguyên tắc như 0002: mọi hàm `security definer`, tự kiểm `is_admin()`
-- bên trong, revoke khỏi `anon`/`public`, chỉ cấp cho `authenticated`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Chi tiết một người dùng
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'user_id',       p.user_id,
    'username',      p.username,
    'role',          p.role,
    'status',        p.status,
    'created_at',    p.created_at,
    'settings',      p.settings,
    'words',         (select count(*) from public.user_words w
                       where w.user_id = p.user_id and w.deleted_at is null),
    'due',           (select count(*) from public.user_words w
                       where w.user_id = p.user_id and w.deleted_at is null
                         and w.due_at is not null and w.due_at <= now()),
    'learning',      (select count(*) from public.user_words w
                       where w.user_id = p.user_id and w.deleted_at is null
                         and w.learning_state = 'learning'),
    'mastered',      (select count(*) from public.user_words w
                       where w.user_id = p.user_id and w.deleted_at is null
                         and w.learning_state = 'mastered'),
    'untouched',     (select count(*) from public.user_words w
                       where w.user_id = p.user_id and w.deleted_at is null
                         and w.learning_state = 'new'),
    'reviews_total', (select count(*) from public.reviews r where r.user_id = p.user_id),
    'reviews_today', (select count(*) from public.reviews r
                       where r.user_id = p.user_id and r.created_at >= date_trunc('day', now())),
    'reviews_7d',    (select count(*) from public.reviews r
                       where r.user_id = p.user_id and r.created_at >= now() - interval '7 days'),
    'accuracy_7d',   (select case when count(*) = 0 then null
                          else round(100.0 * count(*) filter (where r.correct) / count(*))::int end
                       from public.reviews r
                       where r.user_id = p.user_id and r.created_at >= now() - interval '7 days'
                         and r.correct is not null),
    'coins',         (select coalesce(sum(c.amount), 0) from public.coin_ledger c where c.user_id = p.user_id),
    'streak',        (select d.streak from public.daily_activity d
                       where d.user_id = p.user_id order by d.day desc limit 1),
    'last_review_at',(select max(r.created_at) from public.reviews r where r.user_id = p.user_id),
    'forgotten',     (select count(*) from public.user_words w
                       where w.user_id = p.user_id and w.deleted_at is null
                         and (w.memory_rating = 'forgot'
                              or (w.wrong_count > 0 and w.wrong_count >= w.correct_count)))
  ) into result
  from public.profiles p
  where p.user_id = p_user_id;

  if result is null then
    raise exception 'không có tài khoản này' using errcode = '22023';
  end if;
  return result;
end;
$$;

/**
 * Từ của một người, lọc theo nhóm. Dùng cho tab "từ hay quên" và danh sách.
 * p_filter: all | due | forgotten | mastered
 */
create or replace function public.admin_user_words(
  p_user_id uuid,
  p_filter  text default 'all',
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  term_id      uuid,
  term         text,
  level        smallint,
  learning_state text,
  due_at       timestamptz,
  reps         integer,
  correct_count integer,
  wrong_count  integer,
  hint_count   integer,
  memory_rating text,
  last_wrong_at timestamptz,
  last_correct_at timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  mode text := coalesce(nullif(btrim(p_filter), ''), 'all');
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;

  return query
  select t.id,
         t.term,
         t.level,
         w.learning_state,
         w.due_at,
         w.reps,
         w.correct_count,
         w.wrong_count,
         w.hint_count,
         w.memory_rating,
         w.last_wrong_at,
         w.last_correct_at,
         count(*) over () as total_count
  from public.user_words w
  join public.terms t on t.id = w.term_id
  where w.user_id = p_user_id
    and w.deleted_at is null
    and case mode
          when 'due'       then w.due_at is not null and w.due_at <= now()
          when 'forgotten' then w.memory_rating = 'forgot'
                                or (w.wrong_count > 0 and w.wrong_count >= w.correct_count)
          when 'mastered'  then w.learning_state = 'mastered'
          else true
        end
  order by
    case when mode = 'due' then w.due_at end asc nulls last,
    w.wrong_count desc,
    w.reps desc,
    t.term asc
  limit greatest(least(coalesce(p_limit, 50), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

/** Hoạt động theo ngày để vẽ biểu đồ. */
create or replace function public.admin_user_activity(p_user_id uuid, p_days integer default 30)
returns table (day date, reviews integer, answered integer, correct integer, new_words integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;

  return query
  select d.day, d.reviews, d.answered, d.correct, d.new_words
  from public.daily_activity d
  where d.user_id = p_user_id
    and d.day >= current_date - greatest(least(coalesce(p_days, 30), 365), 1)
  order by d.day asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Từ điển dùng chung
-- ---------------------------------------------------------------------------

/**
 * Danh sách từ kèm số người đang học — để biết từ nào thực sự được dùng.
 * Sắp xếp theo số người học giảm dần: đó là những từ đáng sửa/sửa cẩn thận nhất.
 */
create or replace function public.admin_terms(
  p_search text default null,
  p_level  smallint default null,
  p_limit  integer default 25,
  p_offset integer default 0,
  p_sort   text default 'learners'
)
returns table (
  id            uuid,
  term          text,
  meaning_vi    text,
  definition_en text,
  ipa           text,
  part_of_speech text,
  example_en    text,
  example_vi    text,
  level         smallint,
  level_source  text,
  topic         text,
  learners      bigint,
  due_now       bigint,
  updated_at    timestamptz,
  total_count   bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := nullif(btrim(coalesce(p_search, '')), '');
  order_by text := coalesce(nullif(btrim(p_sort), ''), 'learners');
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;

  return query
  select t.id, t.term, t.meaning_vi, t.definition_en, t.ipa, t.part_of_speech,
         t.example_en, t.example_vi, t.level, t.level_source, tp.name,
         coalesce(stats.learners, 0), coalesce(stats.due_now, 0), t.updated_at,
         count(*) over () as total_count
  from public.terms t
  left join public.topics tp on tp.id = t.topic_id
  left join lateral (
    select count(*) as learners,
           count(*) filter (where w.due_at is not null and w.due_at <= now()) as due_now
    from public.user_words w
    where w.term_id = t.id and w.deleted_at is null
  ) stats on true
  where (q is null or t.normalized like '%' || public.normalize_term(q) || '%')
    and (p_level is null or t.level = p_level)
  order by
    case when order_by = 'newest' then t.created_at end desc nulls last,
    case when order_by = 'level' then t.level end desc nulls last,
    case when order_by = 'az' then t.term end asc nulls last,
    coalesce(stats.learners, 0) desc,
    t.term asc
  limit greatest(least(coalesce(p_limit, 25), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

/**
 * Gộp hai bản ghi từ trùng nhau: chuyển toàn bộ tiến trình sang bản giữ lại.
 *
 * Không xoá dữ liệu học: nếu một người đã có cả hai bản ghi, giữ bản của `keep`
 * và bỏ bản trùng (vì hai bản ghi cùng một từ là lỗi dữ liệu, không phải hai
 * lượt học khác nhau).
 */
create or replace function public.admin_merge_terms(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  moved_words integer := 0;
  merged_words integer := 0;
  moved_album integer := 0;
  moved_reviews integer := 0;
  keep_term text;
  drop_term text;
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;
  if p_keep = p_drop then
    raise exception 'phải chọn hai từ khác nhau' using errcode = '22023';
  end if;

  select term into keep_term from public.terms where id = p_keep;
  select term into drop_term from public.terms where id = p_drop;
  if keep_term is null or drop_term is null then
    raise exception 'không tìm thấy từ cần gộp' using errcode = '22023';
  end if;

  -- Khoá theo cặp từ đã sắp xếp, để hai lần gộp ngược chiều không chạy cùng lúc.
  perform pg_advisory_xact_lock(hashtext('terms:' || least(p_keep::text, p_drop::text)));

  -- user_words: chuyển những người chưa có bản ghi của `keep`.
  update public.user_words w
  set term_id = p_keep
  where w.term_id = p_drop
    and not exists (
      select 1 from public.user_words k
      where k.user_id = w.user_id and k.term_id = p_keep
    );
  get diagnostics moved_words = row_count;

  -- Những người đã có cả hai: bỏ bản trùng (giữ tiến trình của `keep`).
  delete from public.user_words where term_id = p_drop;
  get diagnostics merged_words = row_count;

  -- Album: thêm vào album của `keep`, bỏ bản trùng.
  update public.album_items ai
  set term_id = p_keep
  where ai.term_id = p_drop
    and not exists (
      select 1 from public.album_items k
      where k.album_id = ai.album_id and k.term_id = p_keep
    );
  get diagnostics moved_album = row_count;
  delete from public.album_items where term_id = p_drop;

  -- Lịch sử ôn và sổ xu: giữ nguyên lịch sử, chỉ trỏ sang từ còn lại.
  update public.reviews set term_id = p_keep where term_id = p_drop;
  get diagnostics moved_reviews = row_count;
  update public.coin_ledger set term_id = p_keep where term_id = p_drop;

  delete from public.terms where id = p_drop;

  return jsonb_build_object(
    'kept', keep_term,
    'removed', drop_term,
    'words_moved', moved_words,
    'duplicates_removed', merged_words,
    'album_rows', moved_album,
    'reviews', moved_reviews
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quyền
-- ---------------------------------------------------------------------------

revoke all on function public.admin_user_detail(uuid) from public, anon;
revoke all on function public.admin_user_words(uuid, text, integer, integer) from public, anon;
revoke all on function public.admin_user_activity(uuid, integer) from public, anon;
revoke all on function public.admin_terms(text, smallint, integer, integer, text) from public, anon;
revoke all on function public.admin_merge_terms(uuid, uuid) from public, anon;

grant execute on function public.admin_user_detail(uuid) to authenticated;
grant execute on function public.admin_user_words(uuid, text, integer, integer) to authenticated;
grant execute on function public.admin_user_activity(uuid, integer) to authenticated;
grant execute on function public.admin_terms(text, smallint, integer, integer, text) to authenticated;
grant execute on function public.admin_merge_terms(uuid, uuid) to authenticated;
