# CHECKPOINT — VocabMaster

- **checkpoint_version:** 1
- **last_updated:** 2026-10-20
- **current_phase:** Giai đoạn 1–6 (code đã viết) — **typecheck + 36 unit test đã chạy và xanh**; chưa build iOS, chưa kiểm chứng thiết bị
- **project_path:** `C:\Users\Lenovo\Desktop\VocabMaster`
- **current_branch / commit:** chưa có Git repository (chưa chạy `git init`)

> Đọc mục 13–14 trước khi tin bất kỳ tính năng nào. Code có mặt + test xanh vẫn không có nghĩa
> là đã chạy trên iPhone: widget, micro, thông báo và Gemini **chưa được kiểm chứng thiết bị**.

---

## 1. Tên dự án và mục tiêu

**VocabMaster** — ứng dụng học từ vựng tiếng Anh dùng cá nhân trên iPhone, lấy cảm hứng từ
eJOY nhưng có thiết kế và hệ thống học riêng. Mục tiêu: học từ mất gốc đến nâng cao, tách
General English và IELTS, ôn tập cách quãng, phát âm, streak, nhắc nhở, **widget iOS thật**
trên màn hình chính và màn hình khóa, gợi ý từ bằng Gemini, dữ liệu cục bộ bền vững và
checkpoint đủ tốt để AI khác tiếp tục.

## 2. Đối tượng sử dụng và yêu cầu cốt lõi

- Một người dùng, không cần tài khoản, không server.
- Windows để phát triển; iPhone iOS 18+ để dùng; không có Mac; không lên App Store.
- Ưu tiên miễn phí; chấp nhận chi phí chỉ khi bắt buộc và phải nói rõ.
- Bắt buộc: widget thật (không phải PWA), dữ liệu widget là dữ liệu học thật, AI không bắt buộc
  để học, dữ liệu không mất, có checkpoint.

## 3. Môi trường phát triển

| Thành phần | Giá trị / trạng thái |
|---|---|
| Hệ điều hành | Windows (theo mô tả người dùng) |
| Thư mục dự án | `C:\Users\Lenovo\Desktop\VocabMaster` (đã ghi file thật) |
| Workspace của công cụ AI | `C:\Users\Lenovo\Desktop\App TANH` — **khác** thư mục dự án. Mọi lệnh terminal phải `cd` vào đường dẫn dự án; preview/reveal của công cụ không trỏ tới project này |
| Terminal | **Dùng được** từ 2026-10-20 (người dùng đã cài Git for Windows) |
| Node.js / npm / Git | **Đã xác minh**: Node 24.18.0, npm 11.16.0, git 2.56.0 |
| Expo SDK mục tiêu | 58 (`expo ~58.0.16` sau `expo install`) |
| React Native | 0.88.0 |
| React | 19.3.0 |
| TypeScript | ~6.0.3 |
| expo-widgets | ~58.0.21 (stable từ SDK 56) |
| @expo/ui | ~58.0.20 |
| expo-speech-recognition | ~58.0.0 |
| iOS mục tiêu | 18+ |
| Apple Developer Program | **Chưa có** (cần cho App Groups/widget dữ liệu thật) |
| EAS account | Chưa tạo/chưa đăng nhập |

## 4. Kiến trúc tổng thể

```
App.tsx (SafeAreaProvider → AppProvider → ThemeProvider → NavigationProvider)
  ├─ Screens: Today, Study, Words, Stats, Settings, WordDetail, WordForm, AiStudio, Session, Placement, Onboarding
  ├─ Domain: types, lib (pure)
  ├─ Data: expo-sqlite + migrations + repositories + backup
  ├─ Engine: FSRS + quiz generator/grading + streak (pure, testable)
  ├─ AI: Gemini REST + Keychain key + validate/lookup
  ├─ Speech: expo-speech (TTS) + expo-speech-recognition (word-match only)
  └─ Widgets: expo-widgets SwiftUI + App Group + snapshot sync
```

Chi tiết: `docs/ARCHITECTURE.md`.

## 5. Công nghệ và lý do

