# Kế hoạch: một tài khoản, một dữ liệu — iOS ↔ web ↔ admin panel

> **Tài liệu này chỉ là KẾ HOẠCH.** Chưa có dòng code đồng bộ nào được viết.
> Mục tiêu: người học đăng nhập một tài khoản, học trên điện thoại hay máy tính đều ra
> **cùng một dữ liệu**, và admin panel nhìn/điều khiển đúng dữ liệu đó.

Cập nhật: 2026-10-27 · Trạng thái: **chưa bắt đầu**

---

## 1. Hiện trạng thật (đã kiểm, không suy đoán)

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| Supabase schema + RLS + hàm xu | **Đã áp và kiểm** | `supabase/migrations/0001..0003`; `cloud:apply` đã chạy; 20/20 kiểm chứng |
| Bảng dùng chung | **Đủ** | `profiles`, `topics`, `terms`, `user_words`, `reviews`, `daily_activity`, `albums`, `album_items`, `coin_ledger`, `study_cycles`, `app_config`, `ai_usage` |
| Admin panel | **Đã lên mạng** | https://site-803d281e336549f99eaf45a04acd4531.freebuff.page (Freebuff Sites) |
| Edge Function quản trị | **Có** | `supabase/functions/admin-users` |
| Biến môi trường cho app | **Đã có trong `.env`** | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (đã bị gitignore) |
| App iOS gọi Supabase | **Chưa** | `grep` toàn `src/` + `App.tsx`: 0 file import Supabase |
| Bản web (Expo web) | **Đã chạy** | `npx expo start --web`; SQLite WASM lưu **riêng trong trình duyệt** |
| Cột đồng bộ (`remote_id`, `outbox`, `last_synced_at`) | **Chưa có** | `grep` trong `supabase/migrations/*.sql` → 0 kết quả |
| Màn hình đăng nhập trong app | **Chưa** | không có màn hình nào gọi đăng nhập |

**Hệ quả:** app và web vẫn là hai cục bộ rời; admin panel chỉ có dữ liệu do chính nó tạo.
Cả ba chưa nói chuyện với nhau — đó chính là việc phải làm.

---

## 2. Định nghĩa "cùng một dữ liệu" (phải chốt trước khi code)

1. **Supabase là nguồn sự thật (source of truth).** SQLite trên máy là bản làm việc ngoại tuyến
   + cache; web cũng vậy.
2. Khi có mạng: ghi local → vào `outbox` → đẩy lên Supabase; khi mở app → kéo phần thay đổi
   từ `last_synced_at`.
3. **Không bao giờ mất dữ liệu ngoại tuyến**: mọi thao tác làm được khi offline, đồng bộ bù khi
   có mạng; bỏ liên kết tài khoản thì dữ liệu trên máy vẫn còn (quy tắc ở `docs/CLOUD_BACKEND.md`
   mục 10).
4. Xung đột: `updated_at` mới hơn thắng (last-write-wins), **riêng số xu, streak và lịch ôn**
   dùng quy tắc cộng dồn/an toàn thay vì ghi đè — xem mục 5.
5. Đăng nhập trên máy tính hay điện thoại bằng **cùng một tài khoản Supabase Auth**; admin panel
   cũng đăng nhập bằng đúng hệ thống đó (đã làm), nên `profiles.role='admin'` quyết định quyền
   quản trị, `auth.uid()` quyết định dữ liệu cá nhân.

---

## 3. Các giai đoạn

### Giai đoạn A — Chuẩn bị backend (làm trước, không đụng app)

1. Xoay lại `service_role` (khoá đã lộ trong lịch sử chat) đặt vào `.env.cloud.local`, không dán vào chat.
2. Chốt chính sách đăng ký: tắt *"Allow new users to sign up"* và để admin tạo tài khoản
   (đã có sẵn trong panel), **hoặc** bật đăng ký tự do. Không làm cả hai cùng lúc.
3. Migration **`0004_sync.sql`**: thêm `remote_id` (uuid), `last_synced_at`, `device_id` cho các
   bảng người dùng; bảng `outbox` cục bộ phía app (SQLite) tương ứng; hàm/tiện ích đẩy dữ liệu
   idempotent. Migration phải **chạy lại được** (idempotent) và không xoá dữ liệu cũ.
