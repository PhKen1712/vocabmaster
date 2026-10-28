# Đăng nhập bảng quản trị: nguyên nhân thật và cách khôi phục

Cập nhật: 2026-10-28 · Trạng thái: **đã kiểm chứng trên trình duyệt thật**

---

## 1. Nguyên nhân thật (không phải "chưa kết nối")

Đã kiểm tra bằng lệnh thật, không suy đoán:

| Hạng mục kiểm tra | Kết quả thật |
|---|---|
| Supabase Auth còn sống | `GET /auth/v1/health` → **200**, GoTrue v2.197.0 |
| Kết nối từ trang quản trị | `OPTIONS /auth/v1/token` (CORS) → **200**, `POST` → 400 với mật khẩu sai = **đường mạng thông** |
| Tài khoản admin | `phambaolam1712` — `role=admin`, `status=active`, đã xác nhận email, `last_sign_in = 2026-10-27T17:14` |
| Đọc hồ sơ qua RLS | `GET /rest/v1/profiles` bằng JWT admin → trả đúng dòng của mình |
| Hàm quản trị | `admin_stats`, `admin_accounts` bằng JWT admin → trả số liệu thật |
| Tài khoản thường bị chặn | `admin_stats`/`admin_accounts` → `42501 "chỉ admin"`; `PATCH profiles.role` → `permission denied for table profiles` |
| Tài khoản thứ hai trong hệ thống | `choccho` (`phu***@gmail.com`), `role = user`, `last_sign_in = chưa từng` |

**Kết luận:** bảng quản trị **kết nối được** và **đăng nhập được**. Việc "không đăng nhập được" đến từ
hai chuyện cụ thể:

1. Tài khoản được dùng để thử là `choccho` — một **người dùng thường**, nên giao diện chặn đúng:
   *"Tài khoản này không có quyền quản trị."* Đây là hành vi đúng, không phải lỗi.
2. Tài khoản đó **chưa từng đăng nhập thành công lần nào**, tức mật khẩu chưa được đặt hoặc đã quên.

Nói cách khác: hệ thống đúng, quyền sai, mật khẩu thì chưa có.

---

## 2. Việc đã sửa trong mã nguồn

| Việc | File | Vì sao |
|---|---|---|
| Không gọi `supabase.*` ngay trong callback `onAuthStateChange` | `admin/src/App.tsx` | supabase-js đang giữ khoá phiên lúc phát sự kiện; gọi request tại đó có thể **treo ở màn "Cẩn thẩm định quyền…"**. Đã đẩy sang microtask sau |
| Thêm **Quên mật khẩu** và màn **đặt mật khẩu mới** | `admin/src/App.tsx`, `admin/src/lib/supabase.ts` | Trước đây không có cách nào lấy lại tài khoản ngoài việc nhớ mật khẩu |
| Phiên hết hạn được xử lý gọn | `admin/src/lib/api.ts` | `PGRST301`/401 → tự đăng xuất về màn đăng nhập thay vì hiện lỗi kỹ thuật trên từng bảng |
| Lỗi đăng nhập nói tiếng Việt, nêu đúng việc cần làm | `admin/src/App.tsx` | "Email not confirmed", "rate limit", "không gọi được Supabase"… mỗi lỗi một hướng xử lý |

## 3. Việc đã sửa trong cấu hình Supabase

`uri_allow_list` **trước đây để trống** và `site_url = http://localhost:3000`. Với cấu hình đó,
**mọi liên kết trong email đều bị chặn** — kể cả liên kết đặt lại mật khẩu. Đã đặt lại:

```
site_url        = https://site-803d281e336549f99eaf45a04acd4531.freebuff.page
uri_allow_list  = https://site-803d…freebuff.page, https://*.freebuff.page,
                  http://localhost:5180, http://localhost:8081, http://localhost:3000,
                  vocabmaster://auth-callback
mailer_autoconfirm = true   (bỏ vòng xác nhận email khi tự tạo tài khoản)
```

`disable_signup` vẫn là `false`: **ai có link cũng tự tạo được tài khoản** (chỉ là người dùng
thường, không có quyền quản trị, RLS vẫn cô lập dữ liệu). Muốn chỉ quản trị viên tạo tài khoản thì
đặt `disable_signup = true` trong Supabase → Authentication → Sign In / Providers.

---

## 4. Cách vào bảng quản trị (từng bước)

### 4.1. Cấp quyền admin cho tài khoản đã có

```bash
cd Desktop/VocabMaster
npm run admin:promote -- --email phu***@gmail.com      # đổi thành email thật
```

### 4.2. Đặt lại mật khẩu khi quên

```bash
npm run admin:reset -- --email ban@gmail.com
```

Mật khẩu được hỏi **ngay trên máy bạn** (ký tự không hiện ra màn hình), không đi qua chat, không
ghi ra file, không vào git. Script tự đăng nhập thử lại bằng chính khoá công khai mà panel dùng và
in ra kết quả — nên nếu mật khẩu không dùng được thì bạn biết ngay.

Không chạy được ở máy (ví dụ đang dùng điện thoại)? Dùng nút **Quên mật khẩu?** trên panel và mở
liên kết trong hộp thư.

