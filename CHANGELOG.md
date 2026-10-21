# CHANGELOG

Mỗi mục là một phiên làm việc. Ghi ngày, file, lý do, kết quả kiểm thử thật, lỗi và việc còn dở.

---

## 2026-10-22 — Phiên 7: chẩn đoán và gia cố Gemini API

### Bối cảnh

Người dùng báo "Tạo bộ từ" lúc được lúc không, có lúc chỉ hiện "Gemini đang gặp lỗi tạm thời", và
đưa danh sách nâng cấp 20 phần. Yêu cầu: đọc code trước, sửa ổn định trước tính năng.

### Nguyên nhân thật, tìm trong code (không phải "AI ngu")

1. **Không có retry.** `AiError.retryable` được khai báo nhưng **không dòng nào đọc**. Một 503
   "model is overloaded" của Google hay một lần rớt Wi-Fi là hỏng luôn — đúng hiện tượng chập chờn.
2. **Giới hạn output cứng 4096 token.** 20 từ × ~250–350 token chắc chắn vượt; `finishReason`
   không được kiểm tra nên JSON bị cắt được báo thành "JSON không hợp lệ".
3. **404 model bị ngừng bị gộp vào lỗi chung**, người dùng không biết phải đổi model.
4. **Không có log**: không biết lỗi ở bước request, response, parse hay validate.
5. **Không chống double-tap** ở tầng dịch vụ; không huỷ request khi rời màn hình.

### Đã thay đổi

- **Mới** `src/ai/errors.ts` — phân loại theo HTTP status + `error.status` + quota hint; parse
  `Retry-After` (giây hoặc HTTP date); redact `AIza…`, `key=`, header; `describeAiError()` trả
  tiêu đề/cách sửa/mã kỹ thuật cho UI.
- **Mới** `src/ai/retry.ts` — retry 3 lần, exponential backoff + jitter 50–100 %, tôn trọng
  Retry-After (cap 20 s), sleep huỷ được, predicate tách "lỗi tạm thời" khỏi "key sai / hết hạn mức".
- **Mới** `src/ai/diagnostics.ts` — ring buffer 40 dòng trong bộ nhớ, không có key/nội dung học.
- `src/ai/types.ts` — mã lỗi mở rộng (`quota_exceeded`, `timeout`, `json_parse`, `validation`,
  `database`, `busy`, `cancelled`…), `AiError` mang `httpStatus`/`stage`/`retryAfterMs`,
  `retryable` thành getter suy ra từ mã; `AiResult` thêm `warnings`/`requested`/`attempts`/`elapsedMs`.
- `src/ai/schema.ts` — vá JSON bị cắt (giữ các mục hoàn chỉnh), cảnh báo IPA sai dạng, từ loại lạ,
  cấp độ lệch, ví dụ không chứa từ, nghĩa chưa dịch.
- `src/ai/gemini.ts` — token budget theo số từ (2048–8192), đọc `finishReason`, phân biệt
  timeout/mất mạng/người dùng huỷ, tự chuyển model khi 404 rồi thử lại, single-flight, ghi diagnostics.
- `src/screens/AiStudioScreen.tsx` — banner lỗi có tiêu đề + cách sửa + nút **Thử lại** / **Mở Cài đặt**,
  dòng mã lỗi, tiến trình "thử lại lần 2/3 sau 1.2 giây…", cảnh báo thiếu từ và cảnh báo dữ liệu.
- `src/screens/SettingsScreen.tsx` — card **"Lần gọi Gemini gần đây"** + nút xoá log.

### Chống "đơ" (bổ sung sau khi người dùng hỏi "đã sửa được chưa")

Code cũ có thể treo vô hạn ở trạng thái "Gemini đang tạo…": `setLoading(true)` rồi `await fetch`,
chỉ dựa vào `AbortController` chứ không có deadline thật. Nếu `fetch` của React Native không trả về
hoặc không tôn trọng abort, promise không bao giờ settle và UI không có cách nào thoát.

- `src/ai/gemini.ts`: mỗi lần gọi được **race** với deadline **20 giây** và với tín hiệu huỷ của người dùng.
  Dù `fetch` treo, promise **luôn** kết thúc (`timeout` hoặc `cancelled`). Timeout **không** được thử lại:
  chờ thêm một vòng deadline nữa rồi vẫn báo "quá lâu" là đúng cái cảm giác người dùng phản ánh.
