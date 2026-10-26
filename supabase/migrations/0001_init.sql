-- ===========================================================================
-- VocabMaster — schema ban đầu (v1)
--
-- Áp bằng: Supabase Dashboard → SQL Editor → dán toàn bộ file này → Run.
-- Hoặc (sau này) supabase db push nếu dùng CLI.
--
-- Nguyên tắc:
--   1. Bảng có dữ liệu người dùng => RLS bật + policy chỉ chủ sở hữu.
--   2. Không bao giờ cấp quyền cho `anon`; chỉ `authenticated` đã đăng nhập.
--   3. Số dư xu KHÔNG phải cột ai cũng sửa được: chỉ hàm security definer ghi.
--   4. Từ điển dùng chung, tiến trình riêng: `terms` vs `user_words`.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Tiện ích dùng chung
-- ---------------------------------------------------------------------------

-- Chuẩn hoá từ để so khớp: trim, gộp khoảng trắng, lower.
create or replace function public.normalize_term(value text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')));
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Từ điển dùng chung
-- ---------------------------------------------------------------------------

create table if not exists public.topics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  normalized  text not null unique,
  created_at  timestamptz not null default now()
);

-- "Environment", "environment", " ENVIRONMENT " phải là một chủ đề duy nhất.
create or replace function public.topics_fill_normalized()
returns trigger
language plpgsql
as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.normalized := public.normalize_term(new.name);
  if new.normalized = '' then
    raise exception 'tên chủ đề rỗng' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists topics_normalize on public.topics;
create trigger topics_normalize
  before insert or update of name on public.topics
  for each row execute function public.topics_fill_normalized();

create table if not exists public.terms (
  id            uuid primary key default gen_random_uuid(),
  term          text not null,
  normalized    text not null unique,
  ipa           text,
  part_of_speech text,
  meaning_vi    text,
  definition_en text,
  example_en    text,
  example_vi    text,
  synonyms      text[] not null default '{}',
  antonyms      text[] not null default '{}',
  collocations  text[] not null default '{}',
  word_family   text,
  -- 0 = A1 ... 6 = C2 (khớp thang level trong app)
  level         smallint not null default 2 check (level between 0 and 6),
  -- 'ai' = Groq/model tự đánh giá, 'pack' = dữ liệu sẵn, 'settings' = người dùng chọn
  level_source  text not null default 'ai' check (level_source in ('ai', 'pack', 'settings', 'import')),
  topic_id      uuid references public.topics (id) on delete set null,
  source        text,
  ai_generated  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists terms_topic_idx on public.terms (topic_id);
create index if not exists terms_level_idx on public.terms (level);

create or replace function public.terms_fill_normalized()
returns trigger
language plpgsql
as $$
begin
  new.term := btrim(regexp_replace(new.term, '\s+', ' ', 'g'));
  new.normalized := public.normalize_term(new.term);
  if new.normalized = '' then
    raise exception 'từ rỗng' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists terms_normalize on public.terms;
create trigger terms_normalize
  before insert or update of term on public.terms
  for each row execute function public.terms_fill_normalized();

drop trigger if exists terms_touch on public.terms;
create trigger terms_touch
  before update on public.terms
  for each row execute function public.touch_updated_at();

-- Cấu hình toàn hệ thống do admin quản lý. KHÔNG chứa API key.
create table if not exists public.app_config (
  id                  smallint primary key default 1 check (id = 1),
  ai_enabled          boolean not null default true,
  ai_provider         text not null default 'groq' check (ai_provider in ('groq', 'gemini')),
  ai_model            text not null default 'openai/gpt-oss-120b',
  ai_daily_limit      integer not null default 200 check (ai_daily_limit >= 0),
  ai_max_batch        integer not null default 20 check (ai_max_batch between 1 and 100),
  last_error          text,
  last_error_at       timestamptz,
  updated_at          timestamptz not null default now()
);

insert into public.app_config (id) values (1) on conflict (id) do nothing;

drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch
  before update on public.app_config
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Tài khoản
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  normalized_username text generated always as (public.normalize_term(username)) stored,
  role       text not null default 'user' check (role in ('admin', 'user')),
  status     text not null default 'active' check (status in ('active', 'locked')),
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_key on public.profiles (normalized_username);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Mọi user mới (do admin tạo qua Admin API) đều có profile; không phụ thuộc client.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
begin
  v_username := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user-' || left(new.id::text, 8)
  );

  insert into public.profiles (user_id, username)
  values (new.id, v_username)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin = role admin VÀ đang active. security definer để policy không đệ quy RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Tiến trình học
