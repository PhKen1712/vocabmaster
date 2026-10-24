# CHANGELOG

Mỗi mục là một phiên làm việc. Ghi ngày, file, lý do, kết quả kiểm thử thật, lỗi và việc còn dở.

---

## 2026-10-25 — Phiên 12: Groq thay từ điển, xu một lần, khoá ôn tập, học từ mới, game và âm thanh

### Bối cảnh

- Người dùng báo **nhập danh sách từ vẫn không thêm được cụm từ**: Groq đã trả kết quả nhưng bước tra
  từ điển chỉ nhận từ đơn nên chặn lưu; từ điển còn giới hạn số lần gọi.
- Người dùng báo **kiểm tra nói vẫn chưa hoạt động** và **chế độ 60 giây không hoạt động** sau bản trước.
- Yêu cầu bổ sung: mỗi từ chỉ thưởng xu một lần nhưng gặp lại trả lời sai vẫn bị trừ; thiên thạch thưa
  hơn và đục ký tự; âm thanh phải nghe được ở chế độ im lặng; bắt buộc ôn tập trước khi học từ mới;
  học từ mới phải được giới thiệu trước khi kiểm tra.

### Nguyên nhân tìm được trong code

- `src/dict/*` và `src/db/dictCache.ts` là nguồn bắt buộc cho chế độ dán danh sách; `lookupWord`
  từ chối mọi headword có khoảng trắng, nên `take into account` không bao giờ tới được bước lưu.
  Đây là xung đột thiết kế, không phải lỗi mạng.
- `RushGameScreen` chỉ tạo 4–24 câu; khi trả lời hết bộ, `answerRush` đặt `status: 'over'` dù đồng hồ
  còn gần cả phút, nên chế độ "60 giây" kết thúc sau vài câu.
- `useSpeechCheck` chỉ tạo kết quả khi iOS gửi `isFinal`; nếu task kết thúc không có kết quả cuối (người
  dùng bấm dừng, cuộc gọi chen ngang, mất focus), màn hình treo ở "Đang nghe…" và không chấm được.
  Ngoài ra âm thanh mẫu còn đang phát qua expo-speech có thể chiếm audio session, làm micro lỗi
  `audio-capture`.
- TTS chạy trong audio session `playsInSilentMode: false` dùng cho nhạc, nên công tắc chuông tắt tiếng từ.

### Đã thay đổi

- **Bỏ hẳn từ điển**: xoá `src/dict/*`, `src/db/dictCache.ts`, `src/screens/useWordListLookup.ts`,
  `src/ai/levels.ts`, `docs/DICTIONARY.md`; migration giữ nguyên `dict_source`/`missing_fields` để dữ
  liệu cũ vẫn đọc được nhưng không còn nhánh nào gọi API từ điển hay yêu cầu từ điển xác nhận.
- **Nhập danh sách bằng Groq** (`src/wordlist/parse.ts`, `src/screens/useWordListImport.ts`,
  `src/ai/cache.ts`): giữ nguyên cụm từ, bỏ trùng không phân biệt hoa/thường, chia lô, cache theo nội
  dung, chống request trùng, báo thành công/thất bại từng phần và **Thử lại** chỉ phần lỗi.
- **Xu một lần** (`src/coins/ledger.ts`, `src/db/reviews.ts`, schema v4): `word_study_history` +
  `term_key` bền vững, `source_id` chống xử lý trùng, thưởng/phạt nằm trong transaction của lượt trả lời,
  số dư không âm, reset chỉ ghi một giao dịch reset. Sai khi gặp lại từ đã thưởng vẫn bị trừ.
- **Khoá học từ mới** (`src/study/gate.ts`): `createWord` gọi `assertNewLearningAllowed`, nên AI, nhập
  danh sách, form thủ công và mọi màn hình đều bị chặn ở tầng dữ liệu khi còn từ đến hạn; Study/AI/
  Nhập danh sách hiện số từ và đưa thẳng sang Ôn tập.
- **Học từ mới nhiều giai đoạn** (`src/screens/LearnScreen.tsx`): giới thiệu từ + nghĩa + IPA + nghe →
  lật thẻ (định nghĩa, ví dụ + dịch, collocations, đồng nghĩa) → một câu kiểm tra → tự đánh giá
  (Chưa nhớ/Khó/Tốt/Rất dễ). Chỉ bước tự đánh giá ghi `recordReview`; lật thẻ/nghe không tạo xu.
- **Thiên thạch** (`src/games/asteroid.ts`, `AsteroidGameScreen`): giảm còn một từ mỗi 3,2 giây, tối đa
  4 từ, chọn làn tránh chồng; từ bị đục ký tự theo độ dài/cấp độ, không đục chữ đầu hay khoảng trắng,
  gõ đúng chữ nào hiện chữ đó.
- **60 giây** (`src/games/rush.ts`): `continueRush` nối thêm bộ câu mới khi hết bộ cũ mà vẫn còn giờ;
  đồng hồ là thứ duy nhất kết thúc lượt bình thường.
- **Âm thanh** (`src/audio/session.ts`, `src/speech/tts.ts`): nâng audio session lên playback khi đọc từ
  (nghe được cả khi bật im lặng), giảm nhạc nền, trả về media sau khi đọc.