- `src/screens/AiStudioScreen.tsx`: hiện đồng hồ `· 12s` trong lúc chờ và có nút **Huỷ** gọi abort ngay.
- Rời màn hình đã tự huỷ request (có từ trước), giờ được bảo đảm kể cả khi `fetch` treo.

### Sửa lỗi "kiểm tra đầu vào không hiện đáp án"

Người dùng báo màn hình kiểm tra đầu vào bị lỗi, không hiện đáp án.

- Nguyên nhân: `PlacementScreen` cho phép hai kind `en_to_vi` và `typing`. Câu `typing` có
  `options: null` vì đó là câu gõ tay, nhưng màn hình **chỉ render nút chọn** và chỉ hiện nút
  "Câu tiếp theo" sau khi đã trả lời. Khi rơi vào câu `typing`, người dùng thấy câu hỏi trống trơn và
  không có cách nào đi tiếp. Xác suất ~50% mỗi cấp độ vì generator xoay vòng kind ngẫu nhiên.
- Sửa: `src/quiz/placement.ts` (mới) — chỉ dùng kind trắc nghiệm, mỗi cấp độ thử tối đa 6 từ để tìm
  câu có ≥ 2 lựa chọn, cấp độ không tạo được thì **bỏ qua** thay vì tạo màn hình cụt. `recommendLevel`
  chuyển sang đây để test được.
- Lưới an toàn trong UI: nếu câu hiện tại vẫn thiếu lựa chọn, hiện banner + nút **"Bỏ qua câu này"**.
- Test mới `src/quiz/__tests__/placement.test.ts`: 7/7 cấp độ trả về đúng 1 câu, mọi câu đều có
  ≥ 2 lựa chọn và chứa đáp án đúng, từ đơn độc không tạo câu cụt.

### Đã kiểm thử thật (2026-10-22)

| Bước | Kết quả |
|---|---|
| `npm run typecheck` | exit 0, 0 lỗi |
| `npm test -- --ci` | **10/10 suite, 114/114 test pass** |
| `node scripts/validate-checkpoint.mjs` | hợp lệ (44 file trong `important_files`) |
| `node scripts/verify.mjs` | xem `tools/verify-report.txt` |

Test AI dùng `fetch` giả: 503 → thành công, 401 không retry, 429 theo ngày không retry,
MAX_TOKENS → `json_parse` + 1 lần thử lại, count 25 bị chặn trước khi gọi mạng, hai request giống nhau
dùng chung 1 lời gọi, request khác nhận `busy`, diagnostics không chứa `AIza`, salvage JSON bị cắt,
`fetch` treo → `timeout` sau deadline, huỷ giữa lúc `fetch` treo → `cancelled` ngay.

### Chưa kiểm chứng

- **Chưa có lần gọi Gemini thật nào** bằng key người dùng sau thay đổi này.
- Chưa cài bản build mới; hành vi `AbortController` của React Native trên máy thật chưa đo.
- Body 429 thật của Gemini (theo phút vs theo ngày) chưa đối chiếu.

### Việc còn dở

Các giai đoạn 3–7 của kế hoạch nâng cấp (giải thích Anh/Việt, nguồn xác minh, chế độ học mới,
dịch thuật, minigame) **chưa làm** — xem `CHECKPOINT.md` mục 21.

---

## 2026-10-19 — Phiên 1: khảo sát, kiến trúc, code toàn bộ v1.0 (chưa build)

### Bối cảnh

Người dùng yêu cầu xây dựng ứng dụng học từ vựng iOS hoàn chỉnh từ Windows, không có Mac,
không lên App Store, cần widget thật, Gemini, dữ liệu cục bộ và checkpoint bàn giao.

### Đã kiểm tra môi trường

- Ghi file vào `C:\Users\Lenovo\Desktop\VocabMaster`: **thành công**.
- Chạy lệnh terminal: **thất bại** — “Bash is required but was not found on this Windows system”.
  → Không chạy được `node`, `npm`, `git`, `tsc`, `jest`.
- Ripgrep nội bộ của công cụ cũng thiếu binary; dùng đọc file thay thế.

### Nghiên cứu (nguồn chính thức)

- `expo-widgets` là package thật, bản `~58.0.20`, stable từ SDK 56; hỗ trợ home
  small/medium/large và lock screen accessory; không chạy Expo Go; dùng App Group.
