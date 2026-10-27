# CHECKPOINT — VocabMaster

- **checkpoint_version:** 1
- **last_updated:** 2026-10-27
- **current_phase:** Giai đoạn 1–6 + **bỏ hẳn API từ điển, Groq xử lý cả cụm từ (2026-10-25)** + **mỗi từ chỉ thưởng xu một lần theo term_key** + **chỉ chặn phiên học từ mới khi còn từ đến hạn — thêm từ không bao giờ bị khoá** + **bài học từ mới nhiều giai đoạn** + **mô tả song ngữ Anh–Việt khi điền từ** + **thiên thạch đục ký tự, giảm mật độ** + **60 giây chơi trọn phút** + **audio session playback khi đọc từ** + **watchdog nhận diện giọng nói** + **(2026-10-26) lịch ôn tùy chỉnh 4 mức, reset tiến độ theo chu kỳ có chống trùng xu, Groq tự xếp level từng mục, điểm ưu tiên từ + “Từ tôi hay quên”, hiệu ứng âm thanh, Album từ vựng với chọn hàng loạt/lọc/sắp xếp và thông báo ngẫu nhiên, chuẩn hoá chủ đề** + **(2026-10-27) chu kỳ thông báo Album do người dùng tự nhập (giờ/phút, không còn danh sách cố định) và khung nhập danh sách mỗi dòng một mục trộn Việt/Anh có Groq dịch sang tiếng Anh; tài khoản trực tuyến + đồng bộ + web admin panel mới ở bước thiết kế (`docs/CLOUD_BACKEND.md`)** — **typecheck 0 lỗi, 323/323 unit test xanh trong 33 suite, schema v5 có migration kiểm tra trên SQLite thật (node:sqlite)**; **Groq đã dùng thật trên iPhone (2026-10-23)**; toàn bộ thay đổi 2026-10-24/25/26 **chưa chạy trên thiết bị**
- **project_path:** `C:\Users\Lenovo\Desktop\VocabMaster`
- **current_branch / commit:** `main` · cập nhật 2026-10-27 (chu kỳ Album tự nhập + nhập danh sách Việt/Anh), xem `git log`
- **remote:** `https://github.com/phamkenn/vocabmaster.git` (private)

> Đọc mục 13–14 trước khi tin bất kỳ tính năng nào. Code có mặt + test xanh vẫn không có nghĩa
> là đã chạy trên iPhone: Groq đã dùng thật (người dùng báo), còn widget, micro, thông báo và
> Gemini **chưa được kiểm chứng thiết bị**.

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

- SQLite schema v1 + migration transaction + seed 40 từ viết tay + **kho bundle 134 từ** (94 General, 40 IELTS) nạp theo `SEED_VERSION` bằng `INSERT OR IGNORE` — chỉ thêm từ mới, không sửa từ/tiến độ đã có (`docs/WORD_BANK.md`).
- CRUD từ vựng, tìm kiếm, yêu thích, chống trùng theo `(term, track)`, cảnh báo trùng chéo track.
- Nhập CSV (header linh hoạt, ngoặc kép, lỗi từng dòng), xuất CSV, xuất/khôi phục JSON
  (merge/replace, transaction, giữ dữ liệu khi lỗi).
- FSRS-5: bước học đầu, interval theo retention, lapse, same-day, clamp.
- Sinh 9 dạng câu hỏi từ dữ liệu thật; chống trùng đáp án; fallback gõ từ khi thiếu distractor;
  cloze chỉ khi câu ví dụ chứa từ.
