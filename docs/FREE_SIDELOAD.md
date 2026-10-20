# Cài lên iPhone miễn phí (Apple ID thường, sideload)

Tài liệu này là con đường **không mất tiền** để dùng VocabMaster trên iPhone:
build `.ipa` trên GitHub Actions (macOS), rồi ký và cài bằng **Sideloadly** với
Apple ID miễn phí trên Windows.

> **Đánh đổi phải biết trước:** Apple ID miễn phí **không có App Groups**, nên
> **widget không hoạt động**. Workflow sẽ bỏ widget extension trước khi build.
> Toàn bộ code widget vẫn nằm trong repo và tự bật lại khi bạn chuyển sang tài
> khoản Apple Developer trả phí. App vẫn đầy đủ: 11 màn hình, SQLite, FSRS, 9 dạng
> câu hỏi, streak, thống kê, TTS, luyện nói, Gemini, backup JSON/CSV.

---

## 1. Bạn cần có

| Thứ | Ghi chú |
|---|---|
| Tài khoản GitHub | Miễn phí. Repo nên để **Private**. |
| iPhone iOS 16+ | Bật **Developer Mode** (bắt buộc từ iOS 16). |
| Windows + iTunes | Bắt buộc — bộ driver Apple Mobile Device nằm trong bản **tải từ apple.com**, không phải bản Microsoft Store. |
| iCloud for Windows | Chỉ cần khi Sideloadly báo lỗi `anisette` / `NP_E_CONN_FAILED` / không đăng nhập được Apple ID. |
| Sideloadly | Bản mới nhất từ sideloadly.io. |
| Apple ID miễn phí | Không cần trả phí, nhưng có giới hạn ở mục 7. |

Link tải đã kiểm tra là còn sống:

- iTunes 64-bit: https://www.apple.com/itunes/download/win64 → `iTunes64Setup.exe`
- iCloud: https://updates.cdn-apple.com/2020/windows/001-39935-20200911-1A70AA56-F448-11EA-8CC0-99D41950005E/iCloudSetup.exe

Cài iTunes, mở nó một lần rồi đóng (không cần đăng nhập), cắm iPhone, bấm **Trust**
trên điện thoại. Sau đó mở Sideloadly — ô chọn thiết bị phải hiện tên iPhone.

---

## 2. Đưa code lên GitHub

Nếu **chưa có tài khoản GitHub**, làm theo `docs/GITHUB_SETUP.md` trước (tạo tài khoản, bật
2FA, tạo repo, tạo token) — mục đó có bảng sự cố riêng cho phần đăng ký/đẩy code.

Nếu thư mục dự án **chưa** có `.git` (kiểm tra bằng `git status`), chạy trong PowerShell:

```powershell
cd "C:\Users\Lenovo\Desktop\VocabMaster"
git init -b main
git add .
git commit -m "VocabMaster: Expo SDK 58 app, FSRS, widgets, Gemini"
git remote add origin https://github.com/<TÊN-BẠN>/vocabmaster.git
git push -u origin main
```

Nếu đã có `.git` rồi thì **bỏ qua** khối trên, chỉ cần `git push -u origin main`.

Trước khi commit, kiểm tra nhanh:

```powershell
git status --short
```

Không được thấy `.env`, `node_modules/`, `ios/`, `tools/verify-report.txt`,
`app.json.free-build.bak`. `.gitignore` đã chặn sẵn.

Tạo repo trống trên github.com trước khi `git remote add` (đừng tick
"Add a README" để tránh commit rác).

---

## 3. Chạy build

1. Vào repo → tab **Actions**.
2. Chọn workflow **“iOS unsigned IPA (free Apple ID)”** → **Run workflow** → chọn
   nhánh `main` → **Run workflow**.
3. Đợi khoảng **20–40 phút**. Workflow tự chạy:
   `npm ci` → `typecheck` + `npm test` → bỏ widget → Xcode 26.6 trên `macos-26`
   → `expo prebuild` → `pod install` → `xcodebuild archive` không ký → đóng gói `.ipa`.
4. Khi job xanh, tải artifact **`VocabMaster-unsigned-ipa`** (giữ 14 ngày, nên tải ngay).
5. Giải nén được `VocabMaster-unsigned.ipa`.

Nếu bước nào fail, đọc log của đúng bước đó; phần lớn lỗi là do prebuild/pod hoặc
Xcode không khớp, không phải do code app.

---

## 4. Cài bằng Sideloadly

1. Mở Sideloadly, cắm iPhone bằng cáp.
2. Kéo `VocabMaster-unsigned.ipa` vào ô IPA.
3. Nhập **Apple ID** ở ô Apple account (không cần app-specific password với tài
   khoản miễn phí; nếu Apple hỏi mã 2FA thì nhập mã hiện trên máy).