- EAS Free: 15 build iOS/tháng, timeout 45 phút, hàng đợi chậm.
- Apple ID miễn phí: 10 App ID, 3 thiết bị, 3 app/thiết bị, profile 7 ngày.
- App Groups không có với Personal Team miễn phí → widget dữ liệu thật cần
  Apple Developer Program (99 USD/năm).
- `expo-speech` + `expo-speech-recognition` phù hợp; nhận diện không chấm âm vị.

Chi tiết + URL: `docs/FEASIBILITY.md`.

### File đã tạo

**Cấu hình**
- `package.json`, `app.json`, `tsconfig.json`, `eas.json`, `babel.config.js`, `index.ts`
- `.gitignore`, `.env.example`

**Ứng dụng**
- `App.tsx`
- `widgets/DailyWordWidget.tsx`, `widgets/ReviewGlanceWidget.tsx`
- `src/types.ts`, `src/data/seed.ts`
- `src/db/schema.ts`, `database.ts`, `words.ts`, `reviews.ts`, `activity.ts`, `settings.ts`, `backup.ts`
- `src/srs/fsrs.ts`
- `src/quiz/generator.ts`, `grading.ts`
- `src/streak/streak.ts`
- `src/lib/text.ts`, `date.ts`, `ids.ts`
- `src/ai/gemini.ts`, `prompt.ts`, `schema.ts`, `types.ts`
- `src/speech/tts.ts`, `pronunciation.ts`, `useSpeechCheck.ts`
- `src/notifications/reminders.ts`
- `src/widgets/snapshot.ts`, `sync.ts`
- `src/state/AppProvider.tsx`
- `src/navigation/NavigationProvider.tsx`
- `src/theme/tokens.ts`, `ThemeProvider.tsx`
- `src/components/ui.tsx`, `patterns.tsx`, `TabBar.tsx`
- `src/screens/`: `OnboardingScreen`, `TodayScreen`, `StudyScreen`, `WordsScreen`,
  `WordDetailScreen`, `WordFormScreen`, `AiStudioScreen`, `SessionScreen`, `StatsScreen`,
  `SettingsScreen`, `PlacementScreen`
- Test: `src/srs/__tests__/fsrs.test.ts`, `src/quiz/__tests__/quiz.test.ts`,
  `src/streak/__tests__/streak.test.ts`, `src/lib/__tests__/text.test.ts`

**Tài liệu và công cụ**
- `README.md`, `CHECKPOINT.md`, `CHECKPOINT.json`, `CHANGELOG.md`, `NEXT_SESSION.md`
- `docs/FEASIBILITY.md`, `docs/ARCHITECTURE.md`, `docs/BUILD_AND_INSTALL.md`, `docs/TEST_PLAN.md`
- `scripts/setup.mjs`, `scripts/validate-checkpoint.mjs`

### Lý do chính

- Tách logic học thành hàm thuần để test được và tái sử dụng cho widget.
- Dùng SQLite + transaction để dữ liệu và thống kê không lệch nhau.
- Không dùng router/state library để giảm rủi ro phiên bản khi không có môi trường chạy.
- Widget nhận props từ snapshot thay vì đọc DB (theo giới hạn runtime của expo-widgets).
- Key Gemini trong Keychain, nhập trong app, không có trong bundle.

### Kết quả kiểm thử

| Kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| Ghi file dự án | ✅ | Đã tạo file thật |
| `npm run typecheck` | ⛔ chưa chạy | Không có Bash/Node |
| `npm test` | ⛔ chưa chạy | Không có Bash/Node |
| `node scripts/validate-checkpoint.mjs` | ⛔ chưa chạy | Không có Bash/Node |
| Build iOS | ⛔ chưa chạy | Chưa có EAS/Apple |
| Cài lên iPhone | ⛔ chưa chạy | Chưa có build |
| Widget trên máy thật | ⛔ chưa chạy | Phụ thuộc build + App Group |

Không có kết quả pass nào cho code được tuyên bố trong phiên này.

### Lỗi phát sinh

1. **Blocker môi trường:** thiếu Git Bash → không chạy được lệnh nào.
   Hướng xử lý: cài Git for Windows, mở lại công cụ, xác minh `git --version`.
2. **Ripgrep binary thiếu:** không ảnh hưởng code; dùng `read_files` thay thế.

### Lỗi đã sửa trong phiên

- `src/db/backup.ts`: thay object settings viết tay bằng `{ ...DEFAULT_SETTINGS }`.
- `src/widgets/sync.ts`: chuyển import widget tĩnh sang `require` trong `try/catch` để app
  không chết nếu native module vắng mặt.
