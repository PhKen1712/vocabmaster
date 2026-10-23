# VocabMaster

Ứng dụng học từ vựng tiếng Anh cá nhân trên iPhone, viết bằng React Native + Expo, có
**widget thật** trên màn hình chính và màn hình khóa, ôn tập theo FSRS, hai hệ thống
General English / IELTS, phát âm, luyện nói, streak, nhắc nhở, gợi ý từ bằng **Groq (mặc định)
hoặc Gemini**, **tra từ điển miễn phí** (nghĩa Việt + IPA + ví dụ) cho danh sách từ bạn tự nhập,
**nhạc nền tự tạo**, **ba trò chơi học từ**, **xu ảo** và **khôi phục chuỗi ngày học**.

**Dev: Phạm Bảo Lâm**

- Đường dẫn dự án: `C:\Users\Lenovo\Desktop\VocabMaster`
- Nền tảng: iOS 18+ (iPhone), phát triển trên Windows
- Dữ liệu: SQLite trên máy, không có server

## Đọc trước

1. **`docs/FEASIBILITY.md`** — vì sao widget dữ liệu thật cần Apple Developer Program
   (99 USD/năm) do App Groups, và các phương án miễn phí bị giới hạn ra sao.
2. **`docs/BUILD_AND_INSTALL.md`** — từng bước cài công cụ, build cloud, cài lên iPhone.
3. **`CHECKPOINT.md`** / **`NEXT_SESSION.md`** — trạng thái thật của dự án cho phiên/AI tiếp theo.

## Yêu cầu môi trường

- Windows 10/11
- Git for Windows (có Git Bash) — bắt buộc để chạy lệnh
- Node.js 22.13+ hoặc 24/26 LTS
- Tài khoản Expo miễn phí (để build cloud)
- Apple Developer Program nếu muốn widget đọc dữ liệu thật
- iPhone chạy iOS 18+

## Cài đặt

```bash
cd "C:/Users/Lenovo/Desktop/VocabMaster"
node scripts/setup.mjs     # npm install + expo install đúng phiên bản SDK 58
npm run typecheck
npm test
```

`scripts/setup.mjs` không xoá file, không sửa Git, chỉ cài dependency và đồng bộ phiên bản
native module với Expo SDK.

## Chạy khi phát triển

```bash
npm start
```

- Cần **development build** đã cài trên iPhone (không dùng Expo Go cho widget/nhận diện giọng nói).
- Metro chạy trên Windows; điện thoại cùng mạng Wi-Fi.

## Cấu hình AI (Gemini hoặc Groq)

Chọn nhà cung cấp trong **Cài đặt → AI** bằng hai nút **Gemini** / **Groq**. Mỗi bên có key và
model riêng, lưu ở hai ô Keychain khác nhau, nên đổi qua lại **không mất key** và không phải dán lại.

| | Groq (mặc định) | Gemini |
|---|---|---|
| Lấy key | https://console.groq.com/keys | https://aistudio.google.com/apikey |
| Dạng key | `gsk_…` | `AIza…` |
| Model mặc định | `openai/gpt-oss-120b` | `gemini-3.8-flash` |
| Điểm mạnh | Trả lời rất nhanh, ít bị 503 hơn | Tiếng Việt và IPA tốt hơn |
| Hạn mức miễn phí | Theo model, theo ngày | ~1.000 request + 8.000 token/phút + 200.000 token/ngày |

Groq dùng model nhỏ hơn Gemini nên nghĩa tiếng Việt và phiên âm có thể kém chính xác hơn — hãy
đọc lại thẻ từ trước khi lưu, và đổi lại Gemini bằng một lần bấm nếu thấy không ổn.

1. Bấm **Lấy key** trong mục AI để mở đúng trang tạo key.
2. Dán key vào ô API key của nhà cung cấp đó rồi bấm **Lưu key**. Key sai định dạng (ví dụ dán key
   Gemini vào ô Groq) bị từ chối ngay trên máy, không gửi đi đâu.
3. Key được lưu trong Keychain của iPhone, không nằm trong mã nguồn/Git/backup.
4. Nếu nhà cung cấp ngừng model đang cấu hình, app tự chuyển sang model còn khả dụng (Gemini:
   danh sách `/v1beta/models`; Groq: `GET /openai/v1/models`) và báo trong AI Studio; bấm
   **Kiểm tra key + model** trong Cài đặt để xem gợi ý và lưu lại tên model mới bằng một lần bấm.