| Công nghệ | Lý do | Rủi ro |
|---|---|---|
| Expo SDK 58 + RN 0.88 | Chạy trên Windows, build cloud, native module phong phú | Cần Node đúng phiên bản |
| expo-widgets | WidgetKit thật, TS + SwiftUI components, home + lock screen | API còn mới, chưa build thử |
| expo-sqlite | Offline, transaction, migration | Không có |
| FSRS tự viết | Kiểm soát, test được, không dependency | Cần test kỹ |
| expo-secure-store | Key trong Keychain, không hardcode | Jailbreak có thể lộ |
| expo-speech | TTS miễn phí, on-device | Giọng phụ thuộc máy |
| expo-speech-recognition | Speech framework, on-device | Chỉ transcript/confidence, **không chấm âm vị** |
| EAS Build | macOS cloud, gói free 15 build iOS/tháng | Hàng đợi chậm |
| Không dùng router/state library | Giảm dependency, tránh lệch phiên bản | Tự viết navigator nhỏ |

## 6. Cấu trúc thư mục và file quan trọng

```
VocabMaster/
├── App.tsx                      # providers + router + tab bar
├── app.json                     # bundle id, widget plugin, quyền micro
├── eas.json                     # development/preview/production
├── index.ts / babel.config.js / tsconfig.json / package.json
├── widgets/
│   ├── DailyWordWidget.tsx      # home small/medium/large
│   └── ReviewGlanceWidget.tsx   # lock screen accessory
├── src/
│   ├── types.ts                 # domain types + DEFAULT_SETTINGS
│   ├── data/seed.ts             # 40 từ khởi tạo
│   ├── db/
│   │   ├── schema.ts            # DDL, mapper, migrations
│   │   ├── database.ts          # open, migrate, seed, reset
│   │   ├── words.ts             # CRUD, search, counts, study plan
│   │   ├── reviews.ts           # recordReview transaction
│   │   ├── activity.ts          # stats, streak, accuracy
│   │   ├── settings.ts          # load/save/sanitize
│   │   └── backup.ts            # JSON backup, CSV import/export
│   ├── srs/fsrs.ts              # FSRS-5
│   ├── quiz/generator.ts        # 9 dạng câu hỏi
│   ├── quiz/grading.ts          # chấm điểm, near-miss
│   ├── streak/streak.ts         # streak thuần
│   ├── ai/{gemini,prompt,schema,types}.ts
│   ├── speech/{tts,pronunciation,useSpeechCheck}.ts
│   ├── widgets/{snapshot,sync}.ts
│   ├── notifications/reminders.ts
│   ├── state/AppProvider.tsx
│   ├── navigation/NavigationProvider.tsx
│   ├── theme/{tokens,ThemeProvider}.tsx
│   ├── components/{ui,patterns,TabBar}.tsx
│   └── screens/*.tsx            # 11 màn hình
├── scripts/{setup.mjs,validate-checkpoint.mjs}
├── docs/{FEASIBILITY,ARCHITECTURE,BUILD_AND_INSTALL,TEST_PLAN}.md
└── CHECKPOINT.md / CHECKPOINT.json / CHANGELOG.md / NEXT_SESSION.md / README.md
```

## 7. Chức năng đã viết code (implemented)

Trạng thái chính xác: **implemented cho toàn bộ; phần logic lõi (FSRS, quiz, streak, text, DB
schema) ở mức tested qua unit test; không có gì verified_on_device**.

- SQLite schema v1 + migration transaction + seed 40 từ (20 General, 20 IELTS).
- CRUD từ vựng, tìm kiếm, yêu thích, chống trùng theo `(term, track)`, cảnh báo trùng chéo track.
- Nhập CSV (header linh hoạt, ngoặc kép, lỗi từng dòng), xuất CSV, xuất/khôi phục JSON
  (merge/replace, transaction, giữ dữ liệu khi lỗi).
- FSRS-5: bước học đầu, interval theo retention, lapse, same-day, clamp.
- Sinh 9 dạng câu hỏi từ dữ liệu thật; chống trùng đáp án; fallback gõ từ khi thiếu distractor;
  cloze chỉ khi câu ví dụ chứa từ.