- Chấm điểm bỏ qua hoa/thường, dấu câu, khoảng trắng; near-miss; chấp nhận “to + verb”.
- Buổi học: tiến độ, phản hồi, tự đánh giá Lại/Khó/Nhớ/Dễ, lưu transaction, làm lại từ sai.
- Hai track + 7 cấp độ, mục tiêu ngày, kiểm tra đầu vào theo cấp độ — **chỉ câu có lựa chọn**, có nút bỏ qua (2026-10-22 sửa lỗi màn hình không hiện đáp án).
- Gợi ý điều chỉnh độ khó dựa trên accuracy 7 ngày (tăng/giảm 1 cấp, người dùng bấm xác nhận).
- Streak theo ngày đạt mục tiêu, có ân hạn trước nửa đêm, best streak, lịch sử hoạt động.
- Thống kê: streak, accuracy 7 ngày, 14 ngày hoạt động, phân bố cấp độ, trạng thái ghi nhớ, từ hay sai.
- TTS en-US/en-GB, đọc từ và câu ví dụ.
- Luyện nói: nhận diện giọng nói, ưu tiên on-device, so khớp từ + confidence; **không** chấm âm vị.
- AI tạo bộ từ theo track/level/topic/count/focus, tránh từ đã có, validate từng trường,
  preview + sửa + chọn trước khi lưu, xử lý lỗi 401/403/429/5xx/mạng/timeout. Hai nhà cung cấp:
  **Gemini** (mặc định, tiếng Việt/IPA tốt hơn) và **Groq** (`openai/gpt-oss-120b`, rất nhanh,
  8K token/phút) — chọn trong Cài đặt, mỗi bên có key + model riêng (`src/ai/groq.ts`,
  `src/ai/provider.ts`, `src/ai/index.ts`).
- **Tạo bộ từ từ danh sách tự nhập (2026-10-25)**: tách phẩy/chấm phẩy/xuống dòng, giữ nguyên cụm
  (`take into account` là một mục), bỏ trùng không phân biệt hoa/thường, giữ thứ tự; AI (Groq mặc
  định, Gemini là lựa chọn) viết toàn bộ nghĩa/IPA/định nghĩa/ví dụ/collocations/level cho cả từ đơn
  và cụm từ; chia lô, cache theo nội dung, single-flight, timeout 20 giây, retry có backoff chỉ cho
  lỗi mạng/429/5xx; báo rõ số mục thành công/thất bại và cho **Thử lại** phần lỗi. **Không còn API
  từ điển, không còn điều kiện từ điển phải xác nhận** (`src/wordlist/parse.ts`,
  `src/screens/useWordListImport.ts`, `src/ai/cache.ts`).
- Gợi ý chi tiết cho một từ cụ thể trong biểu mẫu (lookupTerm).
- **Cấp độ tự tra cho danh sách dán**: kho từ bundle trả lời ngay, phần còn lại do AI xếp CEFR trong
  cùng request; thẻ từ ghi band + nguồn ("có sẵn" / "AI ước lượng"); từ chưa rõ ghi đúng như vậy.
- **Cổng ôn tập (2026-10-25, chỉnh cùng ngày)**: `countDueWords` / `getStudyGate` /
  `assertNewLearningAllowed` (`src/study/gate.ts`) **chỉ** dùng cho `startNewLearning`. `createWord`
  không gọi assert, nên AI, nhập danh sách và form thủ công luôn lưu được khi còn từ đến hạn; từ mới
  có `learning_state='new'`, `due_at=NULL`, không bị tính là đã học.
- **Học từ mới nhiều giai đoạn (2026-10-25)**: giới thiệu → lật thẻ (định nghĩa, 2 chiều ví dụ,
  collocations, đồng nghĩa) → một câu kiểm tra → tự đánh giá; chỉ bước cuối ghi `recordReview`.
- **Âm thanh (2026-10-25)**: `src/audio/session.ts` nâng audio session lên playback trước khi TTS để
  từ vựng nghe được ở chế độ im lặng, rồi trả về media; TTS dừng trước khi mở micro.
- **Thêm từ không bị khoá (2026-10-25)**: `createWord` không gọi cổng ôn tập; chỉ `startNewLearning`
  trong `src/study/gate.ts` bị chặn khi `due > 0`, có test cho cả hai chiều.