- **Nhận diện giọng nói** (`src/speech/useSpeechCheck.ts`): dừng TTS trước khi mở micro; nếu iOS kết
  thúc mà không có `isFinal` thì chấm bằng transcript tạm cuối cùng; watchdog 9 giây dừng task và báo
  rõ "không nghe thấy giọng nói" thay vì treo.
- **Animation**: `src/components/motion.tsx` + `ScreenTransition.tsx`, tôn trọng Reduce Motion.
- Docs: README, NEXT_SESSION, CHECKPOINT.md/JSON, xoá tài liệu từ điển.

### Kiểm thử thật

- `npx tsc --noEmit` → **exit 0, 0 lỗi**.
- `npx jest --runInBand` → **24/24 suite, 241/241 test pass**; thêm test cho `continueRush` (chơi trọn
  phút, không nối sau khi hết giờ), parser cụm từ, gate ôn tập, ledger một-lần và thiên thạch đục chữ.
- `node scripts/check-migrations.mjs` → **OK** (schema 1→4 trên `node:sqlite`).
- `node scripts/validate-checkpoint.mjs` → **hợp lệ**.

### Chưa kiểm chứng (phải nói rõ)

- **Chưa build/cài bản mới trên iPhone.** Sửa kiểm tra nói và 60 giây mới chỉ qua typecheck + unit test
  + đọc code; hành vi audio/speech thật của iOS không chạy được trên Windows.
- Chưa có log lỗi thật từ máy người dùng cho micro; bản sửa xử lý các nguyên nhân đã biết (quyền,
  thiếu gói ngoại tuyến, task kết thúc không kết quả, TTS chiếm session) và hiện lỗi cụ thể.
- Groq live vẫn chỉ có báo cáo trước đó của người dùng; chưa gọi lại bằng key trong phiên này.

---

## 2026-10-24 — Phiên 11d: micro / nhận diện giọng nói báo “chưa dùng được”

### Bối cảnh

- Người dùng báo **không có chỗ nào dùng micro được**; màn hình chỉ ghi “chưa dùng được micro”.

### Nguyên nhân tìm được trong code

- Banner cũ gộp **mọi** lỗi nhận diện thành tiêu đề “Chưa dùng được micro”, nên lỗi thiếu gói tiếng Anh
  ngoại tuyến trông như lỗi quyền micro.
- `useSpeechCheck` luôn đặt `requiresOnDeviceRecognition: true`. Nếu iPhone chưa có gói en-US ngoại
  tuyến, hoặc Siri/Đọc chính tả đang tắt, iOS trả `service-not-allowed` / `language-not-supported`
  ngay khi bắt đầu — trước cả khi micro được dùng.
- Nút “Thử nhận diện qua mạng” ở phòng phát âm gọi `setOnDevice(false)` rồi `start()` trong cùng một
  nhịp, nên `start` vẫn đọc giá trị `onDevice` cũ và thử ngoại tuyến lần nữa; phiên học không có nút
  này, chỉ có “Bỏ qua”.

### Đã thay đổi

- `src/speech/useSpeechCheck.ts` — trước khi bắt đầu, hỏi `supportsOnDeviceRecognition()`; máy không
  có gói ngoại tuyến thì dùng mạng ngay và ghi rõ lý do; nếu iOS vẫn trả `service-not-allowed` /
  `language-not-supported` khi đang thử ngoại tuyến thì **tự chuyển sang mạng một lần** (có ghi chú
  âm thanh gửi tới Apple), không lặp vô hạn. `start(question, { network: true })` ép một lần qua mạng;
  thông báo lỗi tách riêng quyền micro, thiếu gói/Siri, không có mạng, micro bận và bị ngắt; dọn timer
  khi dừng/đặt lại.
- `src/screens/PronunciationScreen.tsx`, `src/screens/SessionScreen.tsx` — đổi tiêu đề thành “Chưa
  nhận diện được giọng nói”, hiện ghi chú chế độ đang dùng, thêm nút **Thử nhận diện qua mạng** trong
  phiên học và nút **Mở Cài đặt iOS** khi lỗi là do quyền.
- README — thêm hành vi tự chuyển mạng và cách xử lý.

### Kiểm thử thật

- `npx tsc --noEmit` → **exit 0, 0 lỗi**.
- `npx jest --runInBand` → **25/25 suite, 256/256 test pass**; thêm `src/speech/__tests__/
  recognition.test.ts` cho câu báo lỗi và quy tắc chỉ fallback mạng **một lần**, đúng loại lỗi.

### Chưa kiểm chứng (phải nói rõ)

- **Chưa có log lỗi thật từ iPhone của người dùng**, nên nguyên nhân chính xác (quyền bị từ chối, thiếu
  gói ngoại tuyến, hay Siri tắt) chưa được xác nhận; bản sửa xử lý cả ba và hiện đúng lỗi thay vì câu
  chung “chưa dùng được micro”.
- Cần **build lại và cài bản mới** mới có thay đổi; bản đang cài trên máy vẫn là code cũ.
- Auto-fallback gửi âm thanh tới Apple; người dùng được thông báo ngay trên màn hình, nhưng đây là thay
  đổi quyền riêng tư cần người dùng chấp nhận khi dùng.

