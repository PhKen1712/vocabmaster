import { supabase } from './supabase';

export interface Stats {
  accounts: number;
  active: number;
  locked: number;
  admins: number;
  terms: number;
  user_words: number;
  reviews_today: number;
  reviews_7d: number;
  due_today: number;
  coins_out: number;
  ai_calls_today: number;
  ai_errors_today: number;
  last_ai_error: string | null;
  last_ai_error_at: string | null;
}

export interface AccountRow {
  user_id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'locked';
  created_at: string;
  word_count: number;
  due_count: number;
  review_count: number;
  coin_balance: number;
  last_review_at: string | null;
  total_count: number;
}

export interface CoinRow {
  id: string;
  user_id: string;
  kind: 'reward' | 'penalty' | 'reset' | 'admin';
  amount: number;
  balance_after: number;
  reason: string | null;
  source_id: string;
  created_at: string;
  term_id: string | null;
}

export interface AiConfig {
  ai_enabled: boolean;
  ai_provider: 'groq' | 'gemini';
  ai_model: string;
  ai_daily_limit: number;
  ai_max_batch: number;
  last_error: string | null;
  last_error_at: string | null;
  updated_at: string;
}

/** PostgREST trả lỗi dạng object; đổi thành câu đọc được cho người dùng. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Lỗi không xác định';
  if (typeof error === 'string') return error;
  const candidate = error as { message?: string; details?: string; hint?: string; code?: string };
  const base = candidate.message ?? candidate.details ?? 'Lỗi không xác định';
  if (candidate.code === '42501') return `Không đủ quyền: ${base}`;
  if (candidate.code === 'PGRST301' || candidate.code === '401') return 'Phiên đã hết hạn, hãy đăng nhập lại.';
  return base;
}

export async function loadStats(): Promise<Stats> {
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw new Error(errorMessage(error));
  return data as Stats;
}

export async function loadAccounts(search: string, page: number, pageSize = 25): Promise<AccountRow[]> {
  const { data, error } = await supabase.rpc('admin_accounts', {
    p_search: search.trim() || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as AccountRow[];
}

export async function loadCoinHistory(userId: string, limit = 40): Promise<CoinRow[]> {
  const { data, error } = await supabase
    .from('coin_ledger')
    .select('id,user_id,kind,amount,balance_after,reason,source_id,created_at,term_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as CoinRow[];
}

export async function adjustCoins(input: {
  userId: string;
  amount: number;
  reason: string;
  /** Sinh MỘT lần khi người dùng bắt đầu thao tác và dùng lại khi gửi lại: */
  sourceId: string;
}): Promise<CoinRow> {
  const { data, error } = await supabase.rpc('admin_adjust_coins', {
    p_user_id: input.userId,
    p_kind: 'admin',
    p_amount: input.amount,
    p_reason: input.reason.trim(),
    p_source_id: input.sourceId,
  });
  if (error) throw new Error(errorMessage(error));
  return data as CoinRow;
}

export async function loadAiConfig(): Promise<AiConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('ai_enabled,ai_provider,ai_model,ai_daily_limit,ai_max_batch,last_error,last_error_at,updated_at')
    .eq('id', 1)
    .single();
  if (error) throw new Error(errorMessage(error));
  return data as AiConfig;
}

export async function saveAiConfig(patch: Partial<AiConfig>): Promise<void> {
  const { error } = await supabase.from('app_config').update(patch).eq('id', 1);
  if (error) throw new Error(errorMessage(error));
}

export interface AiUsageRow {
  user_id: string;
  day: string;
  calls: number;
  errors: number;
  last_error: string | null;
  last_error_at: string | null;
}

export async function loadAiUsage(limit = 20): Promise<AiUsageRow[]> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('user_id,day,calls,errors,last_error,last_error_at')
    .order('day', { ascending: false })
    .limit(limit);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as AiUsageRow[];
}

// ---------------------------------------------------------------------------
// Chi tiết người dùng
// ---------------------------------------------------------------------------

export interface UserDetail {
  user_id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'locked';
  created_at: string;
  settings: Record<string, unknown>;
  words: number;
  due: number;
  learning: number;
  mastered: number;
  untouched: number;
  reviews_total: number;
  reviews_today: number;
  reviews_7d: number;
  accuracy_7d: number | null;
  coins: number;
  streak: number | null;
  last_review_at: string | null;
  forgotten: number;
}