### 4.3. Tạo tài khoản quản trị mới

```bash
npm run admin:create
```

### 4.4. Thu quyền admin

```bash
npm run admin:promote -- --email ban@gmail.com --demote
```

Script in ra số tài khoản admin còn lại để bạn không tự khoá mình khỏi hệ thống.

---

## 5. Đã kiểm thử những gì

- Đăng nhập bằng tài khoản admin tạo qua script → vào được dashboard, số liệu đọc từ database thật.
- **Tải lại trang** → phiên vẫn còn, dashboard hiện đúng.
- **Đăng xuất** → có gọi `POST /auth/v1/logout` (204) và quay về màn đăng nhập.
- **Người dùng thường** → bị chặn ở giao diện *và* bị chặn ở database (42501).
- **Quên mật khẩu** → mở liên kết khôi phục, panel bật màn "Mật khẩu mới", đặt xong thì đăng nhập
  lại bằng mật khẩu đó thành công.
- Tài khoản dùng để thử đã bị **xoá sạch** sau khi kiểm thử; không để lại dữ liệu rác.

## 6. Quản lý chuỗi ngày học (streak)

Trong **Tài khoản → chọn một người → thẻ “Chuỗi ngày học (streak)”**:

- Streak hiện tại, streak dài nhất, ngày hoạt động cuối, ngày đạt mục tiêu cuối, hôm nay (UTC).
- Mốc điều chỉnh đang áp (nếu có) kèm lý do.
- Form **Đặt streak thành (ngày)** + **Lý do** (bắt buộc ≥ 3 ký tự) → hộp xác nhận → lưu.
- **Lịch sử điều chỉnh**: thời điểm, giá trị đặt, lý do, người thực hiện.

Quy tắc đã kiểm chứng bằng script `scripts/verify-admin.mjs` (25/25):

| Việc | Kết quả thật |
|---|---|
| Thành viên gọi `admin_streak_info` / `admin_set_streak` | HTTP 403 |
| Admin đặt 5 ngày | đọc lại `current=5`, `longest=5`, `grant.days=5` |
| Lý do quá ngắn | HTTP 400 |
| App nhận mốc (`my_streak_baseline`) | `days=5`, `date=…` |
| Điều chỉnh streak có sinh xu? | **Không** — 0 dòng trong `coin_ledger` |

Điều chỉnh được lưu ở bảng riêng `streak_grants` (không sửa `daily_activity`), nên lịch sử học,
biểu đồ 30 ngày và độ chính xác **không đổi**. App đọc mốc qua `my_streak_baseline` và tính chuỗi
theo đúng quy tắc `computeStreak()`: mốc thay chuỗi **trước** mốc, các ngày đạt mục tiêu **sau** mốc
vẫn nối tiếp, mốc còn sống khi ngày cuối của chuỗi là hôm nay hoặc hôm qua.

> Trước 2026-10-29 thẻ này luôn hiện 0. Nguyên nhân: app không gửi cờ “đã đạt mục tiêu” và cột
> `daily_activity.streak` không bao giờ được gửi; panel cũng không đọc `streak_grants`. Đã sửa bằng
> migration `0008_streak_truth.sql` (xem `CHANGELOG.md`).

## 7. Groq dùng chung cho thành viên

Panel **Groq / AI**:

- Dán khoá `gsk_…` → **Lưu khoá**. Khoá được lưu ở `app_config.ai_groq_key`, cột này **đã thu hồi
  quyền đọc** với `authenticated`; panel chỉ thấy bản che (`gsk_ab…wxyz`).
- **Bật AI**, chọn **Groq**, đặt **Model**, **Hạn mức/ngày**, **Mục mỗi lần gọi** → **Lưu cấu hình**.
- **Kiểm tra kết nối** gọi Edge Function `ai-proxy` `/models` (không tốn token).

Cách app dùng: key riêng của người học (nếu có) luôn được ưu tiên và gọi thẳng Groq; nếu không có,
app gọi `ai-proxy` bằng JWT của chính người đó, function kiểm tra `ai_enabled`, lấy khoá ở server,
kiểm hạn mức `ai_take_quota` rồi mới gọi Groq. Khoá **không** đi xuống trình duyệt/điện thoại.

Đã kiểm: thiếu phiên → 401; khoá sai → 401 kèm thông báo; khoá không bị trả về nguyên vẹn;
thành viên không đọc được cột khoá (403). **Chưa** gọi thành công vì chưa có khoá thật trong
`.env.cloud.local` — cần dán khoá trong panel rồi bấm Kiểm tra.

## 8. Còn phải làm

- **Gửi email thật**: chưa kiểm được vì `@example.com` bị Supabase từ chối; cần một hộp thư thật.
  Supabase free giới hạn vài email mỗi giờ nên đừng bấm liên tục.
- **Dán khoá Groq** để hoàn tất đường AI dùng chung.
- **Xoay khoá**: `service_role` và Personal Access Token từng bị dán vào chat → nên thu hồi và tạo
  lại trong Supabase → Settings → API / Account → Access Tokens.
