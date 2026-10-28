-- ===========================================================================
-- 0008 · Chuỗi ngày học có dữ liệu thật để quản trị
--
-- Vì sao cần migration này (lỗi thật đã thấy trên bảng quản trị):
--
--   1. App không gửi cờ "ngày này đã đạt mục tiêu" lên server, và cột
--      daily_activity.streak cũng không bao giờ được gửi (luôn 0). Hệ quả:
--      admin_streak_info luôn trả current = 0 cho mọi tài khoản, nên bảng quản
--      trị không thể biết chuỗi ngày thật của người học.
--   2. Sau khi admin đặt streak, màn chi tiết vẫn hiện 0 — mốc điều chỉnh
--      (streak_grants) không được tính vào con số hiển thị.
--
-- Cách sửa:
--   * thêm cột goal_met (do app gửi lên, chỉ tăng khi trùng ngày);
--   * sync_push/sync_pull mang thêm trường đó;
--   * admin_streak_info tự tính chuỗi từ các ngày đạt mục tiêu + mốc admin đặt,
--     theo đúng quy tắc app dùng (computeStreak): mốc thay thế chuỗi TRƯỚC mốc,
--     các ngày sau mốc vẫn nối tiếp; mốc còn sống khi ngày cuối của chuỗi là
--     hôm nay hoặc hôm qua.
--
-- Không xoá dữ liệu, không sửa lịch sử học. Cột streak cũ được giữ nguyên cho
-- tương thích ngược và vẫn được trả về (lastStreak).
-- ===========================================================================

alter table public.daily_activity
  add column if not exists goal_met boolean not null default false;

-- Lấp dữ liệu cũ một cách bảo thủ: ngày đã có hoạt động và đã hoàn thành mục
-- tiêu theo cài đặt HIỆN TẠI thì đánh dấu. Đây là suy luận, không phải bịa:
-- nó chỉ đánh dấu true khi số liệu thật đã vượt mục tiêu; không bao giờ đặt
-- false cho dữ liệu đã đúng, và không tạo ngày học mới.
update public.daily_activity da
   set goal_met = true
  from public.profiles p
 where p.user_id = da.user_id
   and da.goal_met = false
   and da.answered > 0
   and da.new_words + da.reviews >= greatest(
         coalesce((p.settings ->> 'dailyGoal')::integer, 10), 1);

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
    insert into public.daily_activity as da
      (user_id, day, new_words, reviews, answered, correct, streak, goal_met)
    values (
      v_user,
      (v_row ->> 'day')::date,
      greatest(coalesce((v_row ->> 'newWords')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'reviews')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'answered')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'correct')::integer, 0), 0),
      greatest(coalesce((v_row ->> 'streak')::integer, 0), 0),
      -- Cờ "ngày này đã đạt mục tiêu" do app gửi lên. Cũ = chỉ tăng (OR),
      -- vì một gói tin cũ không được phép rút ngắn chuỗi ngày thật.
      coalesce((v_row ->> 'goalMet')::boolean, false)
    )
    on conflict (user_id, day) do update set
      new_words = greatest(da.new_words, excluded.new_words),
      reviews   = greatest(da.reviews, excluded.reviews),
      answered  = greatest(da.answered, excluded.answered),
      correct   = greatest(da.correct, excluded.correct),
      streak    = greatest(da.streak, excluded.streak),
      goal_met  = da.goal_met or excluded.goal_met;
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
        'goalMet', da.goal_met,
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
-- Quản trị: đọc tình trạng streak (có tính mốc điều chỉnh)
-- ---------------------------------------------------------------------------

