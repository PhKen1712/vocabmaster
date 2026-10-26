# Tài khoản, dữ liệu trực tuyến và web admin — thiết kế

> **Trạng thái (cập nhật 2026-10-27): backend đã dựng và đã kiểm chứng trên project thật.**
> Project Supabase `iuplquhrbzmfdmcdfeox` (Free, Singapore) đã có schema + RLS + hàm xu
> (`supabase/migrations/0001_init.sql`). `npm run verify:cloud` đạt **20/20** với hai tài khoản thật.
> **Chưa** làm: Edge Function proxy Groq, đồng bộ trong app, web admin panel, bản web.
> Xem mục 2.2 (sự thật đã kiểm chứng), 11 (tiến độ) và 13 (còn phải kiểm).

---

## 1. Hiện trạng ứng dụng (kết quả khảo sát)

| Hạng mục | Hiện tại |
|---|---|
| Nền tảng | Expo SDK 58 · React Native 0.88 · React 19.3 · TypeScript. **Chỉ iOS** (`app.json`, `expo prebuild`). |
| Lưu trữ | `expo-sqlite`, một file trên máy, schema phiên bản 5 với migration tăng dần. |
| Bảng | `words`, `reviews`, `word_study_history`, `album_words`, `coin_ledger`, `daily_activity`, `streak_restores`, `app_settings`, `ai_cache`. |
| Trạng thái | `AppProvider` + hook, có `notifyDataChanged()` / `dataVersion` để làm mới màn hình. |
| AI | Groq là nguồn chính (khoá trong `expo-secure-store`), Gemini là lựa chọn thay thế; có cache trên máy. |
| Tính năng | Ngân hàng từ, 4 mức ôn tập tùy chỉnh, reset an toàn, xu + streak, Album + thông báo ngẫu nhiên, TTS/Speaking, 5 mini-game, hiệu ứng âm thanh, widget. |
| Máy chủ | **Không có.** Không tài khoản, không đồng bộ, khoá AI nằm trên từng thiết bị. |

Hệ quả: yêu cầu "tài khoản do admin tạo", "dữ liệu online", "dùng chung iPhone + máy tính",
"admin panel" đều cần một backend mới. Phần còn lại (chu kỳ Album tùy biến, khung nhập nhiều
dòng) **không** cần backend và đã làm xong trong bản này.

## 2. Chọn backend

**Chọn: Supabase (Postgres quản lý + Auth + Row Level Security).**

Lý do chính: dữ liệu học tập là quan hệ (từ ↔ tiến trình ↔ lượt ôn ↔ giao dịch xu) và cần
truy vấn/thống kê; RLS cho phép tách dữ liệu từng người ngay trong database; có hướng dẫn
chính thức để dùng từ Expo/React Native; xuất dữ liệu bằng `pg_dump` khi muốn rời đi.

Đã cân nhắc và loại:

- **Firebase**: dữ liệu dạng document, không phù hợp với các truy vấn tiến trình/xu; Cloud
  Storage cho project mới cần gói Blaze; muốn chặn đăng ký công khai phải lên Identity
  Platform. Không có đường di chuyển mật khẩu ra ngoài.
- **Neon**: Postgres miễn phí không cần thẻ, nhưng tài liệu admin plugin yêu cầu phiên cookie
  và không có trang hướng dẫn tích hợp Expo/React Native.
- **Tự dựng máy chủ**: người dùng đã nêu rõ không muốn tự vận hành máy chủ.

### 2.1 Giới hạn và điều kiện miễn phí (đã kiểm chứng, kèm nguồn)