-- ---------------------------------------------------------------------------

create table if not exists public.study_cycles (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  started_at  timestamptz not null default now(),
  reason      text,
  primary key (user_id, id)
);

create table if not exists public.user_words (
  user_id        uuid not null references auth.users (id) on delete cascade,
  term_id        uuid not null references public.terms (id) on delete cascade,
  -- 'new' | 'learning' | 'review' | 'mastered'
  learning_state text not null default 'new' check (learning_state in ('new', 'learning', 'review', 'mastered')),
  due_at         timestamptz,
  stability      double precision not null default 0,
  difficulty     double precision not null default 0,
  reps           integer not null default 0,
  lapses         integer not null default 0,
  correct_count  integer not null default 0,
  wrong_count    integer not null default 0,
  hint_count     integer not null default 0,
  last_correct_at timestamptz,
  last_wrong_at  timestamptz,
  -- mức tự đánh giá gần nhất: 'forgot' | 'hard' | 'good' | 'easy'
  memory_rating  text check (memory_rating in ('forgot', 'hard', 'good', 'easy')),
  is_favorite    boolean not null default false,
  added_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  primary key (user_id, term_id)
);

create index if not exists user_words_due_idx on public.user_words (user_id, due_at);
create index if not exists user_words_state_idx on public.user_words (user_id, learning_state);

drop trigger if exists user_words_touch on public.user_words;
create trigger user_words_touch
  before update on public.user_words
  for each row execute function public.touch_updated_at();

-- Lượt ôn: chỉ ghi thêm. id do máy khách sinh => gửi lại không nhân đôi.
create table if not exists public.reviews (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  term_id     uuid not null references public.terms (id) on delete cascade,
  rating      text check (rating in ('forgot', 'hard', 'good', 'easy')),
  correct     boolean,
  mode        text,
  cycle_id    text,
  created_at  timestamptz not null default now()
);

create index if not exists reviews_user_time_idx on public.reviews (user_id, created_at desc);

create table if not exists public.daily_activity (
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  new_words    integer not null default 0,
  reviews      integer not null default 0,
  answered     integer not null default 0,
  correct      integer not null default 0,
  streak       integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

drop trigger if exists daily_activity_touch on public.daily_activity;
create trigger daily_activity_touch
  before update on public.daily_activity
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Album
-- ---------------------------------------------------------------------------

create table if not exists public.albums (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null default 'Album của tôi',
  notify_enabled   boolean not null default false,
  interval_minutes integer not null default 30 check (interval_minutes between 1 and 20160),
  start_hour       smallint not null default 8 check (start_hour between 0 and 23),
  end_hour         smallint not null default 22 check (end_hour between 0 and 23),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists albums_user_idx on public.albums (user_id);

drop trigger if exists albums_touch on public.albums;
create trigger albums_touch
  before update on public.albums
  for each row execute function public.touch_updated_at();

create table if not exists public.album_items (
  album_id     uuid not null references public.albums (id) on delete cascade,
  term_id      uuid not null references public.terms (id) on delete cascade,
  added_at     timestamptz not null default now(),
  deleted_at   timestamptz,
  last_notified_at timestamptz,
  notify_count integer not null default 0,
  primary key (album_id, term_id)
);

create index if not exists album_items_term_idx on public.album_items (term_id);

-- ---------------------------------------------------------------------------
-- 5. Xu
-- ---------------------------------------------------------------------------

create table if not exists public.coin_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('reward', 'penalty', 'reset', 'admin')),
  amount        integer not null check (amount <> 0),
  balance_after integer not null,
  reason        text,
  -- Chống cộng trùng: mỗi sự kiện một source_id, duy nhất theo từng người.
  source_id     text not null,
  cycle_id      text,
  term_id       uuid references public.terms (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (user_id, source_id)
);

create index if not exists coin_ledger_user_time_idx on public.coin_ledger (user_id, created_at desc);

/**
 * Cộng/trừ xu cho chính người đang đăng nhập, idempotent theo (user_id, source_id).
 *
 * - Gửi lại cùng source_id => trả về đúng dòng cũ, số dư không đổi.
 * - Khoá advisory theo user để hai request song song không đọc cùng số dư cũ.
 */
create or replace function public.award_coins(
  p_kind      text,
  p_amount    integer,
  p_source_id text,
  p_reason    text default null,
  p_term_id   uuid default null,
  p_cycle_id  text default null
)
returns public.coin_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_prev  integer;
  v_row   public.coin_ledger;
begin
  if v_user is null then
    raise exception 'chưa đăng nhập' using errcode = '28000';
  end if;
  if not public.is_active_user() then
    raise exception 'tài khoản đã bị khoá' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('reward', 'penalty') then
    raise exception 'loại giao dịch không hợp lệ: %', p_kind using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'số xu phải khác 0' using errcode = '22023';
  end if;
  if (p_kind = 'reward' and p_amount < 0) or (p_kind = 'penalty' and p_amount > 0) then
    raise exception 'dấu của số xu không khớp loại giao dịch' using errcode = '22023';
  end if;
  if p_source_id is null or btrim(p_source_id) = '' then
    raise exception 'thiếu source_id: mọi giao dịch phải có khoá chống trùng' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('coins:' || v_user::text));

  select * into v_row
  from public.coin_ledger
  where user_id = v_user and source_id = p_source_id;
  if found then
    return v_row;
  end if;

  select coalesce(sum(amount), 0) into v_prev
  from public.coin_ledger
  where user_id = v_user;

  insert into public.coin_ledger
    (user_id, kind, amount, balance_after, reason, source_id, term_id, cycle_id)
  values
    (v_user, p_kind, p_amount, v_prev + p_amount, p_reason, p_source_id, p_term_id, p_cycle_id)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    select * into v_row
    from public.coin_ledger
    where user_id = v_user and source_id = p_source_id;
    return v_row;