---

## 2026-10-24 — Phiên 11c: sửa chế độ 60 giây bị đứng ở màn hình trống

### Bối cảnh

- Người dùng báo **chế độ 60 giây không hoạt động**. Đọc code thì đúng: `RushGameScreen` khởi tạo
  `createRush([])`, mà danh sách rỗng trả `status: 'over'`, `questions: []`. Khi từ của người dùng
  tải xong, màn hình **không tạo lại** bộ câu hỏi, nên chỉ hiện `—`, bốn nút trống và không có nút
  Bắt đầu; overlay giới thiệu chỉ hiện khi `status === 'ready'`, overlay kết quả chỉ hiện khi có câu
  hỏi. Vì vậy game chết ngay từ lần mở đầu tiên.

### Đã thay đổi

- `src/screens/RushGameScreen.tsx` — thêm effect tạo lại bộ câu khi từ đã tải xong và game còn rỗng
  (cũng chạy lại khi người dùng thêm từ rồi quay về); overlay giới thiệu hiện cả khi `questions`
  rỗng để luôn có nút **Bắt đầu** hoặc **Thêm từ mới**; điều kiện chơi dùng đúng quy tắc của engine
  (≥ 4 từ và ≥ 4 nghĩa khác nhau) thay vì chỉ đếm số từ; bỏ rung báo "hết giờ" khi vừa mở màn hình.
- `CHANGELOG.md` — ghi lại lỗi và cách sửa.

### Kiểm thử thật

- `npx tsc --noEmit` → **exit 0, 0 lỗi**.
- `npx jest src/games --runInBand` → **20/20 test pass** (engine rush/memory/asteroid không đổi).

### Chưa kiểm chứng

- Chưa bấm thử trên iPhone trong phiên này; luồng mở game → Bắt đầu → hết giờ cần người dùng xác
  nhận trên máy. Chưa có test render cho React Native nên bước tạo lại câu hỏi chỉ được suy luận từ
  code, không phải test UI.

---

## 2026-10-24 — Phiên 11b: nghĩa tiếng Việt đời thường cho danh sách từ dán vào

### Bối cảnh

- Phiên 11 ghi rõ hạn chế: ở chế độ **Nhập danh sách từ**, nghĩa Việt vẫn lấy nguyên từ từ điển nên
  một số từ bị hàn lâm. Người dùng hỏi lại đúng điểm này, nên phiên này sửa nó.
- Ràng buộc: vẫn giữ dữ liệu đã kiểm chứng (IPA, audio, từ loại) của từ điển; không cần key vẫn dùng
  được chế độ danh sách; không thêm thư viện.

### Đã thay đổi

- `src/ai/prompt.ts` — `buildExplainPrompt`: khi request có `explainTerms`, model **chỉ giải nghĩa
  đúng các mục đã dán**, theo thứ tự, và bị yêu cầu viết "nghĩa phổ thông gặp đầu tiên" (2–8 chữ),
  không dùng gloss học thuật; cụm/idiom là một đơn vị, không dịch từng chữ; định nghĩa tiếng Anh
  ở mức A2–B1.
- `src/ai/types.ts`, `src/ai/validate.ts` — thêm `explainTerms` (tối đa 20, không rỗng) và chặn
  request sai trước khi gọi API; `src/ai/gemini.ts`, `src/ai/groq.ts` thêm nó vào chữ ký
  single-flight để hai danh sách khác nhau không dùng chung một request.
- `src/dict/explain.ts` (mới) — `applyExplanations`: thay `meaningVi` bằng bản AI viết, giữ IPA/
  audio/từ loại đã kiểm chứng, đưa nghĩa cũ sang "nghĩa khác", ghi `aiFilled` + nguồn `gemini` (nhãn
  "AI") và tính lại `missing`.
- `src/screens/useWordListLookup.ts` — chạy **song song** một request giải nghĩa cho 20 từ đầu với
  tra từ điển và xác định cấp độ (chờ request chậm nhất, không cộng dồn); danh sách dài hơn 20 từ vẫn
  giữ fallback cũ (AI bổ sung tối đa 5 từ thiếu nghĩa), nhưng bỏ qua các từ đã có trong lô đầu.
  Không có key → dùng nghĩa từ điển và báo nhẹ, không phải lỗi.
- `src/screens/AiStudioScreen.tsx` — hiện trạng thái "AI đang viết nghĩa…", số từ đã dùng nghĩa AI,
  và cảnh báo khi AI lỗi kèm nhắc rằng nghĩa từ điển vẫn lưu được.
- `src/ai/schema.ts` — khi giải nghĩa danh sách, thiếu `partOfSpeech` thì để trống thay vì gán bừa
  "phrase" cho từ đơn.
- README — mô tả lại chế độ nhập danh sách và nguồn của từng trường.

### Kiểm thử thật

- `npx tsc --noEmit` → **exit 0, 0 lỗi**.
- `npx jest --runInBand` → **24/24 suite, 251/251 test pass**; test mới: `prompt.test.ts` (danh sách
  dùng prompt giải nghĩa, không thành prompt chọn từ), `dict/__tests__/explain.test.ts` (thay nghĩa,
  giữ IPA/audio/POS, IPA AI chỉ dùng khi từ điển trống, khớp không phân biệt hoa thường, bỏ qua mục
  rỗng), và một test ở `gemini.test.ts` kiểm tra body gửi đúng thứ tự từ đã dán và nghĩa đời thường
  được trả về.

