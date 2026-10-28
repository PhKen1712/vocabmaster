-- ===========================================================================
-- VocabMaster — đồng bộ hai chiều (v4)
--
-- Nguyên tắc thiết kế (không được phá):
--   1. Chạy lại an toàn: mọi câu lệnh đều idempotent (create ... if not exists,
--      create or replace, do $$ ... $$ có bắt lỗi). Không xoá, không sửa dữ
--      liệu đang có.
--   2. Client KHÔNG bao giờ được ghi thẳng số dư xu. Xu chỉ đi qua
--      public.award_coins (security definer, idempotent theo source_id).
--   3. Đẩy lên thì chống trùng theo khoá tự nhiên:
--        terms        -> normalized (unique)
--        user_words   -> (user_id, term_id)
--        reviews      -> id do máy khách sinh
--        daily_activity -> (user_id, day)
--        album_items  -> (album_id, term_id)
--        coin_ledger  -> (user_id, source_id)
--      Gửi lại cùng dữ liệu không tạo thêm dòng nào.
--   4. Tiến độ học không bị "lùi" do gói tin đến muộn: các bộ đếm lấy
--      greatest(cũ, mới); trường lịch ôn lấy theo updated_at mới hơn.
--   5. Xoá mềm (deleted_at) được đồng bộ như một thay đổi bình thường.
--
-- Áp bằng: npm run cloud:apply -- --sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Cột & bảng còn thiếu
-- ---------------------------------------------------------------------------

-- Khoá tự nhiên của một từ trong app là (normalized_term, track): cùng một từ có
-- thể nằm ở cả General English và IELTS Vocabulary với tiến độ riêng. Nếu server
-- chỉ unique theo `normalized` thì từ thứ hai sẽ bị nuốt mất khi đồng bộ.
-- Thêm track và đổi khoá duy nhất cho khớp với app.
alter table public.terms add column if not exists track text not null default 'general';
alter table public.terms drop constraint if exists terms_normalized_key;
create unique index if not exists terms_normalized_track_key
  on public.terms (normalized, track);
create index if not exists terms_track_level_idx on public.terms (track, level);

-- Album của một người được nhận diện ổn định giữa các thiết bị bằng client_id
-- (máy khách sinh). Không đổi khoá chính hiện có để khỏi ảnh hưởng dữ liệu cũ.
alter table public.albums add column if not exists client_id text;
create unique index if not exists albums_client_key
  on public.albums (user_id, client_id) where client_id is not null;

-- Trạng thái đồng bộ theo từng thiết bị: admin nhìn được máy nào đã gửi gì.
create table if not exists public.sync_state (
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_id    text not null,
  platform     text,
  app_version  text,
  last_push_at timestamptz,
  last_pull_at timestamptz,
  pushed_rows  integer not null default 0,
  pulled_rows  integer not null default 0,
  note         text,
  primary key (user_id, device_id)
);

alter table public.sync_state enable row level security;

revoke all on public.sync_state from anon;
revoke all on public.sync_state from authenticated;
-- Chỉ đọc của chính mình; ghi là việc của hàm security definer bên dưới.
grant select on public.sync_state to authenticated;

drop policy if exists sync_state_read_own on public.sync_state;
create policy sync_state_read_own on public.sync_state
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Chuẩn hoá dữ liệu vào
-- ---------------------------------------------------------------------------

-- Đổi rating số 1..4 của app thành nhãn của server (và ngược lại ở chiều pull).
create or replace function public.rating_to_label(p integer)
returns text
language sql
immutable
as $$
  select case p
    when 1 then 'forgot'
    when 2 then 'hard'
    when 3 then 'good'
    when 4 then 'easy'
    else null
  end;
$$;

create or replace function public.label_to_rating(p text)
returns integer
language sql
immutable
as $$
  select case p
    when 'forgot' then 1
    when 'hard' then 2
    when 'good' then 3
    when 'easy' then 4
    else null
  end;
$$;