- Chấm điểm bỏ qua hoa/thường, dấu câu, khoảng trắng; near-miss; chấp nhận “to + verb”.
- Buổi học: tiến độ, phản hồi, tự đánh giá Lại/Khó/Nhớ/Dễ, lưu transaction, làm lại từ sai.
- Hai track + 7 cấp độ, mục tiêu ngày, kiểm tra đầu vào 6 câu (gợi ý, bỏ qua được).
- Gợi ý điều chỉnh độ khó dựa trên accuracy 7 ngày (tăng/giảm 1 cấp, người dùng bấm xác nhận).
- Streak theo ngày đạt mục tiêu, có ân hạn trước nửa đêm, best streak, lịch sử hoạt động.
- Thống kê: streak, accuracy 7 ngày, 14 ngày hoạt động, phân bố cấp độ, trạng thái ghi nhớ, từ hay sai.
- TTS en-US/en-GB, đọc từ và câu ví dụ.
- Luyện nói: nhận diện giọng nói, ưu tiên on-device, so khớp từ + confidence; **không** chấm âm vị.
- Gemini: tạo bộ từ theo track/level/topic/count/focus, tránh từ đã có, validate từng trường,
  preview + sửa + chọn trước khi lưu, xử lý lỗi 401/403/429/5xx/mạng/timeout.
- Gợi ý chi tiết cho một từ cụ thể trong biểu mẫu (lookupTerm).
- Key Gemini trong Keychain, không log, không backup, có xoá key.
- Widget: 2 kind (home 3 size, lock screen 3 family), snapshot + timeline, sync sau mỗi thay đổi
  và khi app foreground, lỗi được nuốt an toàn.
- Nhắc nhở hằng tuần theo giờ/ngày, xin quyền, huỷ và lên lịch lại.
- Light/dark/system theme, design tokens dùng chung.
- Onboarding, cài đặt, sao lưu, reset có xác nhận 2 lớp.
- 4 bộ unit test (FSRS, quiz, streak, text).
- Checkpoint + script setup + script validate.

## 8. Chức năng mới làm một phần

| Chức năng | Đã có | Còn thiếu |
|---|---|---|
| Widget | UI, snapshot, sync, config plugin | Build native, App Group thật, kiểm chứng máy thật |
| Luyện nói | Thu transcript, so khớp từ, hiển thị confidence | Chấm âm vị/trọng âm (không có công nghệ miễn phí phù hợp) |
| Âm thanh từ | TTS on-device cho từ và câu | Audio thu sẵn theo từ điển (`audio_url` có trường nhưng chưa dùng) |
| Kiểm tra đầu vào | 6 câu, gợi ý cấp độ | Chưa hiệu chỉnh độ khó, chưa lưu lịch sử bài test |
| Deep link widget | Chạm widget mở app | Chưa điều hướng tới màn hình cụ thể (expo-widgets không nêu API) |
| Backup | JSON/CSV, merge/replace | Chưa tự động backup định kỳ |
| Nhập hàng loạt | CSV | Chưa có preview trước khi nhập (hiện nhập rồi báo tổng kết) |

## 9. Chức năng chưa làm

- Build iOS thật, cài lên iPhone, thêm widget trên máy.
- Chạy typecheck/unit test (chưa có môi trường).
- Git repository + commit đầu tiên.
- EAS project (`eas init`), đăng ký thiết bị.
- Đồng bộ nhiều thiết bị / cloud.
- Android.
- Nhắc nhở thông minh theo giờ rảnh, badge số từ.
- Widget interactive (nút “học tiếp” trong widget).
- Âm thanh từ điển có license rõ ràng (dictionaryapi.dev/Wiktionary) — cố ý chưa tích hợp
  để giữ offline và tránh vấn đề bản quyền.
- Bài test tổng hợp theo chủ đề có tính điểm/ghi nhận riêng (hiện dùng chung session).

## 10. Quyết định kỹ thuật đã thống nhất

1. Không dùng Expo Go để tuyên bố native feature hoạt động.
2. Không dùng PWA.
3. App Groups + Apple Developer Program là điều kiện của widget dữ liệu thật; không có workaround
   miễn phí đáng tin cậy.