### Chưa kiểm chứng (phải nói rõ)

- **Chưa gọi AI thật** với key của người dùng trong phiên này; toàn bộ test vẫn dùng `fetch` giả.
  Chất lượng câu chữ thực tế còn phụ thuộc model và cần người dùng thử một danh sách thật.
- Chưa chạy trên iPhone: màn hình trạng thái mới chưa được xem trên thiết bị.
- Từ điển không tìm thấy cụm (ví dụ `civil law`) vẫn không lưu được, dù AI có giải nghĩa — status
  `notFound` giữ nguyên để không âm thầm biến từ sai chính tả thành từ hợp lệ.

---

## 2026-10-24 — Phiên 11: nhạc nền, ba trò chơi, xu ảo, khôi phục chuỗi, giọng đọc và phòng luyện phát âm

### Bối cảnh

- Người dùng muốn app "vui nhộn" hơn: nhạc nền có thể chọn/mute/chỉnh âm lượng, game học từ thật
  (bắn thiên thạch), thêm cách học, giao diện đẹp hơn, **Groq làm AI mặc định**, ghi tên tác giả và
  push lên Git. Yêu cầu kèm theo: sửa lỗi chấm từ đồng nghĩa, hệ thống xu, khôi phục streak và
  kiểm tra phát âm ngay trong kho từ.
- Ràng buộc giữ nguyên: dữ liệu SQLite trên máy, không server, không phá dữ liệu cũ, mọi tính năng
  phải chạy offline (trừ phần gọi AI).

### Đã thay đổi

- **Nhạc nền** — `scripts/generate-music.mjs` tổng hợp 5 bản loop 32–64 giây (focus-forest,
  lofi-night, pixel-run, sunrise, deep-space; 2,7 MB, không dùng mẫu âm thanh có bản quyền).
  `src/music/catalog.ts` (metadata + tìm kiếm), `tracks.ts` (require tĩnh cho Metro),
  `MusicProvider.tsx` (một player duy nhất, loop, **chỉ bắt đầu sau thao tác đầu tiên** để không tự
  phát khi vừa mở app, dừng khi app xuống nền, tôn trọng công tắc im lặng, mix với audio khác),
  `MusicScreen.tsx` (thư viện, tìm kiếm, phát thử, chọn bài, mute, âm lượng),
  `music/duck.ts` + TTS tự giảm nhạc còn 22% khi phát âm. Cài đặt có bật/tắt, âm lượng, mute.
- **Trò chơi** — engine thuần, có test: `src/games/asteroid.ts` (gõ đúng từ để bắn nổ, 3 khiên, combo,
  tốc độ tăng dần, tạm dừng), `rush.ts` (60 giây, 4 đáp án), `memory.ts` (ghép cặp). Màn hình
  `AsteroidGameScreen`, `RushGameScreen`, `MemoryGameScreen`, khung chung `GameShell`, tab **Chơi**
  (`ArcadeScreen`) có kỷ lục từng game. Cả ba có nút **tạm dừng / tiếp tục / thoát** và tự tạm
  dừng khi app xuống nền (`src/games/useGamePause.ts`). Từ của game lấy từ kho hiện tại, **ưu tiên
  từ hay sai** và xáo thứ tự mỗi lượt. Game **không** cộng xu — đúng yêu cầu tách điểm game khỏi tiền xu.
- **Luyện từng kỹ năng** — `SessionConfig.kinds` cho phép một buổi chỉ hỏi một dạng; StudyScreen có
  sáu thẻ: Viết từ, Nghe & chọn, Điền vào câu, Theo định nghĩa, Phân biệt từ, Phát âm.
- **Chấm từ đồng nghĩa** — câu hỏi gõ từ chấp nhận các synonym đã lưu (đã chuẩn hoá), nhưng câu
  chính tả/nghe/cloze vẫn chấm đúng từng chữ; thêm test cho cả hai phía.
- **Hệ thống xu** — `src/coins/values.ts` (bảng giá theo cấp, hệ số mỗi 10 ngày, chặn số dư âm),
  `src/coins/ledger.ts` (ledger append-only; thưởng một lần/từ nhờ unique index; trừ khi ôn sai;
  reset ghi sự kiện), schema **v3** thêm `coin_ledger` + `streak_restores`, và migration đánh dấu
  mọi từ đã học trước bản này bằng một dòng 0 xu để **không thưởng hồi tố**. `recordReview` cộng/trừ
  xu trong **cùng transaction** với điểm và ghi lịch sử ôn. Luyện nói không cộng/trừ.
- **Khôi phục chuỗi** — `streakRestoreOffer` chỉ đề nghị khi bỏ lỡ đúng một ngày và ngày trước đó có
  chuỗi; mục tiêu = 2 × mục tiêu ngày, **chỉ tính từ mới**; mỗi chuỗi chỉ cứu được một lần
  (`lost_from` unique). Ngày đã cứu hiện trong streak nhưng **không** tính vào bộ đếm hệ số xu
  (`bonusStreakDays` cắt tại ngày cứu). Thẻ khôi phục nằm trên trang Hôm nay, có xác nhận trước khi cứu.