| Điểm | Thực tế | Nguồn |
|---|---|---|
| Gói Free Supabase | 500 MB database, 1 GB file storage, 5 GB egress + 5 GB cached egress, không giới hạn request API, 50.000 MAU; tối đa 2 project free cùng lúc. | [Pricing](https://supabase.com/pricing) |
| Vượt hạn mức | Không tự động tính tiền mà có thể bị **hạn chế dịch vụ**: tạm dừng project, database chỉ đọc, hoặc API trả 402. | [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) |
| Project free bị **tạm dừng sau khoảng 1 tuần ít hoạt động** | Có; mở lại trong Dashboard. Ngưỡng cụ thể không được tài liệu nêu rõ. | [Production checklist](https://supabase.com/docs/guides/platform/going-into-prod) |
| Có cần thẻ để bắt đầu? | **Tài liệu không nói rõ.** Phải xác nhận khi tạo project. | [Pricing](https://supabase.com/pricing) |
| `auth.admin.createUser` (tạo tài khoản từ phía máy chủ) | Có, chỉ chạy phía server, nhận email + mật khẩu. `updateUserById` đổi mật khẩu. | [Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) |
| Tắt đăng ký công khai | Có tuỳ chọn chỉ cho người dùng đã tồn tại đăng nhập. **Chưa có tài liệu xác nhận `createUser` vẫn dùng được khi đã tắt đăng ký** — đây là điểm phải test đầu tiên. | [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration) |
| Tên đăng nhập | Đăng nhập mật khẩu dùng **email hoặc số điện thoại**, không có username. Muốn username thì phải ánh xạ sang email nội bộ. | [signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) |
| RLS | Chạy trong database, dùng `auth.uid()`; áp dụng phía server cho client dùng publishable key. Khoá service-role **bỏ qua RLS**, chỉ được ở server. | [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [API keys](https://supabase.com/docs/guides/getting-started/api-keys) |
| React Native / Expo | Có hướng dẫn chính thức dùng `@supabase/supabase-js` trong Expo. | [Expo + Supabase](https://docs.expo.dev/guides/using-supabase/) |
| Sao lưu | Gói Free **không tải được** bản sao lưu quản lý sẵn. Xuất dữ liệu bằng CLI `pg_dump`/`psql`; Storage tách riêng. | [Backup & restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) |
| Email mặc định | Chất lượng best-effort, giới hạn ~2 email/giờ → không dựa vào email để cấp lại mật khẩu. | [Production checklist](https://supabase.com/docs/guides/platform/going-into-prod) |

### 2.2 Sự thật đã kiểm chứng trên project thật (2026-10-27)

Bốn điều dưới đây chỉ biết được khi chạy thật, tài liệu Supabase không nói:

1. **`apikey` không được là JWT người dùng.** Với khoá kiểu mới `sb_publishable_…`, mọi request gửi
   JWT vào header `apikey` bị trả **401** dù đăng nhập thành công. Đúng: `apikey` = khoá dự án,
   `Authorization: Bearer <jwt>` = phiên người dùng.
2. **Default privileges cấp `ALL` cho `authenticated` trên bảng mới.** Vì vậy `grant update (cột)` là
   **cộng thêm** quyền, không giới hạn: lần đầu, người dùng `PATCH profiles.role='admin'` **thành công**.
   Mọi migration phải `revoke all ... from authenticated` **trước** rồi mới `grant`.
3. **`auth.admin.createUser` chạy được** khi đăng ký công khai **đang bật** (`disable_signup=false`).
   Trường hợp đã tắt đăng ký **chưa kiểm** — xem mục 13.
4. **`GET /rest/v1/` (endpoint gốc) trả 401 cho cả khoá thật lẫn khoá giả** — đặc thù đường dẫn, không
   phải lỗi khoá. Muốn kiểm khoá thì dùng một đường dẫn bảng: khoá thật → 404, khoá sai → 401.

Hai lỗi trên đều do `npm run verify:cloud` bắt được, không phải do đọc code.

## 3. Mô hình dữ liệu

Nguyên tắc: **từ điển dùng chung, tiến trình riêng theo người dùng.** Hai người học cùng một
từ thì không tạo hai bản ghi từ điển.

### 3.1 Bảng dùng chung

- `terms`: `id`, `term`, `normalized` (unique), `ipa`, `part_of_speech`, `meaning_vi`,
  `definition_en`, `example_en`, `example_vi`, `synonyms`, `antonyms`, `collocations`,
  `word_family`, `level` (0–6), `level_source` ('ai' | 'pack' | 'settings'), `topic_id`,
  `source`, `ai_generated`, `created_at`, `updated_at`.
- `topics`: `id`, `name`, `normalized` (unique — trim, gộp khoảng trắng, **lower**).
- `app_config`: một dòng: model Groq đang dùng, bật/tắt tính năng AI, hạn mức mỗi người,
  thời điểm lỗi gần nhất. **Không lưu API key ở đây.**

### 3.2 Bảng theo người dùng

- `profiles`: `user_id` (FK auth.users), `username`, `role` ('admin' | 'user'),
  `status` ('active' | 'locked'), `created_at`, `settings` (jsonb).
- `user_words`: `user_id`, `term_id`, `learning_state`, `due_at`, `stability`, `difficulty`,
  `reps`, `lapses`, `correct_count`, `wrong_count`, `hint_count`, `last_correct_at`,
  `last_wrong_at`, `memory_rating`, `is_favorite`, `added_at`, `updated_at`, `deleted_at`.
  Khoá chính `(user_id, term_id)`.
- `reviews`: `id` (UUID do máy khách tạo), `user_id`, `term_id`, `rating`, `correct`, `mode`,
  `cycle_id`, `created_at`. **Chỉ ghi thêm, không sửa** — đây là nguồn sự thật cho thống kê.
- `study_cycles`: `id`, `user_id`, `started_at`, `reason`. `studyCycleId` trên máy ánh xạ vào đây.
- `albums`: `id`, `user_id`, `name`, `notify_enabled`, `interval_minutes`, `start_hour`,
  `end_hour`, `created_at`, `updated_at`.
- `album_items`: `album_id`, `term_id`, `added_at`, `deleted_at`, `last_notified_at`,
  `notify_count`. Khoá chính `(album_id, term_id)`.
- `coin_ledger`: `id`, `user_id`, `kind`, `amount`, `balance_after`, `reason`, `source_id`,
  `cycle_id`, `term_id`, `created_at`. **`source_id` UNIQUE** là cơ chế chống cộng trùng.
- `daily_activity`: `user_id`, `day`, `new_words`, `reviews`, `answered`, `correct`.
- `ai_usage`: `user_id`, `day`, `calls`, `errors`, `last_error`, `last_error_at`.

### 3.3 Quy ước xu

Số dư **không** phải một cột mà máy khách được sửa. Máy khách gửi một sự kiện
(`term_id`, `cycle_id`, `source_id`, `reason`) tới hàm `award_coins()`; hàm này chèn vào
`coin_ledger`, nếu `source_id` đã tồn tại thì trả về dòng cũ (idempotent), rồi tính
`balance_after` trong cùng một transaction. Admin cộng/trừ cũng đi qua hàm này với
`reason` bắt buộc.

### 3.4 RLS (bản nháp, **chưa chạy**)

```sql
-- Bản nháp để chốt thiết kế. KHÔNG coi là đã kiểm thử: phải chạy thật và kiểm bằng
-- hai tài khoản khác nhau trước khi tin.
alter table user_words enable row level security;

create policy "own rows" on user_words
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Từ điển: mọi người dùng đã đăng nhập đọc được, chỉ admin được sửa.
create policy "read terms" on terms for select to authenticated using (true);
create policy "admin writes terms" on terms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

`profiles.role` **không** suy ra từ dữ liệu người dùng gửi: chỉ service-role (Edge Function
đã xác thực admin) được đặt `role = 'admin'`.

## 4. Quy tắc đồng bộ

| Loại dữ liệu | Chiều | Quy tắc xử lý xung đột | Vì sao |
|---|---|---|---|
| Từ điển (`terms`, `topics`) | hai chiều | Upsert theo `normalized`; nội dung theo `updated_at` mới nhất thắng; sửa nội dung là quyền admin | Tránh nhân bản từ điển; sửa nghĩa không được ghi đè lẫn nhau |
| Tiến trình (`user_words`) | hai chiều | Hợp nhất **từng trường** theo `updated_at`; các bộ đếm được tính lại từ `reviews` | Hai thiết bị cùng học không làm mất một lần trả lời |
| `reviews` | một chiều lên | Ghi thêm, `id` do máy khách sinh → `ON CONFLICT DO NOTHING` | Idempotent, không nhân đôi khi gửi lại |
| Xu (`coin_ledger`) | một chiều lên | Server là nguồn sự thật; `source_id` UNIQUE; transaction | Đúng yêu cầu "giao dịch xu idempotent, không để client sửa số dư" |
| Cài đặt | hai chiều | Last-write-wins theo khoá | Người dùng chỉ sửa một nơi một lúc |
| Album (thành viên) | hai chiều | Thêm = hợp tập; xoá = tombstone `deleted_at` | Máy khách offline lâu không được "hồi sinh" từ đã xoá |
| Chu kỳ thông báo | hai chiều | LWW trên `albums` | Là cấu hình, không phải sự kiện |
| `last_notified_at` / `notify_count` | **chỉ trên thiết bị** | Không đồng bộ | Lịch thông báo là chuyện của từng máy; đồng bộ sẽ làm lệch hàng đợi |

Cơ chế: `expo-sqlite` vẫn là bản làm việc ngoại tuyến. Mọi thay đổi được ghi thêm vào bảng
`outbox` (op, payload, idempotency key, created_at, attempts). Khi có mạng, hàng đợi được
đẩy lên theo thứ tự, sau đó kéo thay đổi mới hơn `last_synced_at`. **Không xoá dữ liệu trên
máy trước khi server xác nhận**, và một thay đổi đang chờ không bị ghi đè im lặng.

## 5. Xác thực, phân quyền, bảo mật

- **Chỉ admin tạo tài khoản**: Admin API + service-role trong Edge Function; tắt đăng ký công
  khai. Nếu tên đăng nhập được yêu cầu, ánh xạ `username` → email nội bộ (điểm cần kiểm chứng).
- **Khoá tài khoản**: `status = 'locked'` **và** thu hồi phiên (global sign-out); RLS yêu cầu
  profile đang active cho các thao tác ghi → chặn ở server, không chỉ ẩn nút.
- **Khoá Groq**: nằm trong secret của Edge Function, không bao giờ trong database hay app.
  App gọi `/functions/v1/ai` bằng JWT người dùng; hàm kiểm tra hạn mức/ngày, kích thước
  request, danh sách model cho phép, ghi `ai_usage`, và không trả khoá về. Khoá trong
  `expo-secure-store` vẫn giữ cho chế độ không tài khoản.
- **Không log bí mật**, không đưa khoá vào repository, không ghi mật khẩu dạng thô.
- **Sao lưu**: xuất định kỳ bằng `pg_dump` (tài liệu Free cho biết không có bản sao lưu tải
  được), cộng với bản sao SQLite trên máy người dùng.

## 6. Web admin panel

> **Đã dựng và chạy thật (27/10/2026)** trong thư mục [`admin/`](../admin) (React + Vite + TypeScript).
> `npm run dev` trong `admin/` → `http://localhost:5180`. Đăng nhập bằng tài khoản có `profiles.role = 'admin'`.
>
> **Đã kiểm chứng bằng thao tác thật:** đăng nhập admin; từ chối tài khoản không có hồ sơ/quyền;
> Tổng quan đọc số liệu thật (`admin_stats`); danh sách + tìm kiếm (`admin_accounts`); tạo tài khoản qua
> Edge Function; khoá tài khoản → Auth trả `user_banned` khi đăng nhập; cộng xu có xác nhận + lịch sử
> (`admin_adjust_coins`); sửa cấu hình AI lưu thật vào `app_config`.
>
> **Bổ sung cùng ngày:** trang **chi tiết người dùng** (`admin_user_detail`, `admin_user_words`,
> `admin_user_activity`) với biểu đồ 30 ngày, bộ lọc *đến hạn / hay quên / đã thuộc*; trang **Từ điển**
> (`admin_terms`) sửa nghĩa/IPA/level cho từ dùng chung và **gộp từ trùng** (`admin_merge_terms`).
> Đã thử: sửa nghĩa → lưu thật; gộp bản trùng → 2 lượt ôn được giữ, bản ghi trùng bị bỏ khi người học
> đã có bản của từ giữ lại.
>
> **Chưa có:** deploy panel lên host công khai (cần tài khoản Cloudflare/Vercel); quản lý khoá Groq từ
> panel (khoá thuộc secret của Edge Function, chưa dựng proxy AI); phân quyền chi tiết admin xem/sửa.

- Ứng dụng web riêng trong `admin/` (React + Vite + TypeScript), dùng publishable key + JWT của
  admin; **mọi thao tác đặc quyền đi qua Edge Function kiểm tra lại `is_admin()`**.
- Màn hình: Tổng quan (số tài khoản, hoạt động, lượt gọi AI, lỗi gần nhất) · Tài khoản (danh
  sách, tìm kiếm, tạo, khoá/mở, đặt lại mật khẩu, xem nhanh tiến trình và số xu) · Xu (tra số
  dư, cộng/trừ/đặt, bắt buộc nhập lý do, hộp thoại xác nhận, lịch sử giao dịch có lọc) · AI
  (model, bật/tắt, kiểm tra kết nối qua hàm, hướng dẫn xoay khoá, lỗi và thống kê lượt gọi).
- Trạng thái tải/trống/lỗi rõ ràng; không dùng dữ liệu giả để "trông như đang chạy".
- Triển khai: build tĩnh trên host miễn phí (Cloudflare Pages / Vercel / Netlify).

## 7. Ứng dụng trên máy tính

Kết luận đã kiểm chứng: Expo hỗ trợ **web**, không có nền tảng desktop.

- Web: `npx expo install react-dom react-native-web @expo/metro-runtime`, bật Metro bundler.
  ([Expo web](https://docs.expo.dev/workflow/web.md))
- Desktop: chỉ là vỏ Electron/Tauri quanh bản web, không phải React Native desktop; các module
  native của Expo không tự nhiên chạy được.
  ([Tauri](https://v2.tauri.app/), [Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox))

| Module | Web | Ghi chú / thay thế |
|---|---|---|
| `expo-sqlite` | Được, qua WASM | Cần cấu hình `.wasm` cho Metro và header COOP/COEP; OPFS, không có FTS. ([docs](https://docs.expo.dev/versions/latest/sdk/sqlite.md)) |
| `expo-notifications` | **Không** | Web không lên lịch cục bộ như iOS; cần Notifications API/push. ([docs](https://docs.expo.dev/versions/latest/sdk/notifications.md)) |
| `expo-speech` | Được | Giọng đọc tuỳ trình duyệt. |
| `expo-speech-recognition` | Một phần | Gói bên thứ ba, phụ thuộc trình duyệt, cần feature-detect. |
| `expo-audio` | Được (có khác biệt) | Ghi âm dùng MediaRecorder. |
| `expo-secure-store` | **Không** | Web không có Keychain; dùng phiên HttpOnly phía server. |
| `expo-file-system`, `expo-sharing` | Không / một phần | Dùng File/Blob và luồng tải xuống. |
| `react-native-safe-area-context` | Có cảnh báo | SDK 58 + Expo Router trả inset 0 trên web; dùng CSS `env(safe-area-inset-*)`. |

Phân loại tính năng theo yêu cầu:

1. **Dùng lại ngay**: ngân hàng từ, luyện tập/ôn tập, flashcard, thống kê, Album, xu, Groq.
2. **Cần chỉnh**: bố cục (flex mặc định khác web), thanh tab, bàn phím, kéo thả.
3. **Chỉ iOS**: thông báo cục bộ, widget, haptics, Speaking bằng micro.
4. **Thay thế trên web**: thông báo → nhắc trong trang (hoặc không), lưu khoá → phiên server,
   xuất/nhập file → tải xuống.

Ưu tiên bản web responsive (đúng như yêu cầu "không viết lại toàn bộ"), desktop để sau.

## 8. Chi phí và giới hạn

> Không có dịch vụ nào miễn phí vô hạn. Hiện app chạy được mà không cần server; thêm tài khoản
> sẽ tạo phụ thuộc vào dịch vụ đám mây và có thể bị tạm dừng/hết hạn mức.

| Dịch vụ | Vai trò | Cần thẻ? | Hạn mức miễn phí | Điều có thể làm bạn vướng | Khi nào phát sinh chi phí | Đường rời đi |
|---|---|---|---|---|---|---|
| Supabase Free | DB + Auth + RLS | **Chưa xác nhận được** | 500 MB DB, 1 GB storage, 5 GB egress, 50k MAU, 2 project | Tạm dừng sau ~1 tuần ít dùng; không tải được backup; 2 email/giờ | Nâng Pro khi cần backup/pitr, DB > 500 MB, hay project không được phép tạm dừng | `pg_dump` + `psql`; Edge Functions/Storage phải chuyển riêng |
| Firebase Spark | (đã loại, nêu để so sánh) | Không | 1 GiB, 50k đọc/20k ghi/20k xoá mỗi ngày, 10 GiB egress | Storage mới **cần Blaze**; chặn đăng ký cần Identity Platform | Vượt hạn mức thì sản phẩm bị tắt (không tự tính tiền) | Export qua bucket (cần Blaze); mật khẩu không di chuyển được |
| Neon Free | (đã loại) | Không | 1 GB, 100 giờ compute, 5 GB transfer | Admin plugin cần phiên cookie; không có hướng dẫn Expo | Vượt compute/storage | `pg_dump` (Postgres chuẩn) |
| Cloudflare Pages / Vercel / Netlify | Host admin panel (tĩnh) | Không | Băng thông và build/ngày ở mức dư dùng cho 1 admin | Giới hạn build đồng thời | Hầu như không, với 1 admin | Build tĩnh, chuyển host dễ dàng |
| Groq | Sinh từ vựng/giải nghĩa | Không | Hạn mức theo gói của chủ khoá, tính theo token/phút và theo ngày | TPM thấp → phải chia lô 10 mục (app đã làm) | Nâng bậc trả phí khi vượt | Đổi nhà cung cấp: app đã có Gemini làm lựa chọn thứ hai |

## 9. Biến môi trường (chưa tồn tại — chỉ là tên)

| Tên | Dùng ở đâu | Đặt trong file nào | Có bí mật? |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | App (iOS/web) | `.env` (đã gitignore) | Không |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | App (publishable key) | `.env` (đã gitignore) | Không (vẫn phải có RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Chỉ Edge Function** | `.env.cloud.local` (đã gitignore) → nạp vào secret của backend | Có — không bao giờ vào app/repo |
| `GROQ_API_KEY` | **Chỉ Edge Function** | `.env.cloud.local` (đã gitignore) → nạp vào secret của backend | Có — không bao giờ vào app/repo |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Web admin (`.env` của thư mục `admin/`) | `.env` của admin (đã gitignore) | Không |

Tên biến (không kèm giá trị) đã có sẵn trong [`.env.example`](../.env.example). `.gitignore` đã bỏ qua
`.env`, `.env.*` và `secrets/`, nên `.env.cloud.local` không thể bị commit nhầm.

## 10. Chuyển dữ liệu từ máy lên tài khoản (không mất dữ liệu)

1. Migration v6 (chỉ thêm): `outbox`, `last_synced_at`, `remote_id` cho các bảng liên quan.
2. Lần đăng nhập đầu tiên hiện lựa chọn rõ ràng: *"Nhập dữ liệu trên máy này lên tài khoản"* —
   người dùng chủ động bấm, có thể bỏ qua.
3. Từ khớp vào `terms` theo `normalized`; nếu đã có thì dùng lại bản ghi dùng chung.
4. Lượt ôn cũ đẩy lên `reviews` với `id` sinh từ `id` cục bộ (idempotent khi chạy lại).
5. `studyCycleId` tạo một dòng `study_cycles`; Album tạo `albums` + `album_items`.
6. **Không xoá gì trên máy.** Đăng xuất vẫn giữ bản ngoại tuyến.
7. Quay lui: vì bản trên máy không bị sửa, bỏ liên kết tài khoản là đủ để trở lại như cũ.

## 11. Tiến độ 9 giai đoạn

| # | Giai đoạn | Trạng thái |
|---|---|---|
| 1 | Khảo sát repository, kiến trúc, cách lưu dữ liệu | **Xong** (mục 1) |
| 2 | Thiết kế: kiến trúc, dữ liệu, đồng bộ, phân quyền, Groq, migration | **Xong cho backend đã chọn** (tài liệu này) |
| 3 | Triển khai backend (DB, Auth, RLS, thao tác, bảo vệ API/xu) | **Một phần** — schema + RLS + hàm xu + 20/20 kiểm chứng; chưa có Edge Function |
| 4 | Tích hợp app (lưu online, đồng bộ tiến trình/Album/cài đặt) | **Chưa** — cần bước 3 |
| 5 | Admin panel | **Gần đủ dùng** — tổng quan, tài khoản, chi tiết người dùng, từ điển (sửa/gộp), xu, cấu hình AI; chưa deploy công khai |
| 6 | Tùy chỉnh chu kỳ Album | **Xong** (tự nhập phút/giờ, không còn danh sách cố định) |
| 7 | Khung nhập danh sách nhiều dòng + VI/EN + Groq dịch | **Xong** |
| 8 | Hỗ trợ máy tính | **Chưa** — đã có đánh giá ở mục 7 |
| 9 | Kiểm thử, sửa lỗi, tài liệu, checkpoint | **Một phần** — chỉ cho phần đã làm (6, 7) |

## 12. Việc người dùng cần làm

> **Đã xong (27/10/2026):** tạo project Free (Singapore), điền `.env` + `.env.cloud.local`, áp
> `supabase/migrations/0001_init.sql`. **Còn lại:** (a) tắt *Allow new users to sign up* rồi thử lại
> `auth.admin.createUser`; (b) thu hồi khoá `service_role` đã lộ trong lịch sử chat và thay bằng khoá
> mới đặt trong `.env.cloud.local` (không dán vào chat). Các bước dưới giữ lại làm hướng dẫn cho lần
> dựng project khác.

1. Tạo project Supabase (gói Free) tại supabase.com. Khi tạo, ghi lại xem Supabase **có đòi thẻ hay
   không** (tài liệu không nói rõ) và chọn region gần Việt Nam (Singapore) để giảm độ trễ.
2. Ghi lại 4 giá trị trong Dashboard → Project Settings → API:
   Project URL, `anon`/publishable key, `service_role` key (bí mật), và bật/tắt "Allow new users to
   sign up" (mục Authentication → Sign In / Providers) — cần biết trạng thái này vì yêu cầu là **chỉ
   admin tạo tài khoản**.
3. Giữ project "thức" (một request mỗi vài ngày là đủ) hoặc chấp nhận nó tự tạm dừng sau ~1 tuần.
4. Đặt khoá đúng chỗ, **không dán vào chat**:

   | Giá trị | Đặt vào |
   |---|---|
   | Project URL | `.env` → `EXPO_PUBLIC_SUPABASE_URL` |
   | anon / publishable key | `.env` → `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
   | service_role key | `.env.cloud.local` → `SUPABASE_SERVICE_ROLE_KEY` |
   | khoá Groq cho backend (tuỳ chọn, sau này) | `.env.cloud.local` → `GROQ_API_KEY` |

   Cả `.env` và `.env.cloud.local` đều đã bị gitignore; `.env.example` chỉ chứa **tên** biến.
5. Báo lại cho trợ lý rằng file đã có khoá (chỉ cần tên file, không dán giá trị).
6. Sau đó trợ lý sẽ: viết migration + RLS + Edge Functions, dựng admin panel, viết lớp đồng bộ, và
   chạy kiểm thử (xem mục 13).

> Nếu bạn muốn tự kiểm trước: trong SQL Editor của Supabase, tạo một bảng rồi thử `select` bằng
> `anon` key từ một tài khoản khác — kết quả phải là rỗng khi RLS bật. Đây chính là hành vi mà mục 13
> yêu cầu phải kiểm.

## 13. Điểm phải kiểm chứng trước khi tin

**Đã kiểm và đạt (2026-10-27, `npm run verify:cloud` 20/20):**

- RLS thực sự chặn A đọc/ghi dữ liệu của B (hai tài khoản thật, cả bảng tiến trình và profile).
- `award_coins()` không nhân đôi khi gửi cùng `source_id`, kể cả **3 request song song**.
- Client không chèn trực tiếp được vào `coin_ledger`; không tự `PATCH` `profiles.role` thành admin.
- Tài khoản `status='locked'` bị chặn ghi ở server (không chỉ ẩn nút).
- `auth.admin.createUser` chạy được khi đăng ký công khai **đang bật**.

**Chưa kiểm:**

- `auth.admin.createUser` khi **đã tắt** đăng ký công khai (`disable_signup=true`).
- Request từ origin khác bị từ chối; JWT hết hạn bị từ chối.
- Hành vi khi vượt hạn mức free và khi project bị tạm dừng.
- Trên web: `expo-sqlite` (WASM/OPFS/COOP-COEP) và thông báo (không hỗ trợ cục bộ).

## 14. Cách áp migration và deploy Edge Function

Hai đường, chọn một:

**A. Qua Dashboard (không cần token)**

1. SQL Editor → dán nội dung `supabase/migrations/000N_*.sql` → Run.
2. Edge Functions → *Deploy a new function* → *Via editor* → tên `admin-users` → dán
   `supabase/functions/admin-users/index.ts` → Deploy. Không cần đặt secret: Supabase tự cấp
   `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` cho function.

**B. Qua Management API (một lệnh, cần token)**

1. Tạo Personal Access Token: Supabase → Account → Access Tokens → *Generate new token*.
2. Đặt `SUPABASE_ACCESS_TOKEN=sbp_...` trong `.env.cloud.local` (đã gitignore).
3. `npm run cloud:apply` — chạy mọi file trong `supabase/migrations/` theo thứ tự rồi deploy mọi
   thư mục trong `supabase/functions/`.

Endpoint đã dùng (đối chiếu tài liệu Supabase):
`POST /v1/projects/{ref}/database/query` với `{ query }`, và
`POST /v1/projects/{ref}/functions/deploy?slug=...` với multipart `metadata` + `file`.

> Token `sbp_` có quyền quản trị project: coi như mật khẩu, thu hồi được ở cùng trang đã tạo.
> Không commit, không dán vào chat.

## 15. Tài liệu liên quan

- [ARCHITECTURE.md](ARCHITECTURE.md) — kiến trúc hiện tại của app.
- [TEST_PLAN.md](TEST_PLAN.md) — cách chạy kiểm thử.
- [NEXT_SESSION.md](../NEXT_SESSION.md) — việc còn lại của phiên làm việc gần nhất.