4. Key Gemini nằm trong Keychain, nhập trong app; không có trong bundle/Git/log/backup.
5. Mọi từ AI phải được người dùng xem và bấm lưu; `confirmed=true` chỉ sau bước đó.
6. Level là gợi ý, không phải khoá cứng; từ mới ưu tiên đúng level rồi tới level thấp hơn.
7. Streak chỉ tăng khi đạt mục tiêu (từ mới + lượt ôn), không tăng khi mở app.
8. Mục tiêu ngày tính tổng lượt học + ôn (không chỉ từ mới) để người đã học hết từ vẫn giữ streak.
9. Duplicate theo `(normalized_term, track)`; cùng từ có thể có ở cả hai track.
10. `recordReview` là một transaction duy nhất.
11. Migration forward-only, chạy trong transaction; lỗi rollback.
12. Widget chỉ nhận props, không đọc DB, không gọi AI.
13. Không thêm backend/proxy để tránh chi phí; ghi rõ rủi ro key trên máy.
14. Navigator tự viết thay vì Expo Router/React Navigation.
15. Không dùng thư viện state ngoài.

## 11. Giới hạn đã xác minh (Windows, build, signing, widget, App Groups)

- Windows không build iOS cục bộ; EAS Build dùng macOS VM trên cloud.
- EAS Free: 15 build iOS/tháng, timeout 45 phút, hàng đợi ưu tiên thấp, 1 job macOS đồng thời.
- EAS internal distribution cần tài khoản Apple trả phí (theo tài liệu Expo).
- Apple ID miễn phí: 10 App ID / 3 thiết bị / 3 app mỗi thiết bị / profile 7 ngày.
- App Groups là capability theo loại thành viên chương trình; Personal Team miễn phí không có.
- `expo-widgets` hỗ trợ home (small/medium/large) + lock screen accessory; không chạy Expo Go.
- Widget chạy runtime tách biệt, không hook/async/module-scope values.
- iOS kiểm soát lịch refresh widget; không thể hứa cập nhật tức thì.
- Không có deep link riêng cho widget trong tài liệu expo-widgets.
- Apple Speech không chấm âm vị; chỉ transcript + confidence.
- Chi phí tối thiểu cho widget dữ liệu thật: 99 USD/năm.

Nguồn đầy đủ: `docs/FEASIBILITY.md`.

## 12. Lỗi đã gặp và cách khắc phục

| Lỗi | Nguyên nhân | Đã xử lý |
|---|---|---|
| `Bash is required but was not found on this Windows system` | Chưa cài Git for Windows / không có Git Bash | **Đã xử lý** — người dùng cài Git Bash; giờ chạy được node/npm/git/tsc/jest |
| Ripgrep không chạy (`ENOENT ... rg.exe`) | Bản cài Freebuff thiếu binary | Không ảnh hưởng code; dùng đọc file thay thế, ghi vào checkpoint |
| `exportCsvFile` nghi thiếu dấu `)` | Đọc nhầm | Đã kiểm tra lại file: chữ ký đúng, không sửa |
| Import `DEFAULT_SETTINGS` thiếu trong `backup.ts` | Fallback settings bị viết tay | Đã sửa dùng `{ ...DEFAULT_SETTINGS }` |
| Widget import tĩnh có thể làm app crash nếu thiếu native module | `sync.ts` import widget ở top-level | Đã chuyển sang `require` trong `try/catch` |
| `voice.quality` có thể lệch kiểu giữa các phiên bản | API expo-speech | Đã so sánh bằng chuỗi, không dựa vào union type |
| Đoạn JSX thừa trong `WordFormScreen` | Lỗi soạn thảo | Đã xoá, bỏ import không dùng |
| Thiếu `expo-speech-recognition` trong `package.json` dù code và `app.json` đều dùng | Rà import ↔ dependency | Đã thêm `~58.0.0`; cần `npm install` lại |
| Nghi `expo-file-system/legacy` đổi ở SDK 58 | Rà type trong `node_modules` | Không đổi: export + API còn đủ, đóng rủi ro |

## 13. Lỗi còn tồn tại

Toàn bộ lỗi biên dịch/test đã biết đã sửa; `tsc` và `jest` xanh (mục 14). **Còn lại là các giới
hạn môi trường, không phải lỗi code:**

1. `npx expo prebuild --platform ios` bị Expo SDK 58 từ chối trên Windows
   (“Run npx expo prebuild again from macOS or Linux”) → chưa sinh được target widget /
   entitlement App Group trên máy này. Phải chạy trên EAS (macOS) hoặc Mac.