4. Chạy lại toàn bộ kiểm chứng RLS: A không đọc được dữ liệu của B; tài khoản bị khoá bị chặn ở
   server; `award_coins` chỉ gọi được khi đã xác thực.

### Giai đoạn B — Đăng nhập trong app (iOS lẫn web cùng một màn hình)

1. Cài `@supabase/supabase-js`.
2. Màn hình **Đăng nhập / Đăng ký / Quên mật khẩu**, dùng chung cho iOS và web.
3. Phiên đăng nhập: iOS lưu trong Keychain (`expo-secure-store`), web giữ refresh token theo
   trình duyệt (ghi rõ trong README là **không** an toàn bằng Keychain).
4. Điều kiện bắt buộc: app **phải dùng được khi chưa đăng nhập** (bây giờ đang chạy cục bộ) —
   đăng nhập là tùy chọn, không được ép người dùng.

### Giai đoạn C — Tầng đồng bộ (trọng tâm)

1. Lớp `src/sync/` gồm: `outbox` (ghi local → hàng đợi), `push()` (gửi batch idempotent),
   `pull()` (kéo theo `last_synced_at`), `merge()` (theo quy tắc mục 2).
2. Gắn vào đúng chỗ ghi dữ liệu hiện có (`src/db/*`) bằng cách gọi `enqueue()` sau khi ghi
   local — **không viết lại các repository đang chạy tốt**.
3. Lần đăng nhập đầu tiên hiện lựa chọn rõ: *"Nhập dữ liệu trên máy này lên tài khoản"* —
   người dùng chủ động bấm, có thể bỏ qua; khớp từ theo `normalized`; lượt ôn cũ đẩy lên với
   `id` sinh từ id cục bộ để chạy lại không bị nhân đôi (mục 10 của tài liệu backend).
4. Kích hoạt đồng bộ trên **cả bản web** (`expo start --web`) — cùng một lớp code, khác phiên
   lưu trữ.
5. Không làm gì hại iOS: mọi thay đổi trong `src/` phải qua typecheck + 323 test hiện có.

### Giai đoạn D — Admin panel nối sẵn (đã có nền, chủ yếu là… nhìn)

1. Panel **đã đọc đúng bảng**; sau khi app đồng bộ, tab Người học + Chi tiết người dùng sẽ tự
   có dữ liệu thật — kiểm lại bằng một tài khoản học thật chứ không cần seed tay.
2. Bổ sung nhìn trạng thái đồng bộ: lần đồng bộ cuối, số thay đổi đang chờ, thiết bị nào hoạt động.
3. Mọi thao tác đặc quyền (điều chỉnh xu, tạo tài khoản, khoá) tiếp tục qua Edge Function
   kiểm tra `is_admin()` — **không** cho client tự sửa xu.

### Giai đoạn E — Kiểm thử bắt buộc

- **Hai tài khoản**: A không thấy dữ liệu của B (đọc + ghi đều bị 403).
- **Hai thiết bị cùng tài khoản**: học 5 từ trên web → mở iOS → thấy y hệt; làm ngược lại.
- **Ngoại tuyến**: tắt mạng → học → có mạng → dữ liệu lên server, không mất, không nhân đôi.
- **Đồng thời**: hai nơi ghi cùng lúc → không mất tiến độ, số xu không bị cộng hai lần.
- **Migration chạy lặp** không làm sai dữ liệu.
- **Không đăng nhập** vẫn học được bình thường (quyền riêng tư, không mất chức năng).
- Web không nhận thông báo cục bộ (hạn chế nền tảng) — ghi vào README thay vì hứa hẹn.

---

## 4. Rủi ro và giới hạn phải nói thẳng

- Supabase Free **tạm dừng sau 1 tuần không hoạt động** → cần dùng định kỳ hoặc heartbeat.
- Web không có Keychain; phiên đăng nhập web yếu hơn iOS.
- Đồng bộ là chỗ dễ mất dữ liệu nhất của cả dự án → làm từng bước nhỏ, mỗi bước có test,
  không "đổ nguyên lớp" vào một lần.