-- learning_state của app có thêm 'relearning'; server gom về 'review'.
create or replace function public.map_learning_state(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'new' then 'new'
    when 'learning' then 'learning'
    when 'relearning' then 'review'
    when 'review' then 'review'
    when 'known' then 'mastered'
    when 'mastered' then 'mastered'
    else 'new'
  end;
$$;

-- Ngược lại: 'mastered' của server = 'known' của app.
create or replace function public.unmap_learning_state(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'mastered' then 'known'
    when 'review' then 'review'
    when 'learning' then 'learning'
    else 'new'
  end;
$$;

-- Cắt gọn mảng text/jsonb gửi từ máy khách để không nhận rác vào bảng.
create or replace function public.safe_text_array(p jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) as t(value)),
    '{}'::text[]
  );
$$;

/**
 * Lấy id của một từ, tạo mới nếu chưa có.
 *
 * Vì sao cần: gói tin có thể chứa tiến độ của một từ mà bản thân từ đó chưa
 * được đẩy lên (mạng đứt giữa hai lần gửi). Bỏ qua dòng đó là mất tiến độ của
 * người học, nên thà tạo một dòng từ tối thiểu còn hơn. Mọi thứ khác sẽ được
 * vá lại ở lần đẩy sau, khi bản ghi từ đầy đủ tới.
 */
create or replace function public.ensure_term(p_term text, p_track text default 'general')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm  text := public.normalize_term(p_term);
  v_track text := case when p_track = 'ielts' then 'ielts' else 'general' end;
  v_id    uuid;
begin
  if v_norm = '' then
    return null;
  end if;

  select id into v_id from public.terms where normalized = v_norm and track = v_track;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.terms (term, normalized, track, meaning_vi, source, level)
  values (btrim(regexp_replace(p_term, '\s+', ' ', 'g')), v_norm, v_track, '', 'sync', 2)
  on conflict (normalized, track) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.terms where normalized = v_norm and track = v_track;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ĐẨY LÊN: sync_push
-- ---------------------------------------------------------------------------

/**
 * Nhận một gói thay đổi từ máy khách và áp vào database.
 *
 * Khoá tự nhiên đảm bảo gửi lại không nhân đôi. Hàm chạy trong MỘT giao dịch:
 * hoặc cả gói vào, hoặc không gì cả — nhờ vậy máy khách không bao giờ có trạng
 * thái nửa vời (từ đã lên mà tiến độ thì chưa).
 *
 * Trả về:
 *   { ok, server_time, terms: {"<normalized>": "<uuid>"}, applied: {...} }
 */