2. Chưa cài lên iPhone: chưa kiểm chứng widget, lock screen, nhận diện giọng nói,
   thông báo, Gemini trong app thật.
3. App Groups vẫn cần Apple Developer Program 99 USD/năm; đây là ràng buộc của Apple,
   không phải điều sửa được trong code.
4. Rủi ro chưa có bằng chứng: `@expo/ui` `Text` render nhiều children/number trong runtime
   widget; `expo-speech-recognition` shape của `event.results[0].segments` trong runtime;
   độ chính xác của on-device speech model cho từ tiếng Anh ngắn.

Đã loại trừ bằng kiểm chứng thật:

- `expo-file-system/legacy` (package 58.0.10 export `./legacy`) — `tsc` xanh.
- `expo-widgets` API — `tsc` xanh và `expo config --type prebuild` compose đúng 2 widget.
- `expo-speech-recognition` — đã cài và biên dịch được.
- Version alignment SDK 58 — `expo-doctor` 20/20.

## 14. Kết quả kiểm thử gần nhất (2026-10-20, đã chạy thật)

| Bước | Lệnh | Kết quả |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck | `npm run typecheck` (tsc 6.0.3) | **exit 0, 0 lỗi** |
| Unit test | `npm test -- --ci` | **4/4 suite, 36/36 test pass** |
| Expo doctor | `npx expo-doctor` | **20/20 check pass** |
| Config plugin | `npx expo config --type prebuild` | **exit 0** — 2 widget + group id compose đúng |
| Checkpoint | `node scripts/validate-checkpoint.mjs` | **hợp lệ** |
| iOS prebuild | `npx expo prebuild --platform ios` | **BLOCKED** — Expo chặn trên Windows |
| Build EAS / thiết bị | — | **CHƯA CHẠY** |

Ghi chú: `tools/verify-report.txt` là output đầy đủ của `node scripts/verify.mjs`.
Không có tính năng nào được đánh dấu `verified_on_device`.

### Lỗi thật đã sửa trong phiên này

1. `tsconfig.json` `baseUrl` → lỗi **TS5101** dưới TypeScript 6. Đã xoá `baseUrl` và `paths`
   `@/*` (không file nào dùng `@/`).
2. Thiếu **`babel-preset-expo`** → cả 4 suite Jest không chạy được. Đã `npx expo install`.
3. `src/db/reviews.ts` gọi `db.execAsync(sql, [params])` — `execAsync` chỉ nhận 1 tham số
   (**TS2554**). Đã đổi sang `db.runAsync(sql, nowIso())`.
4. `app.json` còn `newArchEnabled` — SDK 58 không còn field này (expo-doctor fail). Đã xoá.
5. Jest globals không resolve dưới TS 6 → thêm `"types": ["jest"]` vào `tsconfig`.
6. Thiếu dependency `expo-speech-recognition` (bug-005) — đã thêm và cài.
7. `tools/verify-report.txt` được thêm vào `.gitignore`.

## 15. Hai đường cài lên iPhone (chọn một)

| Đường | Chi phí | Widget | Hạn | Tài liệu |
|---|---|---|---|---|
| Sideload bằng Apple ID miễn phí: GitHub Actions build `.ipa` không ký → Sideloadly ký | 0 | **Không** (không có App Groups) | 7 ngày, ký lại bằng chính file `.ipa` đã tải | `docs/FREE_SIDELOAD.md` |
| Apple Developer Program + EAS Build | 99 USD/năm | Đầy đủ (Home + Lock Screen, dữ liệu thật) | Không hết hạn | `docs/BUILD_AND_INSTALL.md` |

Đường miễn phí dùng `.github/workflows/ios-unsigned.yml` (macOS 26, Xcode 26.6) và
`scripts/prepare-free-build.mjs` (`npm run free:strip` / `free:restore`) để tạm bỏ plugin
`expo-widgets`. Workflow đã được parse YAML và script đã được kiểm strip/restore
(byte-identical); **chưa chạy trên GitHub, chưa có `.ipa`, chưa cài iPhone**.

## 16. Cách chạy dự án

```bash
cd "C:/Users/Lenovo/Desktop/VocabMaster"
node scripts/setup.mjs
npm run typecheck
npm test
npm start            # Metro, cần development build trên iPhone
```