- **Mô tả song ngữ (2026-10-25)**: `src/quiz/description.ts` tách mô tả Anh–Việt, thay đáp án bằng
  chỗ trống ở cả hai bên, giữ cụm từ nguyên khối; `DescriptionBlock` hiển thị hai khối riêng.
- Key AI trong Keychain, **mỗi nhà cung cấp một ô riêng**, không log, không backup, có xoá key.
- Widget: 2 kind (home 3 size, lock screen 3 family), snapshot + timeline, sync sau mỗi thay đổi
  và khi app foreground, lỗi được nuốt an toàn.
- Nhắc nhở hằng tuần theo giờ/ngày, xin quyền, huỷ và lên lịch lại.
- Light/dark/system theme, design tokens dùng chung.
- Onboarding, cài đặt, sao lưu, reset có xác nhận 2 lớp.
- 30 bộ unit test (FSRS, quiz ×2, description ×2, placement, streak ×2, text, settings, AI ×6, word packs, coins ×2, game engine ×3, study gate + priority, words/reset DB, word-list parser, music, speech ×3, album notification selection, sound-effect gate).
- Checkpoint + script setup + script validate.

## 8. Chức năng mới làm một phần

| Chức năng | Đã có | Còn thiếu |
|---|---|---|
| Widget | UI, snapshot, sync, config plugin | Build native, App Group thật, kiểm chứng máy thật |
| Luyện nói | Thu transcript, so khớp từ, hiển thị confidence | Chấm âm vị/trọng âm (không có công nghệ miễn phí phù hợp) |
| Âm thanh từ | TTS on-device cho từ và câu, phát được ở chế độ im lặng | Chưa có audio thu sẵn; chất lượng phụ thuộc gói giọng iOS |
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
| "Gemini đang gặp lỗi tạm thời" lúc được lúc không (2026-10-22) | 503/overloaded của Google bị coi là lỗi cuối cùng vì **không có retry**; `AiError.retryable` được khai báo nhưng **không chỗ nào đọc** | **Đã sửa** — retry 3 lần, exponential backoff + jitter, tôn trọng Retry-After, chỉ cho lỗi tạm thời |
| Câu trả lời bị cắt → "Không đọc được JSON" | `maxOutputTokens` cố định 4096, không kiểm tra `finishReason`, không vá JSON bị cắt | **Đã sửa** — token budget theo số từ (2048–8192), đọc `finishReason`, salvage các mục hoàn chỉnh, báo rõ "bị cắt" |
| 404 model bị ngừng vẫn lộ ra UI dạng lỗi chung | `mapHttpError` gộp 404 vào `unknown` | **Đã sửa** — phân loại `model_unavailable`, tự liệt kê model còn dùng được và thử lại 1 lần |
| Nhấn "Tạo bộ từ" hai lần tạo hai request | Không có khoá single-flight ở tầng dịch vụ | **Đã sửa** — cùng request dùng chung promise; request khác bị từ chối với mã `busy` |
| Không biết lỗi ở bước nào | Không có log | **Đã sửa** — `src/ai/diagnostics.ts` + panel "Lần gọi Gemini gần đây" trong Cài đặt (không chứa key) |
| Màn hình "đơ" ở "Gemini đang tạo…" | `setLoading(true)` + `await fetch` chỉ dựa vào `AbortController`; không có deadline thật, nếu `fetch` không settle thì UI không bao giờ thoát | **Đã sửa** — race với deadline 20 s và tín hiệu huỷ (luôn settle), timeout **không** retry, đồng hồ giây + nút **Huỷ** |
| Kiểm tra đầu vào không hiện đáp án, không bấm tiếp được | `PlacementScreen` cho phép kind `typing` (câu trả lời gõ tay, `options: null`) nhưng màn hình chỉ render nút chọn và chỉ hiện nút "Tiếp" sau khi đã trả lời → màn hình không lối thoát | **Đã sửa** — `src/quiz/placement.ts` chỉ tạo câu trắc nghiệm có ≥ 2 lựa chọn, bỏ qua cấp độ không tạo được; thêm nút "Bỏ qua câu này" làm lưới an toàn; có test |

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
   độ chính xác của on-device speech model cho từ tiếng Anh ngắn; hành vi thật của nhạc nền
   (ducking, dừng khi xuống nền, công tắc im lặng) và vòng lặp game trên iPhone.