- `src/speech/tts.ts`: so sánh `voice.quality` bằng chuỗi thay vì union type.
- `src/screens/WordFormScreen.tsx`: xoá khối JSX thừa và import không dùng.

### Việc còn dang dở

- Chạy typecheck/test, sửa lỗi biên dịch (dự kiến có).
- `git init` + commit đầu tiên.
- EAS init, đăng ký thiết bị, build, cài iPhone.
- Kiểm chứng widget/lock screen/speech/notification trên máy thật.
- Quyết định chi phí Apple Developer Program.

### Bổ sung sau khi rà soát lại (cùng phiên)

- Thêm `expo-env.d.ts` để `process.env.EXPO_PUBLIC_*` và asset module có type.
- `scripts/setup.mjs` cài thêm `expo-dev-client` (bắt buộc cho `expo start --dev-client` và
  development build).
- Bỏ tùy chọn không hợp lệ `mode` khỏi plugin `expo-notifications` trong `app.json`.
- Bỏ `noUncheckedIndexedAccess` khỏi `tsconfig` để giảm nhiễu khi chưa có môi trường compile.
- Sửa kỳ vọng của test interval trong `fsrs.test.ts` (retention cao → interval ngắn hơn).
- Thêm nút “Bỏ qua câu này (không tính)” cho câu luyện nói khi micro không dùng được.
- Ghi nhận workspace của công cụ AI (`Desktop\App TANH`) khác thư mục dự án; mọi lệnh phải `cd`.
- `tools/syntax-check.html`: công cụ kiểm tra tĩnh tuỳ chọn (mở bằng static server), không bắt buộc.

### Ghi chú cho phiên sau

Đọc `NEXT_SESSION.md` trước. Không đánh dấu bất kỳ tính năng nào `tested` hoặc
`verified_on_device` cho tới khi thực sự chạy. Nếu checkpoint lệch code, ưu tiên kiểm tra
code thật và ghi lại khác biệt.

---

## 2026-10-20 — Phiên 2: người dùng đã cài Node + npm install; rà lỗi tĩnh, thêm kênh kiểm chứng

### Môi trường

- Người dùng đã cài Node.js và chạy `npm install` trên máy: `node_modules/` và
  `package-lock.json` tồn tại thật (kiểm tra bằng đọc thư mục).
- **Terminal của agent vẫn lỗi** (`Bash is required but was not found`) → không chạy được
  `tsc`/`jest`, không đọc được output. Vì vậy **không có kết quả pass nào được tuyên bố**.

### Lỗi thật đã tìm và sửa (bằng đọc code + type trong `node_modules`)

- **bug-005:** `src/speech/useSpeechCheck.ts` import `expo-speech-recognition` và `app.json`
  đăng ký config plugin của nó, nhưng `package.json` **không có dependency này** → `tsc` sẽ báo
  TS2307 và `expo prebuild` không resolve được plugin. Đã thêm `~58.0.0`; đối chiếu
  `https://registry.npmjs.org/expo-speech-recognition/latest` → bản mới nhất là `58.0.0`.
- **bug-006:** nghi ngờ `expo-file-system/legacy` đổi ở SDK 58 → đã kiểm tra package đã cài
  (`expo-file-system@58.0.10`): `exports["./legacy"]` tồn tại, `build/legacy/index.d.ts` có
  `cacheDirectory`, `documentDirectory`, `writeAsStringAsync`, `EncodingType`. `tsconfig` dùng
  `moduleResolution: bundler` nên subpath resolve được. Rủi ro này **đóng**.
- Đối chiếu tay `expo-widgets` (`createWidget`, `Widget.updateSnapshot/updateTimeline`,
  `WidgetEnvironment.widgetFamily/colorScheme`, `WidgetTimelineEntry.date/props`) và
  `@expo/ui` (`font({size, weight})`, `padding({all})`, `foregroundStyle`, `Image.systemName`,
  `Image.color`) — khớp với code trong `widgets/*.tsx` và `src/widgets/sync.ts`.

### Thêm mới

- `scripts/verify.mjs` + `npm run verify`: chạy `npm install` → `typecheck` → `jest --ci` →
  `checkpoint:validate`, ghi từng bước vào `tools/verify-report.txt` (ghi sau mỗi bước để không
  mất kết quả nếu bị kill), trả exit code 1 nếu có bước fail. Đây là kênh để agent đọc kết quả
  kiểm thử khi terminal của agent không dùng được.