end;
$$;

/**
 * Admin cộng/trừ/đặt số dư cho một người. Bắt buộc có lý do.
 * source_id do admin panel sinh (UUID) để giao dịch gửi lại không nhân đôi.
 */
create or replace function public.admin_adjust_coins(
  p_user_id   uuid,
  p_kind      text,
  p_amount    integer,
  p_reason    text,
  p_source_id text
)
returns public.coin_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev integer;
  v_row  public.coin_ledger;
begin
  if not public.is_admin() then
    raise exception 'chỉ admin được điều chỉnh xu' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'phải ghi lý do' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'số xu phải khác 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('coins:' || p_user_id::text));

  select * into v_row
  from public.coin_ledger
  where user_id = p_user_id and source_id = p_source_id;
  if found then
    return v_row;
  end if;

  select coalesce(sum(amount), 0) into v_prev
  from public.coin_ledger
  where user_id = p_user_id;

  -- Không kẹp về 0: kẹp sẽ làm balance_after lệch khỏi tổng sổ, và mọi lần
  -- đối soát sau này đều sai. Thà từ chối giao dịch còn hơn ghi sổ không khớp.
  if v_prev + p_amount < 0 then
    raise exception 'số dư không đủ: hiện có %, yêu cầu %', v_prev, p_amount using errcode = '22003';
  end if;

  insert into public.coin_ledger
    (user_id, kind, amount, balance_after, reason, source_id)
  values
    (p_user_id, p_kind, p_amount, v_prev + p_amount, p_reason, p_source_id)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    select * into v_row
    from public.coin_ledger
    where user_id = p_user_id and source_id = p_source_id;
    return v_row;
end;
$$;

create or replace function public.my_coin_balance()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount), 0)::integer
  from public.coin_ledger
  where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 6. Đo lường gọi AI (admin xem, client không ghi trực tiếp)
-- ---------------------------------------------------------------------------