4b. **Chưa build/chạy bất kỳ tính năng mới nào của 2026-10-24 trên thiết bị** (Windows, không có
   macOS/EAS). Nhạc, game, micro, giọng nam/nữ, xu và khôi phục chuỗi chỉ được kiểm bằng unit test
   và typecheck.
4c. ~~Nhập danh sách từ vẫn ưu tiên từ điển~~ — **đã sửa 2026-10-25**: API từ điển bị xoá, Groq là
   nguồn chính cho cả từ đơn và cụm từ. Vẫn chưa có bài riêng cho collocation/sentence building.
4d. **Chưa chạy trên thiết bị bất kỳ tính năng nào của 2026-10-26**: lịch ôn tùy chỉnh, reset học tập,
   Groq xếp level, ưu tiên từ, hiệu ứng âm thanh, Album, thông báo album và chuẩn hoá chủ đề mới chỉ
   được kiểm bằng typecheck + unit test + migration. Đặc biệt cần kiểm thật: thông báo cục bộ iOS
   (trễ/gộp, giới hạn 64 pending, Focus), WAV sfx qua expo-audio không làm nhỏ TTS/nhạc, và chọn hàng loạt trên
   màn hình nhỏ. Không đánh dấu `verified_on_device`.
5. **Gemini**: logic lỗi/retry/validate đã có test tự động, nhưng **chưa có lần gọi Gemini thật nào
   bằng key của người dùng** trong phiên này. Việc 503/429/404 thực tế có được xử lý đúng trên iPhone
   chỉ xác nhận được sau khi cài bản build mới và bấm "Tạo bộ từ". Không đánh dấu `verified`.

Đã loại trừ bằng kiểm chứng thật:

- `expo-file-system/legacy` (package 58.0.10 export `./legacy`) — `tsc` xanh.
- `expo-widgets` API — `tsc` xanh và `expo config --type prebuild` compose đúng 2 widget.
- `expo-speech-recognition` — đã cài và biên dịch được.
- Version alignment SDK 58 — `expo-doctor` 20/20.

## 14. Kết quả kiểm thử gần nhất (2026-10-26, đã chạy thật)

