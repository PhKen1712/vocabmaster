# NEXT SESSION — bắt đầu từ đây

## 1. Dự án đang ở đâu

- **Đã xanh (chạy thật ngày 2026-10-22):** `npm run typecheck` exit 0 (0 lỗi), `npm test -- --ci`
  **125/125 test pass trong 11 suite**, `node scripts/validate-checkpoint.mjs` hợp lệ. Trước đó (2026-10-20):
  `expo-doctor` 20/20, `expo config --type prebuild` compose đúng 2 widget + App Group.
- **Mới nhất (2026-10-22):** lớp Gemini được gia cố (`src/ai/errors.ts`, `retry.ts`, `diagnostics.ts`,
  `gemini.ts`, `schema.ts` + UI), sửa lỗi kiểm tra đầu vào không có đáp án (`src/quiz/placement.ts`),
  và bắt đầu kho từ bundle: 134/5.000 từ trong `src/data/packs.ts` (`SEED_VERSION = '2'`).
  Đọc `CHANGELOG.md` mục 2026-10-22 và `docs/WORD_BANK.md` trước khi sửa AI/kho từ.
- **Chưa chạy:** gọi Gemini thật bằng key người dùng sau thay đổi 2026-10-22; `expo prebuild` cho iOS
  (Expo chặn trên Windows); EAS build; kiểm chứng widget/speech/notification trên máy thật.
- **Toàn bộ code trên đĩa** tại `C:\Users\Lenovo\Desktop\VocabMaster`.
  Workspace của công cụ AI là `C:\Users\Lenovo\Desktop\App TANH` — **khác** thư mục dự án.
  Luôn `cd "C:/Users/Lenovo/Desktop/VocabMaster"` trước khi chạy lệnh.
- **Blocker còn lại:** (a) iOS prebuild/build chỉ chạy trên macOS hoặc EAS;
  (b) App Groups cần Apple Developer Program 99 USD/năm — quyết định của người dùng.
- **Git:** repo private `https://github.com/phamkenn/vocabmaster` (branch `main`), workflow macOS
  `ios-unsigned.yml` đã tạo ra `.ipa` cài được bằng Sideloadly. Chưa có EAS project.

## 2. Đọc theo thứ tự này

1. `CHECKPOINT.md` — mục 12, 13, 14 là trạng thái thật mới nhất.
2. File này.
3. `CHECKPOINT.json` — `test_results` có số liệu đo được.
4. Cuối `CHANGELOG.md` — việc đã làm theo từng phiên.
5. `docs/FEASIBILITY.md` — vì sao widget cần tài khoản trả giá.
6. `docs/ARCHITECTURE.md`, `docs/TEST_PLAN.md`.
7. `docs/WORD_BANK.md` — phân bổ 2.500 + 2.500, tiêu chí chọn từ, nguồn miễn phí và giấy phép.

## 3. Lệnh kiểm tra (chạy đầu tiên mỗi phiên)

```bash
git --version && node --version && npm --version
cd "C:/Users/Lenovo/Desktop/VocabMaster"
node scripts/verify.mjs        # install + typecheck + jest --ci + validate, ghi tools/verify-report.txt
```

`verify.mjs` trả exit 0 khi mọi bước pass và ghi report sau từng bước (kể cả khi bị kill).
Nếu report ghi fail, đọc đúng lỗi đầu tiên rồi sửa — đừng chạy `npm install` mù quáng.

## 4. Việc ưu tiên tiếp theo

1. **Commit + push thay đổi AI 2026-10-22**, chờ workflow macOS xanh, tải `.ipa` và cài đè
   (`docs/FREE_SIDELOAD.md`). Huỷ các run cũ để tiết kiệm ~300 phút macOS/run.
   Sau khi cài: **Cài đặt → Gemini AI → "Kiểm tra key + model"** → **AI Studio → "Tạo bộ từ"**.
   Nếu lỗi, đọc **Cài đặt → "Lần gọi Gemini gần đây"** (giai đoạn + HTTP status + mã lỗi) rồi ghi kết quả
   thật vào `CHECKPOINT.json → test_results.device_tests`.
2. **Quyết định Apple Developer Program.** Không có nó thì widget chỉ render placeholder
   vì không có App Group để chia sẻ dữ liệu.