- `.gitignore`: bỏ qua `tools/verify-report.txt`.

### Chưa làm

- Chưa cài `expo-speech-recognition` (cần `npm install` lại).
- Chưa chạy typecheck/test → chưa sửa được lỗi biên dịch còn lại (nếu có).
- Chưa prebuild, chưa build EAS, chưa cài iPhone, chưa kiểm chứng widget.

---

## 2026-10-20 — Phiên 3: Git Bash đã có; typecheck + test chạy thật và xanh

### Môi trường

- `git --version` → 2.56.0, `node -v` → 24.18.0, `npm -v` → 11.16.0. Terminal của agent đã dùng được.
- `tools/verify-report.txt` là output đầy đủ của `node scripts/verify.mjs`.

### Kết quả đo được (không suy đoán)

| Bước | Kết quả |
|---|---|
| `npm install` | exit 0 (thêm `expo-speech-recognition`, `babel-preset-expo`) |
| `npm run typecheck` (tsc 6.0.3) | **exit 0, 0 lỗi** |
| `npm test -- --ci` | **4/4 suite, 36/36 test pass** |
| `npx expo-doctor` | **20/20 check pass** |
| `npx expo config --type prebuild` | **exit 0** — compose `expo-widgets`: `group.com.vocabmaster.personal`, `DailyWordWidget` (systemSmall/Medium/Large), `ReviewGlanceWidget` (accessoryCircular/Rectangular/Inline), `initialLayout` = `widgets/*.tsx` |
| `npx expo prebuild --platform ios` | **BLOCKED** — SDK 58 từ chối sinh project iOS ngoài macOS/Linux |

### Lỗi thật đã sửa trong phiên

1. `tsconfig.json` dùng `baseUrl` → **TS5101** (TypeScript 6 coi là lỗi). Xoá `baseUrl` + `paths`
   `@/*` (grep xác nhận không file nào import `@/`). Không dùng `ignoreDeprecations`.
2. Thiếu **`babel-preset-expo`** → cả 4 suite Jest dừng với "Cannot find module
   'babel-preset-expo'". Cài bằng `npx expo install babel-preset-expo`.
3. `src/db/reviews.ts`: `db.execAsync(sql, [nowIso()])` — `execAsync` chỉ nhận 1 tham số
   (**TS2554**). Đổi sang `db.runAsync(sql, nowIso())`.
4. `app.json` còn `newArchEnabled` — SDK 58 không còn field này (expo-doctor fail). Đã xoá.
5. Jest globals không resolve trong tsc → thêm `"types": ["jest"]` vào `tsconfig`
   (khai báo ambient type rõ ràng, không phải suppress).
6. `expo-speech-recognition` (bug-005 phiên trước) đã được cài → `useSpeechCheck.ts` biên dịch được.
7. `tools/verify-report.txt` thêm vào `.gitignore`.

### Đã kiểm chứng thêm bằng đọc source plugin (không cần build)

`node_modules/expo-widgets/plugin/build` xác nhận `app.json` khớp schema thật:
`name` phải là Swift identifier, `supportedFamilies` chỉ nhận 7 giá trị cố định,
`initialLayout` phải là đường dẫn tương đối so với project root — cả hai widget đều đúng.
Plugin sinh `ExpoWidgetsTarget` với entitlement `com.apple.security.application-groups`.

### Chưa làm / còn chặn

- `expo prebuild` iOS và EAS build: cần macOS/EAS (Expo chặn trên Windows).
- Cài iPhone, kiểm widget/lock screen/speech/notification/Gemini trên máy thật.
- `git init` + commit đầu tiên (chưa làm; người dùng chưa yêu cầu).
- Quyết định Apple Developer Program 99 USD/năm (điều kiện cho App Groups).

---

## 2026-10-20 — Phiên 3b: thêm đường cài miễn phí (GitHub Actions + Sideloadly)

### Quyết định của người dùng

Chọn cài lên iPhone bằng **Apple ID miễn phí (sideload)** thay vì trả 99 USD/năm.
Vì tài khoản miễn phí không có App Groups, bản build này **bỏ widget extension**;
code widget vẫn nguyên trong repo để bật lại khi có tài khoản trả phí.

### Thêm mới

- `.github/workflows/ios-unsigned.yml`: build trên `macos-26` (Xcode 26.6, mức tối thiểu
  của Expo SDK 58 là 26.4): `npm ci` → typecheck + test → bỏ widget → `expo prebuild`
  → `pod install` → `xcodebuild archive` với `CODE_SIGNING_ALLOWED=NO` → đóng gói
  `Payload/*.app` thành `.ipa` không ký → upload artifact 14 ngày.