- **Xu trên giao diện** — trang Hôm nay hiện số dư + hệ số + số ngày hợp lệ; cuối buổi học hiện tổng
  xu; Cài đặt → **Kinh tế · Xu ảo** có số dư, mốc hệ số kế tiếp, 8 giao dịch gần nhất và nút
  **Reset tiền xu** (hộp thoại cảnh báo, chỉ reset số dư, không đụng từ/streak/lịch sử).
- **Giọng đọc** — `src/speech/voices.ts` chọn giọng theo accent + nam/nữ, ưu tiên bản enhanced/premium,
  báo `exact`/`accent-only`/`none`; `tts.ts` nhận lựa chọn chung qua `configureSpeech` (gọi một lần
  trong `App.tsx`), nên mọi màn hình dùng đúng giọng. Cài đặt thêm ba nút Tự động/Nữ/Nam, cảnh báo
  khi máy chưa cài tổ hợp đó và nút nghe thử.
- **Phòng luyện phát âm** — nút **Kiểm tra phát âm** trong chi tiết từ mở `PronunciationScreen`:
  nghe mẫu, micro, trạng thái nghe/xử lý, bản ghi nhận, kết quả khớp/không khớp, nói lại, chuyển sang
  nhận diện qua mạng khi thiếu gói ngoại tuyến. Màn hình nói rõ đây là so khớp từ, **không phải điểm
  phát âm**, và không đổi xu/streak.
- **Groq là mặc định** — `DEFAULT_SETTINGS.aiProvider = 'groq'` (đã có từ phiên trước) và
  `sanitizeAiProvider` nay trả `groq` cho settings cũ thiếu trường này; thứ tự nút trong Cài đặt là
  Groq trước. Lựa chọn `gemini` đã lưu vẫn được giữ nguyên.
- **Tác giả** — Cài đặt → Thông tin ghi **Dev: Phạm Bảo Lâm**; README cũng ghi tên tác giả.
- **Tài liệu** — README, CHANGELOG, CHECKPOINT.md, CHECKPOINT.json, NEXT_SESSION.md cập nhật theo
  trạng thái thật.

### Kiểm thử thật

- `npx tsc --noEmit` → **exit 0, 0 lỗi** (đã sửa lỗi `TextInput` ref trong màn hình bắn thiên thạch).
- `npx jest --runInBand` → **22/22 suite, 242/242 test pass**, gồm test mới cho xu, hệ số, khôi phục
  chuỗi, chọn giọng, câu hỏi phát âm và chấm synonym.
- `node scripts/verify.mjs` → **ALL PASS** (typecheck + 242 test + checkpoint validate).

### Chưa kiểm chứng (phải nói rõ)

- **Chưa build/chạy trên iPhone** trong phiên này (Windows, không có macOS/EAS): nhạc thật, game,
  micro, giọng nam/nữ và animation chưa được kiểm trên thiết bị.
- Chưa gọi Groq/Gemini/từ điển thật trong phiên này; toàn bộ test AI vẫn dùng `fetch` giả.
- **Nhập danh sách từ vẫn ưu tiên từ điển**, chỉ dùng AI bổ sung nghĩa khi từ điển thiếu — chưa đổi
  sang "Groq là nguồn chính" cho chế độ này. Giữ từ điển vì IPA/audio/offline, nhưng nghĩa Việt vẫn
  có thể hàn lâm ở một số từ.
- Chưa có collocation training, sentence building hay synonym challenge riêng; mới có sáu dạng luyện
  ở trên.
- Hiệu ứng âm thanh trong game (SFX) chưa có; game dùng haptics của iOS.

---

## 2026-10-23 — Phiên 10: Groq là nhà cung cấp AI thứ hai + cấp độ tự tra cho danh sách từ

### Bối cảnh

- Log trên máy (01:16–01:17) cho thấy `gemini-3.8-flash` trả 503 "high demand" liên tiếp; người dùng
  muốn **thử Groq** vì cho rằng nó ổn định/nhanh hơn. Quyết định: **thêm** Groq, không thay Gemini —
  hai bên có key và model riêng, đổi qua lại bằng một lần bấm, nên vẫn so sánh được chất lượng.
- Ở chế độ **Nhập danh sách từ**, cả danh sách đang bị gán **một** cấp độ người dùng bấm, dù
  `water` và `unprecedented` không cùng band. Yêu cầu: app tự tra cấp độ cho từng từ.

### Đã thay đổi

- `src/ai/groq.ts` (mới) — client `POST https://api.groq.com/openai/v1/chat/completions`:
  `Bearer` key, `response_format: {type:"json_object"}`, `max_completion_tokens` theo số từ,
  `reasoning_format: "hidden"` + `reasoning_effort: "low"` cho gpt-oss (qwen3 dùng `none`), bỏ hai
  field này với model không phải reasoning. Retry 3 lần/backoff, tôn trọng `retry-after`;
  phân biệt 429 **theo phút** (retry được) với 429 **theo ngày** (`quota_exceeded`, không retry);
  404 model bị ngừng → hỏi `GET /openai/v1/models` và đổi **một lần** sang model còn hoạt động.
  `checkGroqKey` kiểm tra key + model mà không tốn token sinh nội dung.
