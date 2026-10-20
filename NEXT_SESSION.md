# NEXT SESSION — bắt đầu từ đây

## 1. Dự án đang ở đâu

- **Đã xanh (chạy thật ngày 2026-10-20):** `npm run typecheck` exit 0 (0 lỗi), `npm test -- --ci`
  36/36 test pass trong 4 suite, `npx expo-doctor` 20/20, `npx expo config --type prebuild`
  compose đúng 2 widget + App Group, `node scripts/validate-checkpoint.mjs` hợp lệ.
- **Chưa chạy:** `expo prebuild` cho iOS (Expo chặn trên Windows), EAS build, cài iPhone,
  kiểm chứng widget/speech/notification/Gemini trên máy thật.
- **Toàn bộ code trên đĩa** tại `C:\Users\Lenovo\Desktop\VocabMaster`.
  Workspace của công cụ AI là `C:\Users\Lenovo\Desktop\App TANH` — **khác** thư mục dự án.
  Luôn `cd "C:/Users/Lenovo/Desktop/VocabMaster"` trước khi chạy lệnh.
- **Blocker còn lại:** (a) iOS prebuild/build chỉ chạy trên macOS hoặc EAS;
  (b) App Groups cần Apple Developer Program 99 USD/năm — quyết định của người dùng.
- Chưa có Git repo, chưa có EAS project.

## 2. Đọc theo thứ tự này

1. `CHECKPOINT.md` — mục 12, 13, 14 là trạng thái thật mới nhất.
2. File này.
3. `CHECKPOINT.json` — `test_results` có số liệu đo được.
4. Cuối `CHANGELOG.md` — việc đã làm theo từng phiên.
5. `docs/FEASIBILITY.md` — vì sao widget cần tài khoản trả giá.
6. `docs/ARCHITECTURE.md`, `docs/TEST_PLAN.md`.

## 3. Lệnh kiểm tra (chạy đầu tiên mỗi phiên)

```bash
git --version && node --version && npm --version
cd "C:/Users/Lenovo/Desktop/VocabMaster"
node scripts/verify.mjs        # install + typecheck + jest --ci + validate, ghi tools/verify-report.txt
```

`verify.mjs` trả exit 0 khi mọi bước pass và ghi report sau từng bước (kể cả khi bị kill).
Nếu report ghi fail, đọc đúng lỗi đầu tiên rồi sửa — đừng chạy `npm install` mù quáng.

## 4. Việc ưu tiên tiếp theo

1. **`git init` + commit + push GitHub, rồi chạy workflow `iOS unsigned IPA (free Apple ID)`.**
   Đây là đường người dùng đã chọn (Apple ID miễn phí, không widget). Tài liệu từng bước:
   `docs/FREE_SIDELOAD.md`. `.gitignore` đã chặn `.env`, `ios/`, `node_modules/`,
   `tools/verify-report.txt`, `app.json.free-build.bak`.
   Sau khi có `.ipa`: cài bằng Sideloadly, bật Developer Mode, kiểm tra checklist mục 6 của tài liệu.
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
| `gemini-2.5-flash` còn hiệu lực với key của người dùng | Tạo 3 từ trong AI Studio; đổi model nếu 404 |
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