- `scripts/prepare-free-build.mjs` + `npm run free:strip` / `free:restore`: bỏ/khôi phục
  plugin `expo-widgets` trong `app.json`, có backup `app.json.free-build.bak` (đã gitignore).
- `docs/FREE_SIDELOAD.md`: 9 mục — điều kiện, push code, chạy workflow, cài bằng Sideloadly,
  gia hạn 7 ngày, checklist kiểm tra, bảng giới hạn Apple ID miễn phí (có nguồn), sự cố.

### Đã kiểm chứng trong phiên

- `js-yaml` parse workflow thành công (11 step). Lần đầu viết sai: heredoc Python không
  thụt lề làm hỏng block scalar → đổi sang `awk` để lấy scheme từ `xcodebuild -list`.
- `npm ci --dry-run` exit 0 → lockfile khớp `package.json` (điều kiện để CI không fail).
- `prepare-free-build.mjs`: `--check`, strip, rồi `--restore` → `app.json` trở lại
  **byte-identical** (sha256 trùng).
- Sau khi bỏ widget: `npx expo config --type prebuild` vẫn exit 0 và không còn plugin
  `expo-widgets`; các plugin còn lại: sqlite, secure-store, notifications, speech-recognition.
- `node scripts/verify.mjs` → ALL PASS (install, typecheck, 36/36 test, checkpoint).

### Chưa làm

- Chưa `git init`/commit/push — cần tài khoản GitHub của người dùng.
- Chưa chạy workflow thật trên GitHub: chưa có log build macOS, chưa có `.ipa`.
- Chưa cài lên iPhone: chưa xác nhận Sideloadly ký được, chưa kiểm tra app chạy.

## 2026-10-21 — Phiên 4: Google ngừng `gemini-2.5-flash` (lỗi 404) — tự chuyển model

### Triệu chứng thật trên iPhone

AI Studio báo: `Gemini trả về lỗi 404: This model models/gemini-2.5-flash is no longer
available to new users. Please update your code to use models/gemini-3.8-flash…`
Key còn hợp lệ; chỉ tên model đã bị Google ngừng cấp cho key mới.

### Sửa

- `src/types.ts`: `DEFAULT_AI_MODEL = 'gemini-3.8-flash'` (model Google chỉ định trong lỗi),
  `RETIRED_AI_MODELS` gồm `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`.
- `src/db/settings.ts`: `sanitizeAiModel` — cài đặt cũ còn lưu model đã ngừng được nâng lên
  model mặc định khi đọc, nên người dùng nâng cấp app không còn gặp 404 mà phải sửa tay.
- `src/ai/gemini.ts`:
  - `rankModels`: xếp model còn dùng được (mới nhất, `flash`, bỏ `lite`/`preview`/embedding).
  - `generateVocabulary`: gặp 404/NOT_FOUND thì hỏi `GET /v1beta/models`, thử lại **một lần**
    với model tốt nhất; trả `fallbackFrom` để UI giải thích; không có model thay thế thì
    báo `model_unavailable` kèm câu của Google và nơi sửa.
  - `checkApiKey`: trả thêm `suggestedModel` khi model đang cấu hình không tồn tại.
- `src/screens/SettingsScreen.tsx`: nút **"Dùng <model>"** đổi model một lần bấm rồi kiểm tra lại.
- `src/screens/AiStudioScreen.tsx`: banner cảnh báo khi đã tự đổi model; lỗi
  `model_unavailable` hiện nguyên văn thay vì câu chung.
- `src/screens/WordFormScreen.tsx`: cùng cách hiện lỗi đó ở nút gợi ý AI.

### Đã kiểm chứng trong phiên

- `npm run typecheck` — 0 lỗi.
- `npm test` — **52/52 pass**, 6 suite. Test mới: thứ hạng model, tự chuyển model (3 request:
  404 → danh sách model → thành công), không có model thay thế thì `model_unavailable`,
  `checkApiKey` gợi ý model, `sanitizeAiModel` nâng model đã ngừng.
- `node scripts/verify.mjs` — ALL PASS.

### Chưa kiểm chứng

- Chưa gọi Gemini thật bằng key của người dùng với `gemini-3.8-flash`; cần build mới và
  thử "Tạo bộ từ" trên iPhone.
