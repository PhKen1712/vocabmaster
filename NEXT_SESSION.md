# NEXT SESSION — bắt đầu từ đây

## 1. Dự án đang ở đâu

- **Đã xanh (chạy thật ngày 2026-10-24):** `npx tsc --noEmit` exit 0 (0 lỗi),
  `npx jest --runInBand` **242/242 test pass trong 22 suite**,
  `node scripts/verify.mjs` **ALL PASS** (gồm `checkpoint:validate`).
- **Mới nhất (2026-10-24):** **Groq là AI mặc định**; **nhạc nền** 5 bản tự tạo với thư viện chọn bài,
  mute, âm lượng và ducking khi phát âm (`src/music/*`); **ba game** — bắn thiên thạch, 60 giây, ghép
  cặp (`src/games/*`, `src/screens/*GameScreen.tsx`, tab Chơi); **sáu dạng luyện kỹ năng** trên tab
  Học (`config.kinds`); **xu ảo** với ledger schema v3, hệ số theo chuỗi và nút reset có xác nhận
  (`src/coins/*`); **khôi phục chuỗi** một ngày bằng gấp đôi từ mới (`src/streak/streak.ts`,
  `src/db/streakRestore.ts`); **chọn giọng nam/nữ** (`src/speech/voices.ts`) và **phòng luyện phát âm**
  (`PronunciationScreen`); chấm **synonym** cho câu gõ từ.
  Đọc `CHANGELOG.md` mục 2026-10-24 trước khi sửa.
- **Nền cũ (2026-10-23):** Groq là provider thứ hai, key/model riêng; cấp độ CEFR tự tra khi dán
  danh sách; schema v2 (dictionary cache). Đọc thêm `docs/DICTIONARY.md` và `docs/WORD_BANK.md`.
- **Đã xác nhận bởi người dùng (2026-10-23):** **Groq chạy mượt và kết quả tốt** trên iPhone
  (báo trong chat; không có build number/log/số liệu latency hay hạn mức).
- **Chưa chạy:** toàn bộ tính năng 2026-10-24 trên iPhone (nhạc, game, micro, giọng nam/nữ, xu,
  khôi phục chuỗi); gọi Gemini thật bằng key người dùng; `expo prebuild` cho iOS (Expo chặn trên
  Windows); EAS build; kiểm chứng widget/speech/notification trên máy thật.
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
8. `docs/DICTIONARY.md` — endpoint đã kiểm chứng, JSON thật, quy tắc ghi công, giới hạn và bảng test.

## 3. Lệnh kiểm tra (chạy đầu tiên mỗi phiên)

```bash
git --version && node --version && npm --version
cd "C:/Users/Lenovo/Desktop/VocabMaster"
node scripts/verify.mjs        # install + typecheck + jest --ci + validate, ghi tools/verify-report.txt
```

`verify.mjs` trả exit 0 khi mọi bước pass và ghi report sau từng bước (kể cả khi bị kill).
Nếu report ghi fail, đọc đúng lỗi đầu tiên rồi sửa — đừng chạy `npm install` mù quáng.

## 4. Việc ưu tiên tiếp theo

0. ~~Thử Groq thật~~ — **đã xong 2026-10-23**. Groq cũng đã thành mặc định cho bản cài mới
   (`DEFAULT_SETTINGS.aiProvider = 'groq'`, settings cũ thiếu trường cũng nhận Groq; ai đã chọn
   Gemini vẫn giữ nguyên).
1. **Build bản 2026-10-24** (workflow macOS), tải `.ipa` và cài đè (`docs/FREE_SIDELOAD.md`).
   Sau khi cài, kiểm nhanh các tính năng mới:
   - **Nhạc**: Chơi → Nhạc nền → chọn bài, mute, kéo âm lượng, thoát app và mở lại xem còn nhớ không;
     phát âm một từ và nghe nhạc nhỏ lại rồi trở lại.
   - **Game**: Bắn thiên thạch — gõ đúng/sai, để một thiên thạch chạm đáy, tạm dừng, thoát giữa chừng;
     kiểm 60 giây và ghép cặp trên màn hình nhỏ.
   - **Xu**: học một từ mới đúng → thấy +xu; ôn sai → thấy trừ và số dư không âm; Cài đặt → Kinh tế →
     Reset tiền xu (phải có hộp thoại xác nhận).
   - **Khôi phục chuỗi**: giả lập bằng cách đổi ngày máy hoặc dùng dữ liệu cũ; chỉ cứu được khi đủ
     gấp đôi từ mới, và hệ số xu phải về 1,0 sau khi cứu.
   - **Giọng/phát âm**: đổi Nữ/Nam và Anh–Anh/Anh–Mỹ, nghe thử; mở một từ → Kiểm tra phát âm,
     thử cả khi từ chối quyền micro.
2. **Kiểm lại hai chế độ tạo từ trên build mới** (nếu chưa kiểm ở bản trước):
   - **Tạo bộ từ → AI chọn từ** (Cài đặt → "Kiểm tra key + model" trước).
   - **Tạo bộ từ → Nhập danh sách từ**: dán `criminal, civil, justice, evidence` **và một từ lạ
     ngoài kho (ví dụ `quixotic`)**, xem tiến trình, nghĩa Việt, IPA, **cấp độ riêng của từng thẻ**
     ("có sẵn" / "AI ước lượng" / "chưa rõ cấp độ"), dòng "Thiếu: …"; thử tắt Wi-Fi cho một từ chưa
     tra để thấy lỗi mạng, rồi bật lại bấm "Thử lại từ lỗi" (các từ đã tra phải còn nguyên).
   Ghi kết quả thật vào `CHECKPOINT.json → test_results.device_tests`.
3. **Quyết định Apple Developer Program.** Không có nó thì widget chỉ render placeholder
   vì không có App Group để chia sẻ dữ liệu.
4. **`eas init` + development build.** EAS chạy prebuild trên macOS; sau build kiểm tra:
   - có target `ExpoWidgetsTarget` với `DailyWordWidget` + `ReviewGlanceWidget`
   - entitlement `com.apple.security.application-groups` = `group.com.vocabmaster.personal`
   - `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` có trong Info.plist
5. **Cài lên iPhone, kiểm theo `docs/TEST_PLAN.md`** — ưu tiên 2.3 (buổi học) và 2.6 (widget).
6. **Ghi kết quả thật** vào `CHECKPOINT.json → test_results.device_tests` và `CHANGELOG.md`.
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
| AI (Gemini/Groq) | `src/ai/gemini.ts`, `src/ai/groq.ts`, `src/ai/index.ts` |
| Cấp độ tự tra | `src/ai/levels.ts`, `packLevel` trong `src/data/packs.ts` |
| Chọn nhà cung cấp / key | `src/ai/provider.ts`, `src/screens/SettingsScreen.tsx` |
| Widget | `widgets/*.tsx`, `src/widgets/*` |
| Giao diện | `src/screens/*`, `src/components/*`, `src/theme/*` |
| Điều hướng | `src/navigation/NavigationProvider.tsx`, `App.tsx` |
| Kiểm thử tự động | `scripts/verify.mjs`, `src/**/__tests__/*.test.ts` |

## 8. Định nghĩa "xong" cho phiên tới

- `node scripts/verify.mjs` exit 0 (đang đạt).
- `git log` có ít nhất 1 commit sạch, không secret.
- EAS build cài được lên iPhone; ít nhất widget Home Screen hiển thị đúng dữ liệu thật.
- Nếu chưa có tài khoản Apple: ghi rõ `blocked`, không tuyên bố hoàn thành.