create or replace function public.sync_push(
  p_payload   jsonb,
  p_device_id text default null,
  p_platform  text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_time     timestamptz := now();
  v_terms    jsonb;
  v_track    text;
  v_ids      jsonb := '{}'::jsonb;
  v_applied  jsonb := '{}'::jsonb;
  v_count    integer;
  v_term     jsonb;
  v_row      jsonb;
  v_term_id  uuid;
  v_album_id uuid;
  v_client   text;
  v_norm     text;
  v_pushed   integer := 0;
begin
  if v_user is null then
    raise exception 'chưa đăng nhập' using errcode = '28000';
  end if;
  if not public.is_active_user() then
    raise exception 'tài khoản đã bị khoá' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------------
  -- 3.1 Từ điển dùng chung: thêm cái chưa có, KHÔNG ghi đè nội dung đã có
  -- ------------------------------------------------------------------
  v_terms := coalesce(p_payload -> 'terms', '[]'::jsonb);
  for v_term in select * from jsonb_array_elements(v_terms) loop
    v_norm := public.normalize_term(v_term ->> 'term');
    v_track := case when v_term ->> 'track' = 'ielts' then 'ielts' else 'general' end;
    continue when v_norm = '';

    insert into public.terms as t (
      term, normalized, track, ipa, part_of_speech, meaning_vi, definition_en,
      example_en, example_vi, synonyms, antonyms, collocations, word_family,
      level, level_source, source, ai_generated, topic_id
    )
    values (
      btrim(regexp_replace(coalesce(v_term ->> 'term', ''), '\s+', ' ', 'g')),
      v_norm,
      v_track,
      nullif(btrim(coalesce(v_term ->> 'ipa', '')), ''),
      nullif(btrim(coalesce(v_term ->> 'partOfSpeech', '')), ''),
      nullif(btrim(coalesce(v_term ->> 'meaningVi', '')), ''),
      nullif(btrim(coalesce(v_term ->> 'definitionEn', '')), ''),
      nullif(btrim(coalesce(v_term ->> 'exampleEn', '')), ''),
      nullif(btrim(coalesce(v_term ->> 'exampleVi', '')), ''),
      public.safe_text_array(v_term -> 'synonyms'),
      public.safe_text_array(v_term -> 'antonyms'),
      public.safe_text_array(v_term -> 'collocations'),
      nullif(btrim(coalesce(v_term ->> 'wordFamilyText', '')), ''),
      greatest(least(coalesce((v_term ->> 'level')::smallint, 2), 6), 0),
      case when coalesce(v_term ->> 'levelSource', 'ai') in ('ai','pack','settings','import')
           then coalesce(v_term ->> 'levelSource', 'ai') else 'import' end,
      coalesce(v_term ->> 'source', 'sync'),
      coalesce((v_term ->> 'aiGenerated')::boolean, false),
      nullif(v_term ->> 'topicId', '')::uuid
    )
    on conflict (normalized, track) do nothing;

    select id into v_term_id from public.terms where normalized = v_norm and track = v_track;
    if v_term_id is not null then
      -- Khoá trả về gồm cả track: "environment" ở General và ở IELTS là hai từ
      -- khác nhau với tiến độ khác nhau.
      v_ids := v_ids || jsonb_build_object(v_norm || '|' || v_track, v_term_id);
      v_pushed := v_pushed + 1;
    end if;
  end loop;
  v_applied := v_applied || jsonb_build_object('terms', v_pushed);

  -- ------------------------------------------------------------------
  -- 3.2 Tiến độ từng từ (user_words)
  -- ------------------------------------------------------------------
  v_count := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'user_words', '[]'::jsonb)) loop
    v_norm := public.normalize_term(v_row ->> 'term');
    v_track := case when v_row ->> 'track' = 'ielts' then 'ielts' else 'general' end;
    v_term_id := coalesce(
      nullif(v_row ->> 'termId', '')::uuid,
      nullif(v_ids ->> (v_norm || '|' || v_track), '')::uuid,
      public.ensure_term(v_row ->> 'term', v_track)
    );
    continue when v_term_id is null;

    insert into public.user_words as uw (
      user_id, term_id, learning_state, due_at, stability, difficulty, reps,
      lapses, correct_count, wrong_count, hint_count, last_correct_at,
      last_wrong_at, memory_rating, is_favorite, updated_at, deleted_at
    )
    values (
      v_user,
      v_term_id,
      public.map_learning_state(v_row ->> 'learningState'),
      nullif(v_row ->> 'dueAt', '')::timestamptz,
      coalesce((v_row ->> 'stability')::double precision, 0),
      coalesce((v_row ->> 'difficulty')::double precision, 0),
      greatest(coalesce((v_row ->> 'reps')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'lapses')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'correctCount')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'wrongCount')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'hintCount')::integer, 0), 0),
      nullif(v_row ->> 'lastCorrectAt', '')::timestamptz,
      nullif(v_row ->> 'lastWrongAt', '')::timestamptz,
      case when public.rating_to_label(coalesce((v_row ->> 'memoryRating')::integer, 0)) is null
           then null else public.rating_to_label((v_row ->> 'memoryRating')::integer) end,
      coalesce((v_row ->> 'isFavorite')::boolean, false),
      coalesce(nullif(v_row ->> 'updatedAt', '')::timestamptz, v_time),
      nullif(v_row ->> 'deletedAt', '')::timestamptz
    )
    on conflict (user_id, term_id) do update set
      -- Bộ đếm: chỉ tăng, không bao giờ giảm vì một gói tin đến muộn.
      correct_count = greatest(uw.correct_count, excluded.correct_count),
      wrong_count   = greatest(uw.wrong_count, excluded.wrong_count),
      hint_count    = greatest(uw.hint_count, excluded.hint_count),
      reps          = greatest(uw.reps, excluded.reps),
      lapses        = greatest(uw.lapses, excluded.lapses),
      last_correct_at = greatest(uw.last_correct_at, excluded.last_correct_at),
      last_wrong_at   = greatest(uw.last_wrong_at, excluded.last_wrong_at),
      is_favorite   = excluded.is_favorite,
      -- Lịch ôn & trạng thái: theo bản mới hơn (last-write-wins).
      learning_state = case when excluded.updated_at >= uw.updated_at
                            then excluded.learning_state else uw.learning_state end,
      due_at         = case when excluded.updated_at >= uw.updated_at
                            then excluded.due_at else uw.due_at end,
      stability      = case when excluded.updated_at >= uw.updated_at
                            then excluded.stability else uw.stability end,
      difficulty     = case when excluded.updated_at >= uw.updated_at
                            then excluded.difficulty else uw.difficulty end,
      memory_rating  = case when excluded.updated_at >= uw.updated_at
                            then excluded.memory_rating else uw.memory_rating end,
      deleted_at     = greatest(uw.deleted_at, excluded.deleted_at),
      updated_at     = greatest(uw.updated_at, excluded.updated_at);

    v_count := v_count + 1;
  end loop;
  v_applied := v_applied || jsonb_build_object('user_words', v_count);
  v_pushed := v_pushed + v_count;

  -- ------------------------------------------------------------------
  -- 3.3 Lượt ôn (chỉ ghi thêm)
  -- ------------------------------------------------------------------
  v_count := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'reviews', '[]'::jsonb)) loop
    v_norm := public.normalize_term(v_row ->> 'term');
    v_track := case when v_row ->> 'track' = 'ielts' then 'ielts' else 'general' end;
    v_term_id := coalesce(
      nullif(v_row ->> 'termId', '')::uuid,
      nullif(v_ids ->> (v_norm || '|' || v_track), '')::uuid,
      public.ensure_term(v_row ->> 'term', v_track)
    );
    continue when v_term_id is null;
    continue when nullif(v_row ->> 'id', '') is null;

    insert into public.reviews (id, user_id, term_id, rating, correct, mode, cycle_id, created_at)
    values (
      (v_row ->> 'id')::uuid,
      v_user,
      v_term_id,
      public.rating_to_label(coalesce((v_row ->> 'rating')::integer, 3)),
      coalesce((v_row ->> 'correct')::boolean, false),
      coalesce(v_row ->> 'mode', 'sync'),
      nullif(v_row ->> 'cycleId', ''),
      coalesce(nullif(v_row ->> 'reviewedAt', '')::timestamptz, v_time)
    )
    on conflict (id) do nothing;

    v_count := v_count + 1;
  end loop;
  v_applied := v_applied || jsonb_build_object('reviews', v_count);
  v_pushed := v_pushed + v_count;

  -- ------------------------------------------------------------------
  -- 3.4 Hoạt động theo ngày: cộng dồn theo greatest để không nhân đôi
  -- ------------------------------------------------------------------
  v_count := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'daily_activity', '[]'::jsonb)) loop
    continue when nullif(v_row ->> 'day', '') is null;
    insert into public.daily_activity as da (user_id, day, new_words, reviews, answered, correct, streak)
    values (
      v_user,
      (v_row ->> 'day')::date,
      greatest(coalesce((v_row ->> 'newWords')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'reviews')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'answered')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'correct')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'streak')::integer, 0), 0)
    )
    on conflict (user_id, day) do update set
      new_words = greatest(da.new_words, excluded.new_words),
      reviews   = greatest(da.reviews, excluded.reviews),
      answered  = greatest(da.answered, excluded.answered),
      correct   = greatest(da.correct, excluded.correct),
      streak    = greatest(da.streak, excluded.streak);
    v_count := v_count + 1;
  end loop;
  v_applied := v_applied || jsonb_build_object('daily_activity', v_count);
  v_pushed := v_pushed + v_count;

  -- ------------------------------------------------------------------
  -- 3.5 Album + thành viên album (xoá mềm bằng deleted_at)
  -- ------------------------------------------------------------------
  v_row := p_payload -> 'album';
  v_client := nullif(v_row ->> 'clientId', '');
  if v_client is not null then
    insert into public.albums (user_id, client_id, name, notify_enabled, interval_minutes, start_hour, end_hour)
    values (
      v_user, v_client,
      coalesce(nullif(btrim(coalesce(v_row ->> 'name', '')), ''), 'Album của tôi'),
      coalesce((v_row ->> 'notifyEnabled')::boolean, false),
      greatest(least(coalesce((v_row ->> 'intervalMinutes')::integer, 30), 20160), 1),
      greatest(least(coalesce((v_row ->> 'startHour')::smallint, 8), 23), 0),
      greatest(least(coalesce((v_row ->> 'endHour')::smallint, 22), 23), 0)
    )
    on conflict (user_id, client_id) where client_id is not null do update set
      name = excluded.name,
      notify_enabled = excluded.notify_enabled,
      interval_minutes = excluded.interval_minutes,
      start_hour = excluded.start_hour,
      end_hour = excluded.end_hour;

    select id into v_album_id from public.albums where user_id = v_user and client_id = v_client;
  else
    select id into v_album_id from public.albums where user_id = v_user order by created_at limit 1;
    if v_album_id is null and v_row is not null then
      insert into public.albums (user_id, name) values (v_user, 'Album của tôi') returning id into v_album_id;
    end if;
  end if;

  v_count := 0;
  if v_album_id is not null then
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'album_items', '[]'::jsonb)) loop
      v_norm := public.normalize_term(v_row ->> 'term');
      v_track := case when v_row ->> 'track' = 'ielts' then 'ielts' else 'general' end;
      v_term_id := coalesce(
        nullif(v_row ->> 'termId', '')::uuid,
        nullif(v_ids ->> (v_norm || '|' || v_track), '')::uuid,
        public.ensure_term(v_row ->> 'term', v_track)
      );
      continue when v_term_id is null;

      insert into public.album_items as ai (album_id, term_id, added_at, deleted_at, last_notified_at, notify_count)
      values (
        v_album_id,
        v_term_id,
        coalesce(nullif(v_row ->> 'addedAt', '')::timestamptz, v_time),
        nullif(v_row ->> 'deletedAt', '')::timestamptz,
        nullif(v_row ->> 'lastNotifiedAt', '')::timestamptz,
        greatest(coalesce((v_row ->> 'notifyCount')::integer, 0), 0)
      )
      on conflict (album_id, term_id) do update set
        deleted_at = excluded.deleted_at,
        added_at = least(ai.added_at, excluded.added_at),
        last_notified_at = greatest(ai.last_notified_at, excluded.last_notified_at),
        notify_count = greatest(ai.notify_count, excluded.notify_count);
      v_count := v_count + 1;
    end loop;
  end if;
  v_applied := v_applied || jsonb_build_object('album_items', v_count);
  v_pushed := v_pushed + v_count;

  -- ------------------------------------------------------------------
  -- 3.6 Chu kỳ học (mốc "học lại từ đầu" — dùng cho quy tắc xu)
  -- ------------------------------------------------------------------
  v_count := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'study_cycles', '[]'::jsonb)) loop
    continue when nullif(v_row ->> 'id', '') is null;
    insert into public.study_cycles (id, user_id, started_at, reason)
    values (
      v_row ->> 'id',
      v_user,
      coalesce(nullif(v_row ->> 'startedAt', '')::timestamptz, v_time),
      nullif(v_row ->> 'reason', '')
    )
    on conflict (user_id, id) do nothing;
    v_count := v_count + 1;
  end loop;
  v_applied := v_applied || jsonb_build_object('study_cycles', v_count);
  v_pushed := v_pushed + v_count;

  -- ------------------------------------------------------------------
  -- 3.7 Xu: chỉ qua award_coins, idempotent theo source_id
  -- ------------------------------------------------------------------
  v_count := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'coins', '[]'::jsonb)) loop
    continue when coalesce((v_row ->> 'amount')::integer, 0) = 0;
    continue when nullif(v_row ->> 'sourceId', '') is null;
    perform public.award_coins(
      case when (v_row ->> 'amount')::integer >= 0 then 'reward' else 'penalty' end,
      (v_row ->> 'amount')::integer,
      v_row ->> 'sourceId',
      nullif(v_row ->> 'reason', ''),
      null,
      nullif(v_row ->> 'cycleId', '')
    );
    v_count := v_count + 1;
  end loop;
  v_applied := v_applied || jsonb_build_object('coins', v_count);
  v_pushed := v_pushed + v_count;

  -- ------------------------------------------------------------------
  -- 3.8 Cài đặt cá nhân
  -- ------------------------------------------------------------------
  if p_payload ? 'settings' and jsonb_typeof(p_payload -> 'settings') = 'object' then
    update public.profiles
       set settings = p_payload -> 'settings'
     where user_id = v_user;
    v_applied := v_applied || jsonb_build_object('settings', 1);
    v_pushed := v_pushed + 1;
  end if;

  -- ------------------------------------------------------------------
  -- 3.9 Ghi nhận trạng thái đồng bộ của thiết bị
  -- ------------------------------------------------------------------
  if p_device_id is not null then
    insert into public.sync_state as s (
      user_id, device_id, platform, app_version, last_push_at, pushed_rows
    )
    values (v_user, p_device_id, p_platform, p_app_version, v_time, v_pushed)
    on conflict (user_id, device_id) do update set
      platform = coalesce(excluded.platform, s.platform),
      app_version = coalesce(excluded.app_version, s.app_version),
      last_push_at = v_time,
      pushed_rows = s.pushed_rows + v_pushed;
  end if;

  return jsonb_build_object(
    'ok', true,
    'server_time', v_time,
    'terms', v_ids,
    'applied', v_applied
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. KÉO VỀ: sync_pull
-- ---------------------------------------------------------------------------

/**
 * Trả về mọi thay đổi của chính người đang đăng nhập kể từ `p_since`.
 *
 * Bao gồm cả dòng đã xoá mềm (deleted_at) để máy khách biết mà xoá theo —
 * nếu lọc mất chúng thì xoá trên máy A sẽ không bao giờ tới máy B.
 */
create or replace function public.sync_pull(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_from timestamptz := coalesce(p_since, 'epoch'::timestamptz);
  v_time timestamptz := now();
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'chưa đăng nhập' using errcode = '28000';
  end if;
  if not public.is_active_user() then
    raise exception 'tài khoản đã bị khoá' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'server_time', v_time,
    'words', coalesce((
      select jsonb_agg(jsonb_build_object(
        'termId', uw.term_id,
        'term', t.term,
        'normalizedTerm', t.normalized,
        'track', t.track,
        'ipa', t.ipa,
        'partOfSpeech', t.part_of_speech,
        'meaningVi', t.meaning_vi,
        'definitionEn', t.definition_en,
        'exampleEn', t.example_en,
        'exampleVi', t.example_vi,
        'synonyms', t.synonyms,
        'antonyms', t.antonyms,
        'collocations', t.collocations,
        'wordFamilyText', t.word_family,
        'level', t.level,
        'levelSource', t.level_source,
        'learningState', public.unmap_learning_state(uw.learning_state),
        'dueAt', uw.due_at,
        'stability', uw.stability,
        'difficulty', uw.difficulty,
        'reps', uw.reps,
        'lapses', uw.lapses,
        'correctCount', uw.correct_count,
        'wrongCount', uw.wrong_count,
        'hintCount', uw.hint_count,
        'lastCorrectAt', uw.last_correct_at,
        'lastWrongAt', uw.last_wrong_at,
        'memoryRating', public.label_to_rating(uw.memory_rating),
        'isFavorite', uw.is_favorite,
        'updatedAt', uw.updated_at,
        'deletedAt', uw.deleted_at
      ))
      from public.user_words uw
      join public.terms t on t.id = uw.term_id
      where uw.user_id = v_user and uw.updated_at > v_from
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'termId', r.term_id,
        'term', coalesce(t.term, ''),
        'rating', public.label_to_rating(r.rating),
        'correct', r.correct,
        'mode', r.mode,
        'cycleId', r.cycle_id,
        'reviewedAt', r.created_at
      ))
      from public.reviews r
      left join public.terms t on t.id = r.term_id
      where r.user_id = v_user and r.created_at > v_from
    ), '[]'::jsonb),
    'daily_activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', da.day,
        'newWords', da.new_words,
        'reviews', da.reviews,
        'answered', da.answered,
        'correct', da.correct,
        'streak', da.streak,
        'updatedAt', da.updated_at
      ))
      from public.daily_activity da
      where da.user_id = v_user and da.updated_at > v_from
    ), '[]'::jsonb),
    'albums', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'clientId', a.client_id,
        'name', a.name,
        'notifyEnabled', a.notify_enabled,
        'intervalMinutes', a.interval_minutes,
        'startHour', a.start_hour,
        'endHour', a.end_hour,
        'updatedAt', a.updated_at
      ))
      from public.albums a
      where a.user_id = v_user and a.updated_at > v_from
    ), '[]'::jsonb),
    'album_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'albumId', ai.album_id,
        'termId', ai.term_id,
        'term', coalesce(t.term, ''),
        'addedAt', ai.added_at,
        'deletedAt', ai.deleted_at,
        'lastNotifiedAt', ai.last_notified_at,
        'notifyCount', ai.notify_count
      ))
      from public.album_items ai
      join public.albums a on a.id = ai.album_id
      left join public.terms t on t.id = ai.term_id
      where a.user_id = v_user
        and (
          ai.added_at > v_from
          or coalesce(ai.deleted_at, 'epoch'::timestamptz) > v_from
          or coalesce(ai.last_notified_at, 'epoch'::timestamptz) > v_from
        )
    ), '[]'::jsonb),
    'coins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cl.id,
        'kind', cl.kind,
        'amount', cl.amount,
        'balanceAfter', cl.balance_after,
        'reason', cl.reason,
        'sourceId', cl.source_id,
        'cycleId', cl.cycle_id,
        'createdAt', cl.created_at
      ))
      from public.coin_ledger cl
      where cl.user_id = v_user and cl.created_at > v_from
    ), '[]'::jsonb),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sc.id,
        'startedAt', sc.started_at,
        'reason', sc.reason
      ))
      from public.study_cycles sc
      where sc.user_id = v_user and sc.started_at > v_from
    ), '[]'::jsonb),
    'settings', coalesce((
      select p.settings from public.profiles p where p.user_id = v_user
    ), '{}'::jsonb),
    'balance', public.my_coin_balance()
  ) into v_result;

  insert into public.sync_state as s (user_id, device_id, last_pull_at, pulled_rows)
  values (
    v_user,
    coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-device-id',
      'unknown'
    ),
    v_time,
    coalesce(jsonb_array_length(v_result -> 'words'), 0)
      + coalesce(jsonb_array_length(v_result -> 'reviews'), 0)
      + coalesce(jsonb_array_length(v_result -> 'album_items'), 0)
  )
  on conflict (user_id, device_id) do update set
    last_pull_at = v_time,
    pulled_rows = s.pulled_rows + coalesce(jsonb_array_length(v_result -> 'words'), 0)
      + coalesce(jsonb_array_length(v_result -> 'reviews'), 0)
      + coalesce(jsonb_array_length(v_result -> 'album_items'), 0);

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reset tiến độ học trên server (đi kèm nút "Reset dữ liệu học tập")
-- ---------------------------------------------------------------------------

