-- ---------------------------------------------------------------------------
-- 0006 · Quản trị viên xem và điều chỉnh chuỗi ngày học (streak)
--
-- Vì sao cần bảng riêng thay vì sửa thẳng `daily_activity`:
--
-- * `daily_activity` là số liệu THẬT của người học, mỗi dòng là một ngày có
--   hoạt động. Ghi đè nó để "sửa streak" sẽ làm sai lịch sử học và mọi thống kê
--   khác (số từ mới, độ chính xác, biểu đồ 30 ngày).
-- * Một lần điều chỉnh cần lưu ai làm, lúc nào, lý do gì, giá trị trước/sau.
--   Không có chỗ lưu thì không thể kiểm toán hay hoàn tác.
--
-- Cách hoạt động:
--   admin_set_streak() ghi một dòng vào `streak_grants`. App đọc dòng mới nhất
--   của chính mình qua `my_streak_baseline()` và dùng nó làm mốc: streak hiển
--   thị = số ngày được đặt + các ngày hoàn thành mục tiêu sau mốc đó. Nhờ vậy
--   điều chỉnh có tác dụng thật trên mọi thiết bị, và vẫn tự nhiên tiếp tục
--   tăng khi người học hoàn thành mục tiêu ngày hôm sau.
--
-- Không cộng xu và không nhân hệ số xu: đây là thao tác hỗ trợ, không phải phần
-- thưởng kiếm được.
-- ---------------------------------------------------------------------------

create table if not exists public.streak_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  days        integer not null check (days >= 0 and days <= 3650),
  reason      text not null check (char_length(btrim(reason)) >= 3),
  granted_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists streak_grants_user_idx
  on public.streak_grants (user_id, created_at desc);

alter table public.streak_grants enable row level security;

grant select on public.streak_grants to authenticated;
grant all on public.streak_grants to service_role;

-- Người học chỉ thấy lịch sử điều chỉnh của chính mình; quản trị viên thấy tất
-- cả để tra cứu. Không có policy insert/update/delete: chỉ hàm bên dưới ghi.
drop policy if exists streak_grants_read on public.streak_grants;
create policy streak_grants_read on public.streak_grants
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Mốc streak mới nhất của chính người đang đăng nhập (app gọi khi đồng bộ)
-- ---------------------------------------------------------------------------

create or replace function public.my_streak_baseline()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.streak_grants;
begin
  if v_user is null then
    return jsonb_build_object('date', null, 'days', 0, 'grantId', null);
  end if;

  select * into v_row
  from public.streak_grants
  where user_id = v_user
  order by created_at desc
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('date', null, 'days', 0, 'grantId', null);
  end if;

  return jsonb_build_object(
    'date', (v_row.created_at at time zone 'UTC')::date,
    'days', v_row.days,
    'grantId', v_row.id,
    'grantedAt', v_row.created_at,
    'reason', v_row.reason
  );
end;
$$;

revoke all on function public.my_streak_baseline() from public;
grant execute on function public.my_streak_baseline() to authenticated;

-- ---------------------------------------------------------------------------
-- Quản trị: đọc tình trạng streak
-- ---------------------------------------------------------------------------

create or replace function public.admin_streak_info(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_day      date;
  v_last_streak   integer := 0;
  v_longest       integer := 0;
  v_today         date := (now() at time zone 'UTC')::date;
  v_current       integer := 0;
  v_days          jsonb := '[]'::jsonb;
  v_grants        jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'chỉ quản trị viên được xem streak' using errcode = '42501';
  end if;

  select max(day), max(streak)
    into v_last_day, v_longest
  from public.daily_activity
  where user_id = p_user_id;

  if v_last_day is not null then
    select streak into v_last_streak
    from public.daily_activity
    where user_id = p_user_id and day = v_last_day;

    -- Streak đã đứt nếu ngày hoạt động cuối cùng cũ hơn hôm qua.
    if v_last_day >= v_today - 1 then
      v_current := coalesce(v_last_streak, 0);
    else
      v_current := 0;
    end if;
  end if;

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
             'streak', streak
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
    'current', v_current,
    'longest', coalesce(v_longest, 0),
    'lastStreak', coalesce(v_last_streak, 0),
    'lastDay', v_last_day,
    'today', v_today,
    'days', v_days,
    'grants', v_grants
  );
end;
$$;

revoke all on function public.admin_streak_info(uuid) from public;
grant execute on function public.admin_streak_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Quản trị: đặt streak và ghi nhật ký
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_streak(
  p_user_id uuid,
  p_days    integer,
  p_reason  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_days   integer := greatest(0, least(coalesce(p_days, 0), 3650));
  v_grant  public.streak_grants;
begin
  if not public.is_admin() then
    raise exception 'chỉ quản trị viên được điều chỉnh streak' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'chưa đăng nhập' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'cần nêu lý do (ít nhất 3 ký tự) để lưu nhật ký' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'không tìm thấy tài khoản' using errcode = 'P0002';
  end if;

  insert into public.streak_grants (user_id, days, reason, granted_by)
  values (p_user_id, v_days, v_reason, v_admin)
  returning * into v_grant;

  return jsonb_build_object(
    'ok', true,
    'grant', jsonb_build_object(
      'id', v_grant.id,
      'days', v_grant.days,
      'reason', v_grant.reason,
      'createdAt', v_grant.created_at
    )
  );
end;
$$;

revoke all on function public.admin_set_streak(uuid, integer, text) from public;
grant execute on function public.admin_set_streak(uuid, integer, text) to authenticated;

-- Quản trị viên đọc được lịch sử điều chỉnh của từng người qua policy ở trên.
-- Người học chỉ đọc dòng của mình và chỉ qua my_streak_baseline().