| Bước | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npx tsc --noEmit` (tsc 6.0.3) | **exit 0, 0 lỗi** (2026-10-26) |
| Unit test | `npx jest --runInBand` | **30/30 suite, 284/284 test pass** (2026-10-26) |
| Migration | `node scripts/check-migrations.mjs` | **OK** — schema 1→5 trên SQLite thật, gồm backfill, bảng `album_words`, `cycle_id` và unique index |
| Dùng Groq thật | Người dùng báo trong chat (2026-10-23) | **Mượt, kết quả tốt** — không có build number/screenshot/log, chưa đo latency hay hạn mức |
| Tra từ điển thật | `lookupWords([...6 từ])` với endpoint thật | **906 ms**, 4 từ đúng dữ liệu, 1 từ không tồn tại, 1 cụm từ bị từ chối |
| Migration thật | `node:sqlite` chạy migration 1 → 3 | bảng `coin_ledger` + `streak_restores` tạo đúng; từ đã học trước đó được đánh dấu 0 xu; **index chặn thưởng trùng và cứu chuỗi trùng** (đã thử insert lần hai, bị từ chối) |
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

1. ~~Cài Git for Windows + Node LTS~~ — **xong**, `node scripts/verify.mjs` xanh.
2. ~~Khởi tạo Git + push GitHub~~ — **xong** (`phamkenn/vocabmaster`, private). Cài `.ipa` bằng Sideloadly.
3. **Cài bản build chứa thay đổi 2026-10-23** rồi kiểm chứng cả hai chế độ: (a) Gemini → "Tạo bộ
   từ" (thử cả khi tắt Wi-Fi để thấy lỗi mạng được báo đúng); (b) tab Từ vựng → "Nhập danh sách từ"
   với `criminal, civil, justice, evidence` → phải thấy nghĩa Việt, IPA, và thẻ ghi trường thiếu.
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
| Unit test pass | `npm test` (30 file, 284 test) |
| Kho từ nạp đúng, không ghi đè từ đã sửa | Cài bản mới lên máy có dữ liệu cũ, đếm từ + kiểm tra từ đã sửa nghĩa |
| Gemini retry/backoff/validate | `npm test -- src/ai` — mock fetch, không gọi API thật |
| Prebuild tạo widget target | `npx expo prebuild --platform ios --clean`, xem `ios/` |
| App Group hoạt động | Build bằng tài khoản trả phí, xem Signing & Capabilities |
| Widget đọc dữ liệu thật | Cài máy thật, thêm từ, kiểm tra số liệu |
| Widget lock screen | Thêm accessory widget trên iPhone |
| Tap widget mở app | Chạm widget, quan sát |
| Gemini 503/429/404 được xử lý đúng trên iPhone | Cài build 2026-10-22, tạo bộ từ, đọc "Lần gọi Gemini gần đây" |

## 21. Lộ trình nâng cấp theo yêu cầu 2026-10-22 (chưa làm hết)

Yêu cầu lớn của người dùng chia 7 giai đoạn. Trạng thái thật:

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1. Kiểm tra & chẩn đoán | đọc code, xác định framework/DB/luồng Gemini, tìm nguyên nhân lỗi chập chờn | **xong** (xem mục 12) |
| 2. Sửa Gemini API | phân loại lỗi, retry/backoff, validate, chống trùng, log | **code + test xong**, chưa kiểm chứng thiết bị |
| 3. Cải thiện dữ liệu từ vựng | Anh/Việt/song ngữ khi học, nguồn + trạng thái xác minh, tạo bộ từ nâng cao | **một phần** — kho bundle 134/5.000 từ (`docs/WORD_BANK.md`); hai cách tạo bộ từ đều qua AI, hỗ trợ cụm từ; phần song ngữ khi học chưa làm |
| 4. Nâng cấp học tập | thêm chế độ học, câu ví dụ, thống kê cá nhân hóa | **một phần** — đã có 9 dạng quiz, FSRS, từ yếu |
| 5. Dịch thuật | khu vực dịch câu + giải thích ngữ cảnh | **chưa làm** |
| 6. Minigame bắn thiên thạch | arcade từ dữ liệu đã lưu | **code + test xong**, chưa chơi trên iPhone |
| 7. Kiểm thử & phát hành | thiết bị, offline, hạn mức, IPA | **một phần** — unit test xanh, chưa có thiết bị |

Nguyên tắc đã thống nhất: không viết lại app, không đổi schema khi chưa có migration, không tuyên bố
hoàn thành khi chưa kiểm thử, ưu tiên ổn định trước tính năng.
| TTS phát tiếng | Tắt silent mode, nghe thử trong Cài đặt |
| Nhận diện giọng nói | Cấp quyền, đọc từ, xem transcript |
| Gemini 2.5 flash còn dùng được | Tạo 3 từ trong app; đổi model nếu 404 |
| Apple ID free chặn App Group | Thử build với Personal Team, ghi lỗi entitlement |
| Node/npm đã cài | `node --version`, `npm --version` |

---

## 22. Phiên 2026-10-26 — trạng thái từng yêu cầu

| Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|
| 1. Tùy chỉnh lịch ôn 4 mức (5 phút/30 phút/12 giờ/24 giờ), lưu bền, khôi phục mặc định, dùng thật khi tính `nextReviewAt` | **code + test xong**, chưa chạy máy thật | `src/srs/fsrs.ts` (`scheduleForRating`, `DEFAULT_LEARN_STEPS`), `src/db/settings.ts`, `SettingsScreen`; test `fsrs` + `settings` |
| 2. Reset tiến độ học, giữ từ/level/chủ đề/album/xu/streak, thưởng lại theo chu kỳ, chống trùng | **code + test xong**, chưa chạy máy thật | `src/db/reset.ts`, `src/db/schema.ts` (`coin_ledger.cycle_id`, unique `(term_key, cycle_id)`), `src/coins/ledger.ts`; test `reset` + `ledger` |
| 3. Groq tự xếp level từng từ/cụm, `actualLevel` dùng khắp nơi, không ghi đè bằng level người dùng chọn | **code + test xong**, chưa gọi Groq thật với danh sách nhiều level | `src/ai/schema.ts`, `src/ai/prompt.ts`, `src/screens/useWordListImport.ts`, `src/wordlist/types.ts`; test `ai/schema` |
| 4. Sound effects có bật/tắt, âm lượng, throttle, không chồng, không giành TTS | **code + test gate xong**, chưa nghe trên iPhone | `src/sound/sfx.ts`, `src/sound/__tests__/sfx.test.ts`, `assets/sfx/*.wav`, `SettingsScreen` |
| 5. Ưu tiên từ theo lịch sử + “Từ tôi hay quên” động | **code + test xong** | `src/study/priority.ts`, `src/db/words.ts` (`getWeakWords`), `StudyScreen`; test `priority` |
| 6. Album + chọn hàng loạt + lọc/sắp xếp | **code xong**, chưa có test DB album riêng, chưa chạy UI máy nhỏ | `src/db/album.ts`, `src/screens/AlbumScreen.tsx`, `WordsScreen` |
| 7. Thông báo ngẫu nhiên toàn album, túi từ chống lặp, chu kỳ/khung giờ/giới hạn, không tính là học | **code + test xong**, **chưa chạy thông báo thật trên iOS** | `src/notifications/album.ts`, `App.tsx`; test `notifications/selection` |
| 8. Chuẩn hoá chủ đề, gộp trùng an toàn | **code + test xong** | `src/db/words.ts`, migration v5; test `words` |
| 10. Mục tiêu học thông minh | **chưa làm** — ngoài phạm vi phiên, ghi ở `NEXT_SESSION.md` | — |

Giới hạn kỹ thuật đã ghi trong app: iOS không bảo đảm thông báo cục bộ đúng từng phút; app chỉ lên
lịch trước tối đa 48 thông báo (dưới giới hạn 64 pending), huỷ lịch cũ khi đổi cài đặt, tắt là ngừng tạo.
Chưa có giới hạn số thông báo/ngày, giờ yên tĩnh riêng, chọn ngày trong tuần hay bộ lọc nâng cao cho
nguồn thông báo; các mục này là tùy chọn trong yêu cầu.

## 23. Phiên 2026-10-27 — trạng thái từng yêu cầu (chu kỳ Album, nhập danh sách, backend)

| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| Chu kỳ Album tùy biến, không giới hạn danh sách cố định | **Xong** | `src/notifications/interval.ts`; kiểm tra dữ liệu nhập, cảnh báo giới hạn iOS, lưu bền, không tự đổi giá trị |
| Mỗi Enter = một mục, giữ nguyên cụm từ | **Xong** | `src/wordlist/parse.ts` tách theo ký tự xuống dòng thật |
| Nhận diện tiếng Việt / tiếng Anh theo từng mục | **Xong** | `src/lib/lang.ts` |
| Groq dịch mục tiếng Việt, giữ đầu vào gốc, có lựa chọn khác | **Xong** | `prompt.ts`/`schema.ts`/`match.ts` với `sourceVi`, `englishOptions`, `uncertain`, ghi chú `Gốc:` |
| Tài khoản do admin tạo | **Chưa** | thiết kế ở `docs/CLOUD_BACKEND.md`; chờ project Supabase |
| Dữ liệu học trực tuyến + đồng bộ iPhone ↔ máy tính | **Chưa** | quy tắc đồng bộ từng loại dữ liệu đã chốt trong tài liệu |
| Web admin panel (tài khoản, xu, Groq) | **Chưa** | cùng blocker; mọi thao tác đặc quyền phải qua Edge Function |
| Bản web / máy tính | **Chưa** | Expo hỗ trợ web; desktop chỉ là vỏ Electron/Tauri; đã liệt kê module chạy được/không |
| Bảo mật (RLS, không để client sửa xu, khoá không vào app) | **Thiết kế xong** | chưa có gì để kiểm thử |

**Số liệu thật (2026-10-27):** `npx tsc --noEmit` 0 lỗi · `npx jest --runInBand` 33 suite / 323 test
pass · `node scripts/check-migrations.mjs` OK · `node scripts/validate-checkpoint.mjs` hợp lệ.
Không có test nào gọi Groq/Gemini/iOS thật. **Chưa build iOS**, nên hai tính năng mới chưa chạy trên máy.

---

---

## 24. Phiên 2026-10-27 — bản web chạy trên máy tính (Expo web)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Chạy được trong trình duyệt | **Xong** | `npx expo start --web` → `localhost:8081`, vào đủ 6 tab, ngân hàng 114 từ hiển thị đủ lọc level/chủ đề và sắp xếp |
| Dữ liệu web bền vững | **Xong** | ★ `breakfast` → tải lại trang → vẫn ★ (SQLite WASM ghi/đọc thật, không phải RAM) |
| Bố cục màn hình máy tính | **Xong** | 1440 px → cột 560 căn giữa (x = 440) có viền + bóng, thanh tab nằm trong cột; 700 px → tràn viền; **không tràn ngang** ở cả hai |
| HTML hợp lệ | **Xong** | `Card` trên web đổi sang `div role="link" tabIndex=0` → 0 lỗi lồng `<button>`; nút 🔊/★ vẫn là `<button>` thật; bấm thẻ vẫn mở chi tiết từ |
| Nguồn iOS không hỏng | **Xong** | `npx tsc --noEmit` 0 lỗi · `npm test` 33 suite / 323 test pass · `app.json` chỉ thêm `"web"` vào `platforms`, phần `ios` nguyên vẹn |
| Đồng bộ web ↔ điện thoại | **Chưa** | giai đoạn 4: cần migration `remote_id`/`outbox` + màn hình đăng nhập + push/pull |
| Thông báo cục bộ trên web | **Không làm được** | web không lên lịch thông báo cục bộ; thay bằng nhắc trong trang |
| `crossOriginIsolated` ở HTML dev | **Chưa** | header COOP/COEP mới có ở bundle, chưa có ở tài liệu HTML; app vẫn chạy và vẫn ghi/đọc bền (đã kiểm), nhưng `withExclusiveTransactionAsync()` không dùng được trên web |

**Cách chạy:** `npm install` rồi `npx expo start --web`, mở `http://localhost:8081`. Cấu hình web nằm ở
`metro.config.js` (`.wasm` vào `assetExts` + COOP/COEP) — chỉ bundler dùng tới, không đụng build iOS.

---

**Quy tắc cho AI tiếp theo:** đọc `CHECKPOINT.md` → `NEXT_SESSION.md` → `CHECKPOINT.json` →
phần mới nhất của `CHANGELOG.md`; kiểm tra thư mục và Git thật; nếu checkpoint lệch code, ưu
tiên trạng thái thật của code và ghi lại khác biệt trước khi sửa. Không xây lại từ đầu.