5. Khi Gemini lỗi, app phân loại nguyên nhân (key sai, hết hạn mức, mạng, timeout, model bị ngừng,
   JSON bị cắt, dữ liệu không hợp lệ) thay vì báo chung "lỗi tạm thời". Lỗi tạm thời (5xx, mất mạng,
   timeout, rate limit) được tự thử lại tối đa 3 lần với exponential backoff + jitter; key sai và hạn
   mức thì **không** thử lại. Câu báo lỗi có nút **Thử lại** khi phù hợp và dòng "Kỹ thuật" ghi mã lỗi
   + HTTP status. Trong lúc chờ có đồng hồ giây và nút **Huỷ**; mỗi lần gọi có deadline 20 giây nên
   màn hình không thể treo vô hạn (rời màn hình cũng tự huỷ request). Lỗi timeout **không** được tự
   thử lại vì làm vậy chỉ khiến bạn chờ thêm rồi vẫn nhận đúng một thông báo.
6. **Cài đặt → AI → "Lần gọi AI gần đây"** ghi lại các lần gọi trong bộ nhớ của phiên hiện tại:
   nhà cung cấp (gemini/groq), giai đoạn (request → response → parse → validate), HTTP status, mã
   lỗi, model, thời gian.
   Không có API key, không có nội dung bạn học, không gửi đi đâu.
7. Không có key: mọi chức năng học, ôn, tìm kiếm, nhập CSV, widget vẫn hoạt động.

**Cảnh báo bảo mật:** app gọi nhà cung cấp AI trực tiếp từ iPhone. Key lưu trên máy có thể bị lộ nếu
máy jailbreak hoặc bị mở khoá. Với app cá nhân, đây là đánh đổi để tránh chi phí backend.
Không dán key vào chat, ảnh chụp màn hình, commit, hay file checkpoint.

## Kho từ đi kèm (offline)

App tự nạp một kho từ đã kiểm tra sẵn khi cài/cập nhật: hiện **134 từ** (94 General, 40 IELTS),
không cần key, không gọi mạng. Kế hoạch mở rộng lên **2.500 General + 2.500 IELTS**, số từ giảm dần
khi level tăng. Chi tiết phân bổ, tiêu chí chọn từ, nguồn dữ liệu miễn phí và giấy phép:
[docs/WORD_BANK.md](docs/WORD_BANK.md).

Từ mới được thêm bằng `INSERT OR IGNORE` theo khoá `(normalized_term, track)`, nên khi cập nhật app:
từ đã có **không bị sửa**, nghĩa bạn đã chỉnh **không bị ghi đè**, tiến độ FSRS **không mất**.

## Tạo bộ từ: hai cách

Màn hình **Tạo bộ từ** có hai chế độ, cùng nằm trên tab Từ vựng:

1. **AI chọn từ** — chọn track/level/chủ đề/số từ, Gemini hoặc Groq (theo Cài đặt) đề xuất, bạn
   sửa và chọn từng từ.
2. **Nhập danh sách từ** — dán `criminal, civil, justice, evidence` (cách nhau bằng phẩy, chấm phẩy
   hoặc xuống dòng). App chuẩn hoá danh sách, **tra từ điển** để lấy IPA/audio, và nếu đã cấu hình key
   thì gửi **một** request AI viết nghĩa tiếng Việt đời thường cho tối đa 20 từ đầu. Không có key vẫn
   dùng được bằng nghĩa từ điển.

Chế độ 2 dùng hai nguồn miễn phí, không cần key:

| Nguồn | Dữ liệu | Giấy phép |
|---|---|---|
| [dict.minhqnd.com](https://dict.minhqnd.com) | Nghĩa tiếng Việt, IPA, audio TTS, từ loại | CC BY-SA 4.0 — có ghi công trong app |
| [api.dictionaryapi.dev](https://dictionaryapi.dev) | Định nghĩa tiếng Anh, câu ví dụ, đồng/trái nghĩa, mp3 | CC BY-SA 3.0 (Wiktionary) |

Điều đáng biết:

- Mỗi từ được tra **song song** nhưng giới hạn 3 request cùng lúc; tiến trình hiện `12/30 từ`, có nút **Huỷ**.
- Kết quả được **cache trên máy 30 ngày**: tra lại cùng từ không tốn request và vẫn dùng được offline.
- Trường thiếu được **đánh dấu**, không bịa: thẻ từ ghi "Thiếu: phiên âm IPA, từ đồng nghĩa…",
  lưu vào `missing_fields` và hiện lại ở màn hình chi tiết.
- Nghĩa tiếng Việt ưu tiên bản **AI viết ngắn, đời thường** thay vì gloss hàn lâm của từ điển
  (ví dụ `make a decision` → "đưa ra quyết định", không phải "thi hành phán quyết"); nghĩa từ điển cũ
  vẫn được giữ ở mục "nghĩa khác", IPA/audio/từ loại vẫn lấy từ từ điển và thẻ từ ghi rõ nguồn AI.
  Danh sách dài hơn 20 từ: các từ sau dùng nghĩa từ điển, từ nào từ điển không có nghĩa mới để AI bổ
  sung tối đa 5 từ như trước.
- **Cấp độ được tra tự động cho từng từ**, không lấy theo mức bạn chọn: từ có trong kho từ kèm app
  lấy ngay cấp độ đã kiểm tra; các từ còn lại được AI xếp CEFR trong **một** request cho cả danh
  sách (không phải một request mỗi từ). Thẻ từ ghi rõ `A2` / `B1`… kèm nguồn ("cấp độ có sẵn"
  hoặc "AI ước lượng"); từ chưa xác định được ghi "chưa rõ cấp độ" và chỉ khi đó mới dùng cấp độ
  trong Cài đặt — thông báo trên màn hình nói rõ điều này.
- Chỉ tra được **từ đơn**; cụm như `civil law` bị cả hai từ điển từ chối và app nói rõ lý do.
- Retry chỉ áp dụng cho mạng/timeout/429/5xx (tối đa 2 lần, deadline 8 giây). Từ sai chính tả
  không bị thử lại.

Chi tiết endpoint, JSON thật, quy tắc ghi công và giới hạn: **[docs/DICTIONARY.md](docs/DICTIONARY.md)**.

## Build iOS và cài lên iPhone

**Có hai đường, khác nhau về tiền và widget:**

| Đường | Chi phí | Widget | Hạn dùng |
|---|---|---|---|
| Sideload bằng Apple ID miễn phí | 0 | **Không** (Apple không cấp App Groups) | 7 ngày, phải ký lại |
| Apple Developer Program | 99 USD/năm | Đầy đủ, dữ liệu thật | Không hết hạn |

Đường miễn phí (GitHub Actions macOS + Sideloadly): xem
**[`docs/FREE_SIDELOAD.md`](docs/FREE_SIDELOAD.md)** — 5 bước, không cần Mac.

Đường trả phí (EAS Build), chi tiết trong `docs/BUILD_AND_INSTALL.md`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --platform ios --profile development
```

Mở link build trên iPhone để cài. Lần đầu bật Developer Mode trong Cài đặt iOS.

## Widget

- **Từ vựng hôm nay**: Small / Medium / Large — từ trong ngày, IPA, nghĩa, số từ cần ôn,
  tiến độ mục tiêu, chuỗi ngày.
- **Ôn tập nhanh**: Lock Screen Circular / Rectangular / Inline — số từ cần ôn, chuỗi ngày.

Cách thêm: giữ màn hình chính → **+** → VocabMaster. Màn hình khóa: giữ → Tuỳ chỉnh →
Thêm widget → VocabMaster.

iOS quyết định thời điểm làm mới widget; app đẩy dữ liệu khi bạn học/sửa từ/mở lại app.
Widget không gọi mạng và không gọi Gemini.

## Nhạc nền, trò chơi và xu ảo

- **Nhạc nền**: 5 bản loop tự tạo bằng script (`scripts/generate-music.mjs`), không dùng âm thanh có
  bản quyền, tổng dung lượng khoảng 2,7 MB. Tab **Chơi → Nhạc nền** (hoặc Cài đặt) có tìm theo tên/tâm
  trạng, chọn bài, bật/tắt, mute và âm lượng 0–100%. Nhạc **không tự phát khi vừa mở app** — chỉ bắt
  đầu sau thao tác đầu tiên; sau đó tự dừng khi app xuống nền và tự giảm khi phát âm từ hoặc luyện
  nói. Lựa chọn lưu trong SQLite nên mở lại app vẫn giữ nguyên.
- **Ba trò chơi** dùng chính bộ từ của bạn (ưu tiên từ hay sai, đổi thứ tự mỗi lượt):
  - **Bắn thiên thạch**: đọc nghĩa tiếng Việt trên thiên thạch và gõ đúng từ tiếng Anh để bắn nổ;
    gõ sai không được điểm, thiên thạch chạm đáy mất một khiên, có combo và tạm dừng.
  - **60 giây**: chọn nghĩa đúng nhanh nhất trong 60 giây.
  - **Cặp đôi từ vựng**: lật thẻ ghép từ với nghĩa.

  Cả ba game đều có nút **tạm dừng / tiếp tục / thoát**, và tự tạm dừng khi bạn chuyển app sang nền
  để không mất lượt chơi trong lúc nghe điện thoại.
- **Xu ảo** (không phải tiền thật, không quy đổi): từ mới trả 100 xu (Starter) → 1.000 xu (C1/C2)
  khi bạn trả lời đúng **lần đầu**; mỗi 10 ngày học liên tục tăng hệ số 0,1; ôn sai bị trừ đúng giá
  trị gốc của từ và số dư không bao giờ âm. Toàn bộ giao dịch nằm trong một ledger SQLite, mỗi từ chỉ
  được thưởng một lần (ràng buộc bằng unique index), và không cộng/trừ xu khi luyện nói.
- **Khôi phục chuỗi**: nếu bỏ lỡ đúng một ngày, app hiện thẻ "Bạn đã mất chuỗi N ngày"; học **gấp đôi**
  số từ mới trong ngày (chỉ từ mới, không tính ôn) để nối lại. Chuỗi chỉ được cứu một lần, và sau khi
  cứu hệ số thưởng xu trở về 1,0.
- **Kiểm tra phát âm**: mở một từ trong kho → **Kiểm tra phát âm** để nghe mẫu và đọc lại. Kết quả nói
  thật: app chỉ xác nhận hệ thống có nhận ra đúng từ hay không, không chấm điểm từng âm vị. Nếu
  iPhone chưa có gói nhận diện tiếng Anh ngoại tuyến (hoặc Siri/Đọc chính tả đang tắt), app tự chuyển
  sang nhận diện qua mạng **một lần** và ghi rõ âm thanh được gửi tới Apple; lỗi quyền micro có nút
  mở thẳng Cài đặt iOS.
- **Giọng đọc**: chọn Anh–Mỹ / Anh–Anh và Tự động / Nữ / Nam; nếu iPhone chưa cài tổ hợp đó, app nói
  rõ đang dùng giọng thay thế thay vì âm thầm đổi giọng.

## Dữ liệu và sao lưu

- **Xuất JSON**: Cài đặt → Dữ liệu → Xuất JSON (gồm từ, lịch sử ôn, cài đặt; **không** có key).
- **Xuất CSV**: để mở bằng Excel/Numbers.
- **Khôi phục JSON**: chọn Gộp hoặc Thay thế (có xác nhận).
- **Nhập CSV**: cần cột `term` và `meaning_vi`; hỗ trợ thêm `ipa`, `part_of_speech`,
  `example_en`, `example_vi`, `topic`, `track`, `level`, `note`, `synonyms`…
- Nên xuất JSON trước khi cập nhật app hoặc đổi máy.

## Cấu trúc thư mục

```
VocabMaster/
├── App.tsx                 # providers + router + tab bar
├── app.json                # cấu hình Expo, widget target, quyền micro
├── eas.json                # profile build
├── widgets/                # widget SwiftUI (DailyWord, ReviewGlance)
├── src/
│   ├── ai/                 # AI client (Gemini + Groq), prompt, validate, levels
│   ├── components/         # UI primitives + patterns
│   ├── data/seed.ts        # 40 từ khởi tạo (General + IELTS)
│   ├── db/                 # schema, migration, repository, backup
│   ├── lib/                # text, date, id
│   ├── navigation/         # stack + tab
│   ├── notifications/      # nhắc nhở hằng tuần
│   ├── quiz/               # sinh câu hỏi + chấm điểm
│   ├── screens/            # 11 màn hình
│   ├── speech/             # TTS, nhận diện, phản hồi
│   ├── srs/                # FSRS
│   ├── state/              # AppProvider
│   ├── streak/             # streak thuần
│   ├── theme/              # design tokens
│   └── widgets/            # snapshot + sync
├── docs/                   # khả thi, kiến trúc, build, test
└── scripts/                # setup, validate checkpoint
```

## Giới hạn đã biết

- Widget cần Apple Developer Program trả phí (App Groups) và một lần build native.
- Không chấm điểm phát âm theo âm vị; chỉ so khớp từ bằng nhận diện giọng nói.
- Widget không cập nhật tức thì; iOS điều tiết tần suất.
- Gemini có thể trả dữ liệu sai; mọi từ phải qua bước xem/sửa/lưu.
- Không hỗ trợ Android (cấu hình `platforms: ["ios"]`).
- Chưa có đồng bộ nhiều thiết bị (dữ liệu cục bộ, backup thủ công).

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Bash is required but was not found` | Cài Git for Windows, mở lại app; hoặc đặt `CODEBUFF_GIT_BASH_PATH` |
| Typecheck lỗi sau `npm install` | Chạy `npx expo install --fix` |
| App trắng màn hình sau khi cài | Xem log Metro; thường do native module chưa build lại |
| Widget không xuất hiện | Mở app một lần; kiểm tra target extension trong `ios/`; build lại |
| Widget không đổi số liệu | Mở app lại; iOS trễ refresh; kiểm tra App Group trong Signing |
| Không phát âm thanh | Tắt chế độ im lặng; tăng âm lượng; cài voice trong Cài đặt iOS |
| Micro không nhận / "chưa nhận diện được giọng nói" | Cài đặt iOS → VocabMaster → Micro + Nhận diện giọng nói; bật Siri/Đọc chính tả nếu dùng nhận diện ngoại tuyến; hoặc tắt "Nhận diện trên thiết bị" để dùng qua mạng |
| 429 (Gemini hoặc Groq) | Chờ vài phút; giảm số từ; kiểm tra hạn mức model. Nếu là hạn mức theo ngày, app báo riêng và không tự thử lại |
| 403 / 401 | Key sai, hoặc key Groq dán vào ô Gemini (hoặc ngược lại) |
| 503 / "đang bận" | App đã tự thử lại 3 lần (Gemini còn tự đổi model khi model quá tải); chờ khoảng 1 phút rồi bấm **Thử lại** |
| "... phản hồi quá lâu" | Giảm số từ cần tạo (5–8 từ) rồi thử lại |
| "Không đọc được JSON" / "dữ liệu không dùng được" | Câu trả lời bị cắt hoặc bị chặn; bấm **Thử lại** với ít từ hơn |
| Groq 429 liên tục | Hạn mức Groq tính theo phút (8.000 token): chờ ~1 phút hoặc tạo ít từ hơn mỗi lần |
| Không biết lỗi ở đâu | Cài đặt → AI → **Lần gọi AI gần đây** (nhà cung cấp + mã lỗi + HTTP status từng bước) |
| Không mở được DB sau cập nhật | Đóng hẳn app, mở lại; migration rollback giữ dữ liệu cũ |

## Kiểm thử

```bash
npm test              # 16 bộ unit test, 186 test
npm run typecheck     # TypeScript strict
node scripts/validate-checkpoint.mjs
```

Trạng thái thật của các lần chạy nằm trong `CHECKPOINT.json → test_results`.

## Tài liệu bàn giao

- `CHECKPOINT.md` — bàn giao đầy đủ cho AI/người tiếp theo
- `CHECKPOINT.json` — trạng thái máy đọc được
- `CHANGELOG.md` — lịch sử thay đổi theo phiên
- `NEXT_SESSION.md` — việc cần làm ngay
- `docs/FEASIBILITY.md`, `docs/ARCHITECTURE.md`, `docs/BUILD_AND_INSTALL.md`, `docs/TEST_PLAN.md`