- `src/ai/provider.ts` (mới) — mỗi nhà cung cấp một ô Keychain riêng (`gemini_api_key`,
  `groq_api_key`); key Groq phải bắt đầu `gsk_` nên dán nhầm key Gemini bị chặn ngay trên máy.
- `src/ai/index.ts` (mới) — `generateVocabulary`/`checkProviderKey` chọn provider từ Cài đặt;
  màn hình không tự quyết định gọi API nào.
- `src/ai/levels.ts` (mới) — **một** request cho cả danh sách, trả `{levels:[{term,level}]}`;
  chỉ nhận level nguyên 0–6 và đúng term đã hỏi; lỗi/không có key → trả message, **không ném**.
- `src/data/packs.ts` — `packLevel(term, track)`: cấp độ từ kho 134 từ có sẵn, miễn phí và tức thì.
- `src/dict/types.ts`, `src/dict/lookup.ts` — `DictEntry.level` + `levelSource` (`pack`/`ai`),
  `entryToWordInput` dùng cấp độ đã tra trước, chỉ fallback mới dùng cấp độ trong Cài đặt.
- `src/screens/useWordListLookup.ts` — khởi động request cấp độ **song song** với tra từ điển
  (chờ max của hai, không phải tổng); sửa luôn lỗi cũ: "Thử lại từ lỗi" làm mất các từ đã tra xong.
- `src/screens/AiStudioScreen.tsx` — chế độ Gemini đổi tên thành **AI chọn từ**, copy theo provider;
  ở chế độ danh sách **ẩn LevelPicker** và ghi rõ cấp độ do app tự xác định; mỗi thẻ hiện
  `A2/B1… · có sẵn | AI ước lượng | chưa rõ cấp độ`; lưu kèm cấp độ đó.
- `src/screens/SettingsScreen.tsx` — mục **AI** có nút chọn Gemini/Groq, key + model riêng cho từng
  bên, nút **Lấy key** mở đúng trang, "Kiểm tra key + model" theo provider.
- `src/types.ts`, `src/db/settings.ts` — `aiProvider` + `groqModel` (mặc định `openai/gpt-oss-120b`),
  sanitize + migration cho settings cũ; `DEFAULT_SETTINGS.aiProvider = 'gemini'`.
- `src/ai/diagnostics.ts` — mỗi dòng log ghi thêm provider (gemini/groq).
- `src/ai/errors.ts` — che `gsk_…` và header `Authorization: Bearer`; `describeAiError(error, label)`
  để câu báo lỗi dùng đúng tên nhà cung cấp.
- `src/ai/validate.ts` (mới) — `assertRequest` dùng chung cho cả hai provider.
- README, CHECKPOINT.md, CHECKPOINT.json, NEXT_SESSION.md — cập nhật trạng thái và số liệu thật.

### Kiểm thử thật

- `npx tsc --noEmit` → **exit 0, 0 lỗi**.
- `npx jest --ci --maxWorkers=2` → **16/16 suite, 186/186 test pass** (thêm 31 test: Groq 14,
  levels 6, packLevel 3, settings 5, errors 2, entryToWordInput 1). `npx jest --ci` mặc định vẫn
  hết bộ nhớ worker trên Windows.
- `node scripts/verify.mjs` → **ALL PASS**.

### Đã kiểm chứng trên máy (người dùng báo, 2026-10-23)

- **Groq chạy thật và mượt**: người dùng báo "groq chạy cực mượt và tốt" sau khi dùng trong app.
  Đây là báo cáo của người dùng, **không phải** quan sát của phiên làm việc này: không có build
  number, ảnh chụp hay log, và chưa đo latency/hạn mức.

### Chưa kiểm chứng (phải nói rõ)

- Chưa kiểm **thẻ cấp độ CEFR** ở chế độ Nhập danh sách trên máy, chưa kiểm Gemini sau thay đổi.
- Request shape, retry, quota và model replacement của Groq trước đó chỉ được chứng minh bằng
  `fetch` giả; đường chạy thật nay đã có người dùng xác nhận nhưng vẫn chưa đo số liệu.
- Số liệu Groq dưới đây lấy từ docs ngày 2026-10-23, có thể đổi: `openai/gpt-oss-120b`,
  `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` là model production/preview còn dùng; `llama-3.3-70b-versatile`
  đã chuyển sang Enterprise (không dùng được với key miễn phí). Base limits ~30 RPM, 1K RPD,
  8K TPM (gồm cả input), 200K TPD.

---

## 2026-10-23 — Phiên 9: đổi model khi Gemini quá tải (503)

### Bối cảnh

Log trên máy cho thấy `gemini-3.8-flash` trả **HTTP 503 "This model is currently experiencing
high demand"** cho cả 3 lần thử của hai yêu cầu liên tiếp: app chỉ thử lại đúng model đang quá tải,
nên người dùng chờ ~40 giây rồi vẫn không có từ nào.

### Đã thay đổi