/**
 * Đưa tiến độ học của người đang đăng nhập về trạng thái chưa học.
 *
 * GIỮ NGUYÊN: từ điển, nghĩa, level, chủ đề, album, số dư xu, streak.
 * XOÁ: tiến độ từng từ, lịch ôn, lượt ôn, hoạt động theo ngày.
 * GHI LẠI một chu kỳ học mới để quy tắc xu biết đây là lần học lại hợp lệ.
 *
 * Số dư xu KHÔNG bị đụng tới: lịch sử giao dịch là sổ sách, không phải tiến độ.
 */
create or replace function public.reset_study_progress(p_reason text default 'reset từ ứng dụng')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_cycle text;
  v_words integer;
  v_reviews integer;
begin
  if v_user is null then
    raise exception 'chưa đăng nhập' using errcode = '28000';
  end if;
  if not public.is_active_user() then
    raise exception 'tài khoản đã bị khoá' using errcode = '42501';
  end if;

  select count(*) into v_reviews from public.reviews where user_id = v_user;

  update public.user_words
     set learning_state = 'new',
         due_at = null,
         stability = 0,
         difficulty = 0,
         reps = 0,
         lapses = 0,
         correct_count = 0,
         wrong_count = 0,
         hint_count = 0,
         last_correct_at = null,
         last_wrong_at = null,
         memory_rating = null,
         updated_at = now()
   where user_id = v_user and deleted_at is null;
  get diagnostics v_words = row_count;

  delete from public.reviews where user_id = v_user;
  delete from public.daily_activity where user_id = v_user;

  v_cycle := 'cycle-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || left(gen_random_uuid()::text, 8);
  insert into public.study_cycles (id, user_id, started_at, reason)
  values (v_cycle, v_user, now(), p_reason)
  on conflict (user_id, id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'cycle_id', v_cycle,
    'words_reset', v_words,
    'reviews_deleted', v_reviews,
    'server_time', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Quyền gọi hàm
-- ---------------------------------------------------------------------------

revoke all on function public.ensure_term(text) from public, anon;
revoke all on function public.sync_push(jsonb, text, text, text) from public, anon;
revoke all on function public.sync_pull(timestamptz) from public, anon;
revoke all on function public.reset_study_progress(text) from public, anon;
grant execute on function public.sync_push(jsonb, text, text, text) to authenticated;
grant execute on function public.sync_pull(timestamptz) to authenticated;
grant execute on function public.reset_study_progress(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime: chỉ những bảng cần biết "máy khác vừa đổi gì"
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_tables text[] := array[
    'user_words', 'album_items', 'albums', 'daily_activity', 'coin_ledger', 'profiles'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array v_tables loop
    if exists (select 1 from pg_class where relname = v_table and relnamespace = 'public'::regnamespace)
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
       )
    then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Kiểm chứng nhanh sau khi áp (chỉ đọc, an toàn khi chạy lại)
-- ---------------------------------------------------------------------------

select
  'sync_ready' as check,
  to_regprocedure('public.sync_push(jsonb,text,text,text)') is not null as has_push,
  to_regprocedure('public.sync_pull(timestamptz)') is not null as has_pull,
  to_regprocedure('public.reset_study_progress(text)') is not null as has_reset,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'terms' and column_name = 'track') = 1 as terms_has_track,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public') as realtime_tables;