Yêu cầu: Git for Windows, Node 22.13+/24 LTS. Không chạy được trên Expo Go cho widget/speech.

## 16. Cách build iOS

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --platform ios --profile development
```

Cần tài khoản Apple Developer Program để có App Groups. Chi tiết + xử lý lỗi:
`docs/BUILD_AND_INSTALL.md`.

## 17. Cách cài lên iPhone

1. Mở link build EAS trên iPhone → Install.
2. Bật Developer Mode (Cài đặt → Quyền riêng tư & Bảo mật).
3. Mở app một lần.
4. Thêm widget: giữ màn hình chính → “+” → VocabMaster; màn hình khóa → Tuỳ chỉnh → widget.
5. Học/sửa từ → mở lại app → kiểm tra widget đổi số liệu.

Phương án 0 USD (Sideloadly) không có App Groups → widget không đọc dữ liệu thật.

## 18. Bước tiếp theo theo thứ tự ưu tiên

1. Cài Git for Windows + Node LTS; xác nhận `git`, `node`, `npm`.
2. `node scripts/setup.mjs` → `npm run typecheck` → `npm test`; sửa mọi lỗi.
3. `git init` + commit đầu tiên (không commit `.env`, key, chứng chỉ).
4. Chạy `npx expo prebuild --platform ios` (trên máy có CocoaPods hoặc để EAS prebuild) để xem
   target widget có được tạo; kiểm tra `ios/` và App Group.
5. Đăng ký Apple Developer Program (nếu người dùng đồng ý chi phí) → `eas device:create` →
   build development → cài máy thật.
6. Kiểm chứng widget theo `docs/TEST_PLAN.md` mục 2.6; ghi kết quả thật vào checkpoint.
7. Kiểm chứng giọng nói, thông báo, Gemini trên máy thật.
8. Nếu build lỗi: đọc log, sửa, cập nhật `CHANGELOG.md` và checkpoint.

## 19. Việc không được làm lại / đã chứng minh không phù hợp

- **Không** dùng PWA/website để giả widget.
- **Không** dùng Expo Go để tuyên bố widget/speech hoạt động.
- **Không** cố dùng Apple ID miễn phí cho App Groups — không được cấp.
- **Không** thêm backend/proxy chỉ để giấu Gemini key (tăng chi phí, ngoài yêu cầu).
- **Không** tự viết lại navigation bằng Expo Router (đã chọn navigator nhỏ, ổn định).
- **Không** hardcode API key hoặc đưa key vào `.env`/bundle.
- **Không** sửa migration đã phát hành; thêm migration mới.
- **Không** đánh dấu widget là hoàn thành khi chưa cài lên iPhone thật.

## 20. Thông tin chưa xác minh và cách xác minh

| Chưa xác minh | Cách xác minh |
|---|---|
| Code compile | `npm run typecheck` |
| Unit test pass | `npm test` (4 file) |
| Prebuild tạo widget target | `npx expo prebuild --platform ios --clean`, xem `ios/` |
| App Group hoạt động | Build bằng tài khoản trả phí, xem Signing & Capabilities |
| Widget đọc dữ liệu thật | Cài máy thật, thêm từ, kiểm tra số liệu |
| Widget lock screen | Thêm accessory widget trên iPhone |
| Tap widget mở app | Chạm widget, quan sát |
| TTS phát tiếng | Tắt silent mode, nghe thử trong Cài đặt |
| Nhận diện giọng nói | Cấp quyền, đọc từ, xem transcript |
| Gemini 2.5 flash còn dùng được | Tạo 3 từ trong app; đổi model nếu 404 |
| Apple ID free chặn App Group | Thử build với Personal Team, ghi lỗi entitlement |
| Node/npm đã cài | `node --version`, `npm --version` |

---

**Quy tắc cho AI tiếp theo:** đọc `CHECKPOINT.md` → `NEXT_SESSION.md` → `CHECKPOINT.json` →
phần mới nhất của `CHANGELOG.md`; kiểm tra thư mục và Git thật; nếu checkpoint lệch code, ưu
tiên trạng thái thật của code và ghi lại khác biệt trước khi sửa. Không xây lại từ đầu.
