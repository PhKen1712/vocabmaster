# Tạo tài khoản GitHub và đẩy VocabMaster lên (chi tiết từng bước)

Mục tiêu: có một repo GitHub chứa code VocabMaster, để GitHub Actions build file
`.ipa` trên macOS miễn phí.

Thời gian: **10–15 phút**. Không cần thẻ tín dụng.

---

## 0. Chuẩn bị

- Một địa chỉ email bạn dùng được (Gmail, Outlook…).
- Điện thoại có app xác thực 2 lớp: **Microsoft Authenticator**, **Google Authenticator**,
  **Authy** hoặc **1Password** (đều miễn phí).
- Mật khẩu mạnh, không dùng lại.

> Bắt buộc theo tài liệu GitHub: người đóng góp code phải bật 2FA, nếu không bật trong thời
> hạn cho phép bạn sẽ **không đăng nhập được** GitHub.com cho tới khi bật. Cứ bật ngay từ đầu.

---

## 1. Tạo tài khoản

1. Mở https://github.com/signup
2. Nhập **email** → **Continue**.
3. Đặt **password** (≥ 15 ký tự hoặc ≥ 8 ký tự có số + chữ thường) → **Continue**.
4. Đặt **username**. Đây là tên hiển thị công khai và nằm trong URL repo, ví dụ
   `nguyenvana`. Quy tắc: chữ thường, số, dấu gạch nối; không dấu cách, không dấu tiếng Việt.
   → **Continue**.
5. GitHub có thể hỏi **"Are you a student?" / giới thiệu tính năng** → bấm **Skip** / **Continue**
   cho nhanh; không ảnh hưởng gì.
6. Làm câu đố xác minh (kéo/xoay hình, chọn ô…) nếu có.
7. Nhập **mã 6 số** GitHub gửi vào email → xong tài khoản.
8. Nếu được hỏi chọn gói: chọn **Free** (0 USD). Bỏ qua mọi lời mời dùng thử Copilot/Pro.

Nếu không thấy email: kiểm tra **Spam/Quảng cáo**, và bấm "Resend".

---

## 2. Bật 2FA (làm ngay, đừng bỏ qua)

1. Bấm **avatar góc phải trên** → **Settings**.
2. Menu trái → **Password and authentication**.
3. Mục **Two-factor authentication** → **Enable two-factor authentication**
   (có thể phải nhập lại mật khẩu).
4. Chọn **Authenticator app** → **Set up using an app**.
5. Mở app xác thực trên điện thoại → **quét QR** GitHub hiển thị
   (hoặc nhập chuỗi "setup key" bằng tay).
6. Nhập mã 6 số app hiện ra → **Verify**.
7. **Lưu recovery codes**: bấm **Download** hoặc **Copy** rồi cất ở nơi an toàn
   (in ra, hoặc lưu trong trình quản lý mật khẩu). Mất điện thoại mà không có mã này
   là mất tài khoản.

Xong bước này GitHub sẽ cho bạn đẩy code và chạy Actions bình thường.

---

## 3. Tạo repo trống

1. Mở https://github.com/new
2. **Repository name**: `vocabmaster`
3. **Description**: bỏ trống cũng được.
4. Chọn **Private** hoặc **Public** — xem mục 6 để biết ảnh hưởng tới quota build.
5. **KHÔNG** tick: *Add a README file*, *Add .gitignore*, *Choose a license*.
   Tick vào sẽ làm `git push` đầu tiên bị từ chối (lịch sử khác nhau).
6. Bấm **Create repository**.
7. Trang tiếp theo hiện URL. Copy dạng:

```
https://github.com/TEN-BAN/vocabmaster.git
```

---

## 4. Đẩy code lên (PowerShell trên Windows)

### 4.1 Đặt danh tính git (một lần)

```powershell
git config --global user.name "TEN-BAN"
git config --global user.email "email-cua-ban@example.com"
```

Email nên trùng email đã đăng ký GitHub.

### 4.2 Tạo repo local và commit

```powershell
cd "C:\Users\Lenovo\Desktop\VocabMaster"
git init -b main
git add .
git status --short
```

Kiểm tra danh sách file: **không được** thấy `.env`, `node_modules/`, `ios/`, `build/`,
`tools/verify-report.txt`, `app.json.free-build.bak`. Đã kiểm chứng `.gitignore` chặn đủ
các đường dẫn này.

```powershell
git commit -m "VocabMaster: Expo SDK 58 app, FSRS, widgets, Gemini"
git remote add origin https://github.com/TEN-BAN/vocabmaster.git
git push -u origin main
```

### 4.3 Khi được hỏi đăng nhập

Cửa sổ **Git Credential Manager** có thể hiện ra:

- Chọn **"Sign in with your browser"** → trình duyệt mở → **Authorize** → xong, không cần
  token. Đây là cách dễ nhất.
- Nếu nó hỏi **username + password**: GitHub **không nhận mật khẩu thường**, phải dùng
  **Personal Access Token** ở mục 5.

Đẩy thành công khi thấy dòng cuối giống:

```
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

Mở lại trang repo trên trình duyệt, phải thấy file `App.tsx`, `package.json`,
thư mục `.github/workflows`. Nếu thấy → tốt.

---

## 5. Personal Access Token (chỉ khi được hỏi mật khẩu)

1. Avatar → **Settings** → cuối menu trái: **Developer settings**.
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Điền:
   - **Token name**: `vocabmaster-push`
   - **Expiration**: 30 days (hoặc 90)
   - **Resource owner**: chính bạn
   - **Repository access**: **Only select repositories** → chọn `vocabmaster`
   - **Repository permissions** → **Contents**: **Read and write**
     (mục **Metadata** tự động Read-only, không cần đổi)
4. **Generate token** → copy chuỗi `github_pat_...` **ngay lập tức** (rời trang là mất).
5. Khi `git push` hỏi:
   - `Username`: username GitHub của bạn
   - `Password`: **dán token** (chuột phải để dán, PowerShell không hiện ký tự khi gõ)

Muốn đổi/xoá token: cùng trang đó → **Delete**. Không cần token cho bước chạy build.

---

## 6. Private hay Public — ảnh hưởng tới số lần build

| | Private | Public |
|---|---|---|
| Người khác xem code | Không | **Có** |
| Thời gian Actions miễn phí | **2.000 phút/tháng** | Miễn phí, không giới hạn |
| Một build macOS ~13 phút tốn | Thực đo trên repo này: **~20 phút** (xem ghi chú) | 0 |
| Số build/tháng (không trả tiền) | **hàng chục lần** | Không giới hạn |

Ghi chú về hệ số macOS: tài liệu GitHub ghi macOS tính **10×**, nhưng trang
**Settings → Billing** của repo này ghi **20,7 phút** cho hai lần chạy tổng ~15,6 phút
(một 12m07 bị huỷ, một 3m32 fail) — tức gần **1×**. Cứ theo con số ở trang Billing, đừng
theo ước tính.

Gợi ý: chọn **Private**. Bạn chỉ cần build khi **sửa code**; gia hạn 7 ngày chỉ là cài lại
file `.ipa` đã tải, **không cần build lại**.

Nếu sau này cần build nhiều, đổi sang Public trong **Settings → General → Danger Zone →
Change visibility**.

---

## 7. Chạy build

1. Trong repo → tab **Actions**.
2. Nếu GitHub hỏi bật workflow: bấm **I understand my workflows, go ahead and enable them**.
3. Chọn workflow **"iOS unsigned IPA (free Apple ID)"** ở cột trái.
4. Bấm **Run workflow** (phải) → nhánh `main` → **Run workflow**.
5. Job xuất hiện, vòng tròn vàng → xanh (20–40 phút). Bấm vào job để xem log từng bước.
6. Xong: cuối trang job có mục **Artifacts** → tải **`VocabMaster-unsigned-ipa`**.
7. Giải nén → `VocabMaster-unsigned.ipa` → cài bằng Sideloadly (xem `docs/FREE_SIDELOAD.md`).

Workflow chạy: `npm ci` → typecheck + 36 test → bỏ widget → `expo prebuild` →
`pod install` → `xcodebuild archive` không ký → đóng gói `.ipa`.

---

## 8. Sự cố thường gặp khi đăng ký / đẩy code

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không nhận mã xác minh email | Vào Spam/Quảng cáo, hoặc email chặn | Bấm Resend, thêm `noreply@github.com` vào danh bạ |
| "Username is not available" | Đã có người dùng | Thêm số hoặc gạch nối, ví dụ `nguyenvana-dev` |
| Bị chặn sau khi đăng nhập ("suspicious activity") | GitHub nghi tài khoản mới | Đăng nhập trên điện thoại/bật 2FA, làm theo hướng dẫn hiện ra |
| `remote origin already exists` | Đã add remote trước đó | `git remote set-url origin https://github.com/TEN-BAN/vocabmaster.git` |
| `failed to push some refs` / `rejected` | Đã tick README khi tạo repo | `git pull --rebase origin main` rồi `git push -u origin main` |
| `Authentication failed` khi push | Dùng mật khẩu thường | Dùng Personal Access Token (mục 5) hoặc "Sign in with your browser" |
| `Support for password authentication was removed` | Như trên | Như trên |
| Mất điện thoại có 2FA | — | Dùng **recovery codes** đã lưu ở mục 2 bước 7 |
| Actions không có nút Run workflow | Workflow chưa nằm trên nhánh `main` | Kiểm tra `git push` đã xong, tải lại trang Actions |
| Job đỏ ở `pod install` | Runner đổi phiên bản CocoaPods | Chạy lại; nếu vẫn lỗi, gửi log bước đó |
| Job đỏ ở `xcodebuild` | Xcode mới hơn code | Gửi log; cần cập nhật Expo SDK hoặc pin image |
| Hết quota Actions | Build nhiều trên repo Private | Đổi repo sang Public, hoặc chờ sang tháng |

---

## 9. Sau khi có repo

- Không commit `.env`, API key, token. `.gitignore` đã chặn; kiểm bằng `git status --short`
  trước mỗi lần commit.
- Mỗi lần sửa code: `git add . && git commit -m "..." && git push` → workflow tự chạy
  (đã cấu hình `on: push` cho nhánh `main`).
- Chi tiết cài lên iPhone và gia hạn 7 ngày: `docs/FREE_SIDELOAD.md`.