- `src/ai/gemini.ts` — lần thử **đầu tiên** gặp `server` (5xx) hoặc `rate_limited` (429 theo phút)
  thì hỏi Google danh sách model (`GET /v1beta/models`) và chuyển sang model kế tiếp theo
  `rankModels`, gọi lại ngay, **không chờ backoff**. Mỗi lần tạo chỉ đổi một lần.
  Nếu model thay thế cũng quá tải thì chỉ thử thêm 1 lần rồi báo lỗi — việc đổi model không làm
  tăng ngân sách retry (vẫn tối đa 3 lần gọi sinh nội dung như cũ).
  `quota_exceeded` (hết hạn mức ngày) vẫn **không** retry và **không** đổi model.
- `src/ai/types.ts` — `AiResult.fallbackReason: 'retired' | 'overloaded'`.
- `src/screens/AiStudioScreen.tsx` — ghi chú đúng lý do: model quá tải (cài đặt không đổi) hay
  model bị Google ngừng (nên lưu model mới).
- `src/ai/errors.ts` — gợi ý lỗi 5xx nhắc chọn model khác trong Cài đặt.
- `src/ai/__tests__/gemini.test.ts` — 2 test mới (503 → đổi model trong 1 lần thử; cả hai model
  đều 503 → dừng sau 3 lần gọi sinh nội dung), cập nhật test 503 cũ.

### Kiểm thử thật

- `npx tsc --noEmit` → 0 lỗi.
- `npx jest --ci --maxWorkers=2` → **14/14 suite, 155/155 test pass** (chạy mặc định bị Jest hết
  bộ nhớ worker trên Windows; chạy lại với 2 worker thì pass — không phải lỗi code).
- Chưa gọi Gemini thật cho nhánh mới: test dùng `fetch` giả, không có key trong môi trường này.

---

## 2026-10-23 — Phiên 8: Dictionary API + 2 cách tạo bộ từ

### Bối cảnh

Người dùng muốn giảm phụ thuộc Gemini: có thêm cách nhập danh sách từ rồi để **từ điển** tra dữ liệu,
Gemini chỉ còn lo phần nó làm tốt. Yêu cầu kèm: đánh giá nguồn `dict.minhqnd.com` bằng cách kiểm
tra thật, không tích hợp theo phỏng đoán.

### Đã xác minh với dịch vụ thật (2026-10-22/23)

| Kiểm tra | Kết quả thật |
|---|---|
| `api.dictionaryapi.dev/api/v2/entries/en/{criminal,civil,justice,evidence}` | 200, có IPA + mp3 + định nghĩa + ví dụ (không phải từ nào cũng có ví dụ) |
| Từ không tồn tại trên dịch vụ đó | **HTTP 530, body `error code: 1033`** (không phải 404 JSON) — đã ghi vào code là trường hợp "không tìm thấy" và **không retry** |
| `dict.minhqnd.com/api/v1/lookup?word=criminal&lang=en` | 200, **nghĩa tiếng Việt**, IPA, audio TTS, `pos` tiếng Việt, CORS mở, không cần key |
| Cùng 4 từ trên minhqnd | 200, nghĩa Việt đúng, IPA đúng |
| Từ không tồn tại trên minhqnd | **404** `{"exists": false, "word": "..."}` |
| Cụm từ `civil law` | **404 ở cả hai** — từ điển chỉ tra từ đơn |
| Giấy phép | minhqnd: CC BY-SA 4.0 (bắt buộc ghi công); dictionaryapi: CC BY-SA 3.0 (Wiktionary) |

### Đã thay đổi

- **Mới** `src/dict/types.ts` — kiểu dữ liệu tra từ, mã lỗi, nhãn trường thiếu.
- **Mới** `src/dict/list.ts` — `parseWordList`: tách phẩy/chấm phẩy/xuống dòng, trim, gộp khoảng
  trắng, bỏ mục rỗng, bỏ trùng không phân biệt hoa/thường, giữ thứ tự, tối đa 50 từ, báo rõ mục bị bỏ.
- **Mới** `src/dict/sources.ts` — hai nguồn + parser thuần; map `Tính từ → adjective`; lọc IPA rác
  (`ʹsĭv-əl`), ghép URL audio, chỉ nhận ví dụ có chứa từ.
- **Mới** `src/dict/lookup.ts` — điều phối: cache trước, 2 request song song/từ, limiter 3,
  deadline 8 giây, retry 2 lần (mạng/timeout/429/5xx, backoff + jitter, tôn trọng `Retry-After` cap 3 s),
  merge (nghĩa Việt + IPA ưu tiên minhqnd; định nghĩa + ví dụ + mp3 ưu tiên Wiktionary), tính
  `missing`, Gemini bổ sung nghĩa Việt tối đa 5 từ và gắn nhãn `gemini`.
- **Mới** `src/db/dictCache.ts` — cache SQLite (`dictionary_cache`) + cache bộ nhớ + `pruneDictCache`
  gọi lúc mở app (xoá bản quá 90 ngày).
- **Mới** `src/screens/useWordListLookup.ts` — hook trạng thái: tiến trình `12/30 từ`, kết quả về
dần từng từ, huỷ, thử lại **chỉ từ lỗi**, chọn/bỏ chọn.
- `src/db/schema.ts` — **schema v2**: `words.dict_source`, `words.missing_fields`, bảng
  `dictionary_cache` + index; `rowToWord`, `WORD_COLUMNS`, `wordInsertValues` cập nhật theo.
