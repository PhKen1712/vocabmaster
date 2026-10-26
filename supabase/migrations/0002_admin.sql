-- ===========================================================================
-- VocabMaster — hàm đọc dữ liệu cho admin panel (v2)
--
-- Vì sao không để panel tự ghép nhiều bảng:
--   1. Policy của `user_words`/`albums` chỉ cho chủ sở hữu; admin đọc thẳng sẽ
--      thấy rỗng và dashboard hiện số 0 sai.
--   2. Một tài khoản cần 5 con số (số từ, đến hạn, số xu, lượt ôn, lần cuối);
--      ghép phía client là 5 request cho mỗi dòng.
--
-- Mọi hàm ở đây đều `security definer` + tự kiểm `is_admin()` bên trong, nên
-- quyền không phụ thuộc vào việc client có ẩn nút hay không.
-- ===========================================================================

create or replace function public.admin_stats()
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
    'accounts',        (select count(*) from public.profiles),
    'active',          (select count(*) from public.profiles where status = 'active'),
    'locked',          (select count(*) from public.profiles where status = 'locked'),
    'admins',          (select count(*) from public.profiles where role = 'admin'),
    'terms',           (select count(*) from public.terms),
    'user_words',      (select count(*) from public.user_words where deleted_at is null),
    'reviews_today',   (select count(*) from public.reviews where created_at >= date_trunc('day', now())),
    'reviews_7d',      (select count(*) from public.reviews where created_at >= now() - interval '7 days'),
    'due_today',       (select count(*) from public.user_words
                         where deleted_at is null and due_at is not null and due_at <= now()),
    'coins_out',       (select coalesce(sum(amount), 0) from public.coin_ledger),
    'ai_calls_today',  (select coalesce(sum(calls), 0) from public.ai_usage where day = current_date),
    'ai_errors_today', (select coalesce(sum(errors), 0) from public.ai_usage where day = current_date),
    'last_ai_error',   (select last_error from public.ai_usage
                         where last_error is not null order by last_error_at desc nulls last limit 1),
    'last_ai_error_at',(select last_error_at from public.ai_usage
                         where last_error is not null order by last_error_at desc nulls last limit 1)
  ) into result;

  return result;
end;
$$;

/**
 * Danh sách tài khoản kèm số liệu học tập, tìm theo username hoặc user_id.
 * Trả về từng dòng; panel tự phân trang bằng p_limit/p_offset.
 */
create or replace function public.admin_accounts(
  p_search text default null,
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  user_id       uuid,
  username      text,
  role          text,
  status        text,
  created_at    timestamptz,
  word_count    bigint,
  due_count     bigint,
  review_count  bigint,
  coin_balance  bigint,
  last_review_at timestamptz,
  total_count   bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;

  return query
  with matched as (
    select p.user_id, p.username, p.role, p.status, p.created_at
    from public.profiles p
    where term is null
       or p.normalized_username like '%' || public.normalize_term(term) || '%'
       -- Cho phép dán nguyên UUID để tra cứu một tài khoản cụ thể.
       or p.user_id::text = term
  )
  select
    m.user_id,
    m.username,
    m.role,
    m.status,
    m.created_at,
    coalesce(w.word_count, 0),
    coalesce(w.due_count, 0),
    coalesce(r.review_count, 0),
    coalesce(c.coin_balance, 0),
    r.last_review_at,
    count(*) over () as total_count
  from matched m
  left join lateral (
    select count(*) as word_count,
           count(*) filter (where uw.due_at is not null and uw.due_at <= now()) as due_count
    from public.user_words uw
    where uw.user_id = m.user_id and uw.deleted_at is null
  ) w on true
  left join lateral (
    select count(*) as review_count, max(rv.created_at) as last_review_at
    from public.reviews rv
    where rv.user_id = m.user_id
  ) r on true
  left join lateral (
    select coalesce(sum(cl.amount), 0) as coin_balance
    from public.coin_ledger cl
    where cl.user_id = m.user_id
  ) c on true
  order by m.created_at desc
  limit greatest(least(coalesce(p_limit, 25), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Số dư của một người, cho admin (my_coin_balance chỉ trả của chính mình).
create or replace function public.admin_coin_balance(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'chỉ admin' using errcode = '42501';
  end if;
  return coalesce((select sum(amount) from public.coin_ledger where user_id = p_user_id), 0)::integer;
end;
$$;

revoke all on function public.admin_stats() from public, anon;
revoke all on function public.admin_accounts(text, integer, integer) from public, anon;
revoke all on function public.admin_coin_balance(uuid) from public, anon;

grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_accounts(text, integer, integer) to authenticated;
grant execute on function public.admin_coin_balance(uuid) to authenticated;