create or replace function public.admin_streak_info(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today        date := (now() at time zone 'UTC')::date;
  v_last_day     date;          -- ngày hoạt động gần nhất (có trả lời)
  v_last_goal    date;          -- ngày đạt mục tiêu gần nhất
  v_last_streak  integer := 0;
  v_longest      integer := 0;
  v_run          integer := 0;
  v_prev         date;
  v_current      integer := 0;
  v_days         jsonb := '[]'::jsonb;
  v_grants       jsonb := '[]'::jsonb;
  v_grant        public.streak_grants;
  v_grant_day    date;
  v_extra        integer := 0;
  v_cursor       date;
  v_from_grant   integer := 0;
  v_end          date;
begin
  if not public.is_admin() then
    raise exception 'chỉ quản trị viên được xem streak' using errcode = '42501';
  end if;

  select max(day) filter (where answered > 0), max(day) filter (where goal_met)
    into v_last_day, v_last_goal
  from public.daily_activity
  where user_id = p_user_id;

  -- Chuỗi dài nhất theo các ngày đạt mục tiêu (độc lập với mốc điều chỉnh).
  v_run := 0;
  v_longest := 0;
  v_prev := null;
  for v_cursor in
    select day from public.daily_activity
    where user_id = p_user_id and goal_met
    order by day asc
  loop
    if v_prev is not null and v_cursor = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    v_longest := greatest(v_longest, v_run);
    v_prev := v_cursor;
  end loop;

  -- Streak không có mốc: đếm lùi từ hôm nay/hôm qua trên các ngày đạt mục tiêu.
  if v_last_goal is not null and v_last_goal >= v_today - 1 then
    v_cursor := v_last_goal;
    while exists (
      select 1 from public.daily_activity
      where user_id = p_user_id and day = v_cursor and goal_met
    ) loop
      v_current := v_current + 1;
      v_cursor := v_cursor - 1;
      exit when v_current > 3650;
    end loop;
  end if;

  -- Mốc điều chỉnh mới nhất thay thế chuỗi TRƯỚC mốc; các ngày đạt mục tiêu
  -- sau mốc vẫn nối tiếp, đúng như computeStreak() trong app.
  select * into v_grant
  from public.streak_grants
  where user_id = p_user_id
  order by created_at desc
  limit 1;

  if v_grant.id is not null then
    v_grant_day := (v_grant.created_at at time zone 'UTC')::date;
    v_cursor := v_grant_day + 1;
    while exists (
      select 1 from public.daily_activity
      where user_id = p_user_id and day = v_cursor and goal_met
    ) loop
      v_extra := v_extra + 1;
      v_cursor := v_cursor + 1;
      exit when v_extra > 3650;
    end loop;

    v_end := v_grant_day + v_extra;
    v_from_grant := v_grant.days + v_extra;

    if v_end >= v_today - 1 then
      v_current := v_from_grant;
    else
      v_current := 0;
    end if;

    v_longest := greatest(v_longest, v_from_grant);
  end if;

  select streak into v_last_streak
  from public.daily_activity
  where user_id = p_user_id
  order by day desc
  limit 1;

  select coalesce(jsonb_agg(row_json order by day desc), '[]'::jsonb)
    into v_days
  from (
    select day,
           jsonb_build_object(
             'day', day,
             'newWords', new_words,
             'reviews', reviews,
             'answered', answered,
             'correct', correct,
             'streak', streak,
             'goalMet', goal_met
           ) as row_json
    from public.daily_activity
    where user_id = p_user_id
    order by day desc
    limit 30
  ) recent;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'days', days,
           'reason', reason,
           'grantedBy', granted_by,
           'createdAt', created_at,
           'grantedByName', (
             select p.username from public.profiles p where p.user_id = streak_grants.granted_by
           )
         ) order by created_at desc), '[]'::jsonb)
    into v_grants
  from public.streak_grants
  where user_id = p_user_id;

  return jsonb_build_object(
    'userId', p_user_id,
    'current', greatest(v_current, 0),
    'longest', greatest(coalesce(v_longest, 0), 0),
    'lastStreak', coalesce(v_last_streak, 0),
    'lastDay', v_last_day,
    'lastGoalDay', v_last_goal,
    'grant', case when v_grant.id is null then null else jsonb_build_object(
      'days', v_grant.days,
      'date', v_grant_day,
      'reason', v_grant.reason,
      'createdAt', v_grant.created_at
    ) end,
    'today', v_today,
    'days', v_days,
    'grants', v_grants
  );
end;
$$;

revoke all on function public.admin_streak_info(uuid) from public;
grant execute on function public.admin_streak_info(uuid) to authenticated;
