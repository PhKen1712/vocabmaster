-- ---------------------------------------------------------------------------
-- 0007 · Groq dùng chung do quản trị viên cấu hình
--
-- Mục tiêu: thành viên không phải tự tạo API key, nhưng khoá Groq KHÔNG BAO GIỜ
-- đi xuống trình duyệt/điện thoại.
--
-- Cách làm:
--   * `app_config.ai_groq_key` giữ khoá ở server. Quyền SELECT/UPDATE theo CỘT
--     được thu hồi khỏi `authenticated`, nên PostgREST không trả khoá cho bất kỳ
--     ai — kể cả admin đọc bảng trực tiếp.
--   * Edge Function `ai-proxy` đọc khoá bằng service_role (hoặc biến môi trường
--     GROQ_API_KEY nếu đã đặt secret), xác thực JWT của người gọi, kiểm tra
--     tài khoản còn hoạt động, trừ hạn mức rồi mới gọi Groq.
--   * `ai_usage` là nguồn duy nhất đếm lượt gọi/ngày; hàm trừ hạn mức chạy
--     trong một câu UPSERT nên hai request đồng thời không thể cùng lọt qua
--     giới hạn (atomic, không phải read-then-write).
--
-- Đổi khoá chỉ cần lưu lại ở đây — không phải build lại IPA, không phải deploy
-- lại Edge Function.
-- ---------------------------------------------------------------------------

alter table public.app_config
  add column if not exists ai_groq_key text;

-- Thu hồi quyền theo bảng rồi cấp lại theo cột: cột khoá không nằm trong danh
-- sách được cấp, nên không đọc/ghi được qua API công khai.
revoke select, update on public.app_config from authenticated;
grant select (id, ai_enabled, ai_provider, ai_model, ai_daily_limit, ai_max_batch,
              last_error, last_error_at, updated_at)
  on public.app_config to authenticated;
grant update (ai_enabled, ai_provider, ai_model, ai_daily_limit, ai_max_batch)
  on public.app_config to authenticated;

-- ---------------------------------------------------------------------------
-- Hạn mức: chỉ service_role gọi được (Edge Function đã xác thực người dùng)
-- ---------------------------------------------------------------------------

create or replace function public.ai_take_quota(p_user_id uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 0), 0);
  v_calls integer;
begin
  if p_user_id is null then
    raise exception 'thiếu user id' using errcode = '22023';
  end if;

  -- 0 = không giới hạn (quản trị viên chủ động chọn).
  if v_limit = 0 then
    insert into public.ai_usage as u (user_id, day, calls)
    values (p_user_id, current_date, 1)
    on conflict (user_id, day) do update
      set calls = u.calls + 1, updated_at = now()
    returning calls into v_calls;
    return jsonb_build_object('allowed', true, 'calls', v_calls, 'limit', 0);
  end if;

  insert into public.ai_usage as u (user_id, day, calls)
  values (p_user_id, current_date, 1)
  on conflict (user_id, day) do update
    set calls = u.calls + 1, updated_at = now()
    where u.calls < v_limit
  returning calls into v_calls;

  if v_calls is null then
    select calls into v_calls
    from public.ai_usage
    where user_id = p_user_id and day = current_date;
    return jsonb_build_object(
      'allowed', false,
      'calls', coalesce(v_calls, 0),
      'limit', v_limit
    );
  end if;

  return jsonb_build_object('allowed', true, 'calls', v_calls, 'limit', v_limit);
end;
$$;

create or replace function public.ai_record_error(p_user_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := left(coalesce(p_message, ''), 500);
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.ai_usage as u (user_id, day, errors, last_error, last_error_at)
  values (p_user_id, current_date, 1, v_message, now())
  on conflict (user_id, day) do update
    set errors = u.errors + 1,
        last_error = excluded.last_error,
        last_error_at = now(),
        updated_at = now();

  update public.app_config
  set last_error = v_message, last_error_at = now()
  where id = 1;
end;
$$;

revoke all on function public.ai_take_quota(uuid, integer) from public, anon, authenticated;
revoke all on function public.ai_record_error(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_take_quota(uuid, integer) to service_role;
grant execute on function public.ai_record_error(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Quản trị: đặt / xoá / kiểm tra khoá Groq (không bao giờ trả khoá)
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_groq_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
begin
  if not public.is_admin() then
    raise exception 'chỉ quản trị viên được đổi khoá AI' using errcode = '42501';
  end if;

  if v_key <> '' and v_key !~ '^gsk_' then
    raise exception 'khoá Groq phải bắt đầu bằng gsk_' using errcode = '22023';
  end if;
  if v_key <> '' and char_length(v_key) < 20 then
    raise exception 'khoá Groq quá ngắn' using errcode = '22023';
  end if;

  update public.app_config
  set ai_groq_key = nullif(v_key, '')
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'configured', v_key <> '',
    'masked', case
      when v_key = '' then null
      else left(v_key, 6) || '…' || right(v_key, 4)
    end
  );
end;
$$;

create or replace function public.admin_groq_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'chỉ quản trị viên' using errcode = '42501';
  end if;

  select ai_groq_key into v_key from public.app_config where id = 1;

  return jsonb_build_object(
    'configured', coalesce(v_key, '') <> '',
    'masked', case
      when coalesce(v_key, '') = '' then null
      else left(v_key, 6) || '…' || right(v_key, 4)
    end
  );
end;
$$;

revoke all on function public.admin_set_groq_key(text) from public, anon;
revoke all on function public.admin_groq_key_status() from public, anon;
grant execute on function public.admin_set_groq_key(text) to authenticated;
grant execute on function public.admin_groq_key_status() to authenticated;