- `src/db/words.ts` — `createWord`/`updateWord` lưu nguồn từ điển và trường thiếu; `WordSource` thêm `dictionary`.
- `src/screens/AiStudioScreen.tsx` — màn hình đổi thành **Tạo bộ từ** với hai chế độ; chế độ danh
  sách có ô nhập nhiều dòng, đếm từ hợp lệ, tiến trình, huỷ, thẻ kết quả ghi nguồn + trường thiếu,
  nút thử lại từ lỗi, ghi công hai từ điển (bấm mở dict.minhqnd.com).
- `src/screens/WordDetailScreen.tsx` — nguồn "Tra từ điển (minhqnd+wiktionary)" + dòng "Còn thiếu".
- `src/state/AppProvider.tsx` — dọn cache từ điển cũ khi mở app (best effort).
- Docs: `docs/DICTIONARY.md` (endpoint, JSON thật, giấy phép, giới hạn, bảng test), README, checkpoint.

### Kiểm thử

| Bước | Kết quả |
|---|---|
| `npm run typecheck` | exit 0, 0 lỗi |
| `npm test -- --ci` | **14/14 suite, 153/153 test pass** |
| Tra thật 6 từ (criminal, civil, justice, evidence, zzqqxxvvyy, civil law) | **906 ms**; 4 found đủ dữ liệu, 1 notFound, 1 cụm từ notFound |
| SQLite thật (`node:sqlite`) migration 1 → 2 có dữ liệu cũ | từ cũ giữ `reps`/`stability`/`due_at`; cột mới `NULL`/`'[]'`; insert 33 cột khớp 33 giá trị |

### Lỗi/hạn chế còn lại

- **Chưa chạy trên iPhone**: chưa build, chưa bấm thử hai chế độ; `AbortController` của React Native chưa kiểm chứng.
- Chưa gọi Gemini thật trong luồng nhập danh sách (nhánh bổ sung nghĩa Việt mới chỉ test bằng mock).
- Từ điển chỉ tra **từ đơn**; cụm từ phải thêm tay (app báo rõ).
- Không có bản dịch câu ví dụ; `exampleVi` để trống thay vì dịch máy.
- Rate limit của minhqnd không được công bố → app tự giới hạn 3 request đồng thời, 2 lần thử.

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
| `npm test -- --ci` | **11/11 suite, 125/125 test pass** |
| `node scripts/validate-checkpoint.mjs` | hợp lệ (44 file trong `important_files`) |
| `node scripts/verify.mjs` | xem `tools/verify-report.txt` |

Test AI dùng `fetch` giả: 503 → thành công, 401 không retry, 429 theo ngày không retry,
MAX_TOKENS → `json_parse` + 1 lần thử lại, count 25 bị chặn trước khi gọi mạng, hai request giống nhau
dùng chung 1 lời gọi, request khác nhận `busy`, diagnostics không chứa `AIza`, salvage JSON bị cắt,
`fetch` treo → `timeout` sau deadline, huỷ giữa lúc `fetch` treo → `cancelled` ngay.

### Kho từ đi kèm — bắt đầu (134/5.000)

Người dùng muốn 2.500 General + 2.500 IELTS có sẵn trong máy, level càng cao càng ít từ, ưu tiên từ
trọng dụng. Đã làm hạ tầng + lô đầu tiên:

- **Mới** `src/data/packs.ts` — định dạng `PackRow` gọn (term, nghĩa, từ loại, level, chủ đề, định
  nghĩa, ví dụ), `TARGET_DISTRIBUTION` cho cả hai track (mỗi track 2.500, giảm dần theo level),
  94 từ General + 40 từ IELTS đã viết tay.
- `src/db/database.ts` — `SEED_VERSION = '2'`, gộp `SEED_WORDS` + pack, vẫn `INSERT OR IGNORE` theo
  unique index `(normalized_term, track)` nên không sửa từ cũ, không mất tiến độ FSRS.
- **Mới** `docs/WORD_BANK.md` — phân bổ theo level, tiêu chí chọn từ, so sánh API miễn phí
  (Free Dictionary API, Datamuse, CMUdict, wordfreq, Wiktionary, Gemini build-time) và giấy phép
  (Oxford 3000/5000 có bản quyền; dataset EN–VI trôi nổi thường không rõ giấy phép).
- **Mới** test `src/data/__tests__/packs.test.ts` — chặn từ trùng trong track và với seed, nghĩa rỗng
  hoặc trùng từ tiếng Anh, level sai, ví dụ không chứa từ, tổng phân bổ khác 2.500.

Chưa có IPA cho lô này: thà để trống (UI dùng TTS) hơn là bịa phiên âm.

### Chưa kiểm chứng

- **Chưa có lần gọi Gemini thật nào** bằng key người dùng sau thay đổi này.
- Kho từ mới **chưa chạy trên máy**: 134 từ mới được nạp khi cài bản build tiếp theo; chưa kiểm tra
  thời gian nạp và việc giữ nguyên từ người dùng đã sửa trên dữ liệu thật.
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