export type WordFilter = 'all' | 'due' | 'forgotten' | 'mastered';

export interface UserWordRow {
  term_id: string;
  term: string;
  level: number;
  learning_state: string;
  due_at: string | null;
  reps: number;
  correct_count: number;
  wrong_count: number;
  hint_count: number;
  memory_rating: string | null;
  last_wrong_at: string | null;
  last_correct_at: string | null;
  total_count: number;
}

export interface ActivityRow {
  day: string;
  reviews: number;
  answered: number;
  correct: number;
  new_words: number;
}

export async function loadUserDetail(userId: string): Promise<UserDetail> {
  const { data, error } = await supabase.rpc('admin_user_detail', { p_user_id: userId });
  if (error) throw new Error(errorMessage(error));
  return data as UserDetail;
}

export async function loadUserWords(
  userId: string,
  filter: WordFilter,
  page: number,
  pageSize = 50,
): Promise<UserWordRow[]> {
  const { data, error } = await supabase.rpc('admin_user_words', {
    p_user_id: userId,
    p_filter: filter,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as UserWordRow[];
}

export async function loadUserActivity(userId: string, days = 30): Promise<ActivityRow[]> {
  const { data, error } = await supabase.rpc('admin_user_activity', { p_user_id: userId, p_days: days });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as ActivityRow[];
}

// ---------------------------------------------------------------------------
// Từ điển dùng chung
// ---------------------------------------------------------------------------

export interface TermRow {
  id: string;
  term: string;
  meaning_vi: string | null;
  definition_en: string | null;
  ipa: string | null;
  part_of_speech: string | null;
  example_en: string | null;
  example_vi: string | null;
  level: number;
  level_source: string;
  topic: string | null;
  learners: number;
  due_now: number;
  updated_at: string;
  total_count: number;
}

export type TermSort = 'learners' | 'newest' | 'level' | 'az';

export async function loadTerms(input: {
  search: string;
  level: number | null;
  sort: TermSort;
  page: number;
  pageSize?: number;
}): Promise<TermRow[]> {
  const { data, error } = await supabase.rpc('admin_terms', {
    p_search: input.search.trim() || null,
    p_level: input.level,
    p_sort: input.sort,
    p_limit: input.pageSize ?? 25,
    p_offset: input.page * (input.pageSize ?? 25),
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as TermRow[];
}

/** Sửa nội dung dùng chung. RLS chỉ cho admin ghi vào `terms`. */
export async function updateTerm(
  id: string,
  patch: Partial<Pick<TermRow, 'meaning_vi' | 'definition_en' | 'ipa' | 'part_of_speech' | 'example_en' | 'example_vi' | 'level'>>,
): Promise<void> {
  const { error } = await supabase.from('terms').update(patch).eq('id', id);
  if (error) throw new Error(errorMessage(error));
}

export interface MergeResult {
  kept: string;
  removed: string;
  words_moved: number;
  duplicates_removed: number;
  album_rows: number;
  reviews: number;
}

export async function mergeTerms(keepId: string, dropId: string): Promise<MergeResult> {
  const { data, error } = await supabase.rpc('admin_merge_terms', { p_keep: keepId, p_drop: dropId });
  if (error) throw new Error(errorMessage(error));
  return data as MergeResult;
}

/** Gọi Edge Function; trả lỗi rõ ràng nếu chưa deploy. */
export async function callAdminUsers<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: payload });
  if (error) {
    const detail = (data as { error?: string } | null)?.error;
    const status = (error as { context?: { status?: number } }).context?.status;
    const message = String(error.message);
    const notDeployed = status === 404 || message.includes('Failed to send') || /non-2xx/.test(message);
    throw new Error(
      detail ??
        (notDeployed
          ? 'Chưa deploy Edge Function "admin-users" (hoặc function đang lỗi). Xem docs/CLOUD_BACKEND.md mục 14 — tạo/khoá tài khoản cần hàm này vì service-role key không được nằm trong trình duyệt.'
          : errorMessage(error)),
    );
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
}