3. **`eas init` + development build.** EAS chạy prebuild trên macOS; sau build kiểm tra:
   - có target `ExpoWidgetsTarget` với `DailyWordWidget` + `ReviewGlanceWidget`
   - entitlement `com.apple.security.application-groups` = `group.com.vocabmaster.personal`
   - `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` có trong Info.plist
4. **Cài lên iPhone, kiểm theo `docs/TEST_PLAN.md`** — ưu tiên 2.3 (buổi học) và 2.6 (widget).
5. **Ghi kết quả thật** vào `CHECKPOINT.json → test_results.device_tests` và `CHANGELOG.md`.
   Chỉ đánh dấu `verified_on_device` khi đã tận mắt thấy trên máy.

## 5. Những điều phải tránh

- Không dùng Expo Go để kết luận widget/speech hoạt động.
- Không dùng PWA thay widget.
- Không "lách" App Groups bằng Apple ID miễn phí — Apple không cấp entitlement.
- Không hardcode/commit Gemini key; `EXPO_PUBLIC_*` là công khai.
- Không thêm retry cho `invalid_key` / `quota_exceeded`, và không nâng số lần thử quá 3: mỗi lần thử là
  một request thật, Google tính vào hạn mức.
- Không hiển thị nguyên văn lỗi Google mà chưa qua `redactSecrets` + `describeAiError`.
- Không sửa migration v1 đã có; thêm version mới.
- Không xoá dữ liệu người dùng để "sửa lỗi"; backup trước.
- Không thêm `ignoreDeprecations`/`@ts-expect-error` chỉ để tsc im lặng — sửa nguyên nhân
  (đã làm vậy với `baseUrl`, `execAsync`, `newArchEnabled`).
- Không viết lại toàn bộ dự án; đọc checkpoint trước.

## 6. Giả định chưa được xác minh

| Giả định | Cách kiểm |
|---|---|
| EAS prebuild sinh đúng 2 widget target + App Group | Build trên EAS, xem log prebuild và `ios/ExpoWidgetsTarget` |
| `@expo/ui` `Text` nhận số/nhiều children trong runtime widget | Mở widget trên iPhone, xem layout |
| iOS có on-device English speech model trên máy người dùng | Chạy luyện nói, đọc mã lỗi nếu `requiresOnDeviceRecognition` fail |
| `gemini-3.8-flash` còn hiệu lực với key của người dùng | Tạo 3 từ trong AI Studio; nếu 404, app tự đổi model và Cài đặt → "Kiểm tra key + model" để lưu |
| Backup JSON/CSV khôi phục đúng | Xuất → xoá → khôi phục → so số từ |
| Thông báo nhắc học bắn đúng giờ | Đặt nhắc gần + thử trên máy |

## 7. Bản đồ nhanh khi cần sửa

| Cần sửa gì | File |
|---|---|
| Thuật toán ôn | `src/srs/fsrs.ts` |
| Câu hỏi/chấm điểm | `src/quiz/generator.ts`, `src/quiz/grading.ts` |
| Streak | `src/streak/streak.ts` |
| Schema/migration | `src/db/schema.ts` |
| Lưu lượt ôn | `src/db/reviews.ts` |
| Nhập/xuất dữ liệu | `src/db/backup.ts` (dùng `expo-file-system/legacy`) |
| Gemini | `src/ai/*` |
| Widget | `widgets/*.tsx`, `src/widgets/*` |
| Giao diện | `src/screens/*`, `src/components/*`, `src/theme/*` |
| Điều hướng | `src/navigation/NavigationProvider.tsx`, `App.tsx` |
| Kiểm thử tự động | `scripts/verify.mjs`, `src/**/__tests__/*.test.ts` |

## 8. Định nghĩa "xong" cho phiên tới

- `node scripts/verify.mjs` exit 0 (đang đạt).
- `git log` có ít nhất 1 commit sạch, không secret.
- EAS build cài được lên iPhone; ít nhất widget Home Screen hiển thị đúng dữ liệu thật.
- Nếu chưa có tài khoản Apple: ghi rõ `blocked`, không tuyên bố hoàn thành.