4. Bấm **Start**. Lần đầu sẽ tạo App ID + provisioning profile (mất 1–2 phút).
5. Trên iPhone: **Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị** → chọn
   developer của bạn → **Tin cậy**.
6. **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển** → bật → khởi
   động lại máy. Không bật bước này app sẽ báo không mở được.
7. Mở app, cấp quyền micro + nhận diện giọng nói khi được hỏi.

---

## 5. Hết hạn sau 7 ngày — cách gia hạn

Profile của Apple ID miễn phí chỉ sống **7 ngày**. Hết hạn, app báo “không thể mở”.
Cách gia hạn: cài lại chính `.ipa` đó bằng Sideloadly (không cần build lại, vì file
đã tải về máy) — dữ liệu học trong app **vẫn còn**, vì cài lại cùng bundle ID sẽ
ghi đè app chứ không xoá dữ liệu. Nếu đã xoá file `.ipa`, chạy lại workflow để tải bản mới.

Sideloadly có tuỳ chọn tự ký lại (auto-refresh daemon) nhưng vẫn cần máy tính bật
và iPhone kết nối được.

---

## 6. Kiểm tra sau khi cài

| Việc | Kỳ vọng |
|---|---|
| Mở app lần đầu | Onboarding → chọn track + mục tiêu ngày |
| Thêm từ | Lưu được, hiện trong danh sách, không trùng |
| Học | 9 dạng câu hỏi, chấm đúng/sai, đánh giá 4 mức |
| Tắt app, mở lại | Dữ liệu còn (SQLite), streak giữ nguyên |
| Phát âm | Nghe được en-US/en-GB |
| Luyện nói | Xin quyền micro, hiện transcript + cảnh báo “chỉ so khớp từ” |
| Gemini | Cần dán API key trong Cài đặt (key lưu Keychain) |
| Backup | Xuất JSON/CSV, chia sẻ ra Files |
| Widget | **Không có** trong bản miễn phí (xem mục 8) |

---

## 7. Giới hạn của Apple ID miễn phí

| Giới hạn | Giá trị | Nguồn |
|---|---|---|
| App ID | 10, hết hạn sau 7 ngày | [Apple — Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/) |
| Thiết bị | 3 | nt |
| App mỗi thiết bị | 3 | nt |
| Provisioning profile | 7 ngày | nt |
| Developer Mode | Bắt buộc từ iOS 16 | [WWDC22 — Get to know Developer Mode](https://developer.apple.com/videos/play/wwdc2022/110344/) |
| App Groups / widget dữ liệu thật | Không có (cần tài khoản trả phí) | [Apple — Supported capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/) |
| Giữ app > 7 ngày mà không trả tiền | Không có cách ổn định cho mọi iOS | [TrollStore](https://github.com/opa334/TrollStore) chỉ hỗ trợ iOS 14.0b2–16.6.1/16.7RC/17.0 |

---

## 8. Khi nào quay lại bản có widget

Khi có Apple Developer Program (99 USD/năm):

```powershell
node scripts/prepare-free-build.mjs --restore   # bật lại plugin expo-widgets
npx expo prebuild --platform ios --clean
eas build --profile development --platform ios
```

Lúc đó App Group `group.com.vocabmaster.personal` được cấp, widget Home Screen và
Lock Screen đọc dữ liệu học thật.

---

## 9. Sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Sideloadly báo lỗi chứng chỉ/team | Apple ID sai, 2FA chưa nhập, hoặc quá 10 App ID trong 7 ngày | Đăng nhập lại, chờ 7 ngày, hoặc xoá app cũ |
| Cài xong nhưng app không mở | Chưa bật Developer Mode / chưa Trust | Làm mục 4 bước 5–6 |
| App mở rồi thoát ngay | Thiếu native module do build sai (ví dụ còn widget) | Tải lại artifact mới, chắc workflow chạy qua bước “Strip widget” |
| “Unable to install … App Group” | Cố ký bản còn widget bằng tài khoản miễn phí | Dùng bản workflow đã bỏ widget |
| Micro không hoạt động | Chưa cấp quyền | Cài đặt → VocabMaster → bật Micro + Nhận diện giọng nói |
| Gemini 403 | Key sai hoặc chưa bật Gemini API | Kiểm tra key trong AI Studio, dán lại |
| Workflow fail ở `pod install` | Runner đổi phiên bản CocoaPods | Chạy lại job; xem log phiên bản pod |
| Workflow fail ở `xcodebuild` | Xcode trên runner mới hơn code | Xem log, cập nhật Expo SDK hoặc pin image khác |