- Việc này **phải build lại IPA** (code trong app), khác với admin panel (web thì sửa là xong).

---

## 5. Prompt sẵn sàng dán cho phiên làm việc kế tiếp

```
Tiếp tục dự án VocabMaster (repo hiện có, KHÔNG xây lại từ đầu).

MỤC TIÊU: người học đăng nhập một tài khoản và học trên điện thoại lẫn máy tính đều ra cùng một
dữ liệu; admin panel nhìn và quản lý đúng dữ liệu đó. Tài liệu nền bắt buộc phải đọc trước:
docs/PLAN_ACCOUNT_SYNC.md (kế hoạch), docs/CLOUD_BACKEND.md (mục 4 quy tắc đồng bộ, mục 10
nhập dữ liệu lần đầu), CHECKPOINT.md, CHECKPOINT.json, CHANGELOG.md.

TRẠNG THÁI ĐÃ CÓ (đừng làm lại):
- Supabase schema + RLS + hàm award_coins đã áp (0001..0003) và đã kiểm chứng.
- Admin panel đã deploy công khai và đang đọc đúng các bảng đó.
- App iOS và bản web (expo start --web) CHƯA import Supabase; dữ liệu còn cục bộ.
- Cột remote_id/outbox/last_synced_at CHƯA tồn tại. .env đã có EXPO_PUBLIC_SUPABASE_URL/ANON_KEY.

YÊU CẦU THỰC HIỆN theo đúng thứ tự giai đoạn A → E trong PLAN_ACCOUNT_SYNC.md:
A. Chuẩn bị backend (xoay service_role, chốt chính sách đăng ký, migration 0004 idempotent).
B. Màn hình đăng nhập dùng chung cho iOS và web; app vẫn chạy được khi CHƯA đăng nhập.
C. Lớp src/sync/ gồm outbox + push + pull + merge, gọi sau khi ghi local, không viết lại
   repository đang chạy tốt; lần đầu hỏi "Nhập dữ liệu trên máy này lên tài khoản".
D. Admin panel: kiểm bằng tài khoản học thật, thêm nhìn trạng thái đồng bộ, mọi thao tác
   đặc quyền qua Edge Function.

RÀNG BUỘC (không được vi phạm):
- Không phá source IPA: app.json phần ios, plugin widget, entitlements không đổi. Sau mỗi chặng
  chạy `npx tsc --noEmit` và `npm test` (đang 0 lỗi và 323/323) — nếu đỏ thì sửa tới khi xanh.
- Không xoá hay ghi đè dữ liệu cục bộ của người dùng; migration chạy lại được, không nhân đôi.
- Số xu, streak, lịch ôn không bị ghi đè kiểu last-write-wins.
- Khoá service_role không bao giờ vào repo, app hay chat.
- Không deploy/publish gì khi chưa hỏi.

KIỂM THỬ BẮT BUỘC: hai tài khoản cách ly, hai thiết bị cùng tài khoản đồng bộ hai chiều,
ngoại tuyến → có mạng, ghi đồng thời không nhân đôi xu, migration chạy lặp an toàn.

BÁO CÁO SAU KHI XONG: file đã đổi, migration đã thêm, test đã chạy + kết quả, phần chưa làm
và lý do, giới hạn kỹ thuật (thông báo web, Keychain web, Supabase free pause).
```

---

## 6. Việc người dùng cần quyết định trước khi bắt đầu

1. **Đăng ký tài khoản**: cho người dùng tự đăng ký, hay chỉ admin tạo? (khuyến nghị: admin tạo,
   như panel đang làm).
2. **Dữ liệu cũ trên điện thoại**: lần đầu đăng nhập thì đẩy lên, hay bắt đầu sạch trên tài khoản?
   (khuyến nghị: có hỏi *"Nhập dữ liệu trên máy này lên tài khoản"*, người dùng chủ động bấm).
3. **Đồng bộ tự động hay theo nút**: tự động khi có mạng (khuyến nghị) hay bấm "Đồng bộ" trong
   Cài đặt.