create table if not exists public.ai_usage (
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  calls        integer not null default 0,
  errors       integer not null default 0,
  last_error   text,
  last_error_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- 7. Quyền + RLS
-- ---------------------------------------------------------------------------

-- QUAN TRỌNG: Supabase đặt default privileges cấp ALL trên bảng mới cho
-- `anon` và `authenticated`. Vì vậy `grant` một mình là CỘNG THÊM quyền, không
-- phải giới hạn quyền — đã kiểm chứng: thiếu revoke thì người dùng tự PATCH
-- profiles.role = 'admin' thành công. Luôn revoke trước, rồi grant đúng cái cần.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from anon;
revoke all on all sequences in schema public from authenticated;

grant select on public.topics, public.terms, public.app_config, public.profiles to authenticated;
grant insert, update, delete on public.topics, public.terms to authenticated;
-- Profile: chỉ được sửa tên hiển thị và cài đặt. `role`/`status` KHÔNG nằm trong
-- danh sách cột này, nên tự phong admin là bất khả thi ở tầng quyền.
grant update (settings, username) on public.profiles to authenticated;
grant select, insert, update, delete on public.user_words to authenticated;
grant select, insert on public.reviews to authenticated;
grant select, insert, update on public.study_cycles, public.daily_activity to authenticated;
grant select, insert, update, delete on public.albums, public.album_items to authenticated;
-- Sổ xu và số liệu AI: chỉ đọc. Ghi là độc quyền của hàm security definer.
grant select on public.coin_ledger, public.ai_usage to authenticated;
grant update on public.app_config to authenticated;

alter table public.topics        enable row level security;
alter table public.terms         enable row level security;
alter table public.app_config    enable row level security;
alter table public.profiles      enable row level security;
alter table public.study_cycles enable row level security;
alter table public.user_words   enable row level security;
alter table public.reviews      enable row level security;
alter table public.daily_activity enable row level security;
alter table public.albums       enable row level security;
alter table public.album_items  enable row level security;
alter table public.coin_ledger  enable row level security;
alter table public.ai_usage     enable row level security;

-- Từ điển: mọi người dùng active đọc được, chỉ admin sửa.
drop policy if exists topics_read on public.topics;
create policy topics_read on public.topics
  for select to authenticated
  using (public.is_active_user());

drop policy if exists topics_admin_write on public.topics;
create policy topics_admin_write on public.topics
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists terms_read on public.terms;
create policy terms_read on public.terms
  for select to authenticated
  using (public.is_active_user());

-- Người dùng thường vẫn cần tạo từ mới từ danh sách Groq, nên cho insert;
-- sửa nội dung từ điển thì chỉ admin.
drop policy if exists terms_insert on public.terms;
create policy terms_insert on public.terms
  for insert to authenticated
  with check (public.is_active_user());

drop policy if exists terms_admin_write on public.terms;
create policy terms_admin_write on public.terms
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
  for select to authenticated
  using (public.is_active_user());

drop policy if exists app_config_admin_write on public.app_config;
create policy app_config_admin_write on public.app_config
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Profile: đọc của mình; admin đọc tất cả; không ai tự đổi role/status
-- (cột role/status không nằm trong grant update ở trên).
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid() and status = 'active')
  with check (user_id = auth.uid());

-- Các bảng tiến trình: chỉ chủ sở hữu.
drop policy if exists user_words_own on public.user_words;
create policy user_words_own on public.user_words
  for all to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists reviews_read_own on public.reviews;
create policy reviews_read_own on public.reviews
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists study_cycles_own on public.study_cycles;
create policy study_cycles_own on public.study_cycles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists daily_activity_own on public.daily_activity;
create policy daily_activity_own on public.daily_activity
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists albums_own on public.albums;
create policy albums_own on public.albums
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- album_items không có user_id: quyền suy từ album cha.
drop policy if exists album_items_own on public.album_items;
create policy album_items_own on public.album_items
  for all to authenticated
  using (exists (
    select 1 from public.albums a
    where a.id = album_items.album_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.albums a
    where a.id = album_items.album_id and a.user_id = auth.uid()
  ));

-- Sổ xu: chỉ đọc của mình. Không có policy ghi => client không thể tự thêm.
drop policy if exists coin_ledger_read_own on public.coin_ledger;
create policy coin_ledger_read_own on public.coin_ledger
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Chỉ hàm security definer mới gọi được các hàm tiền tệ.
revoke all on function public.award_coins(text, integer, text, text, uuid, text) from public, anon;
grant execute on function public.award_coins(text, integer, text, text, uuid, text) to authenticated;
revoke all on function public.admin_adjust_coins(uuid, text, integer, text, text) from public, anon;
grant execute on function public.admin_adjust_coins(uuid, text, integer, text, text) to authenticated;
revoke all on function public.my_coin_balance() from public, anon;
grant execute on function public.my_coin_balance() to authenticated;
