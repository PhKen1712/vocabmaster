# VocabMaster

Ứng dụng học từ vựng tiếng Anh cá nhân trên iPhone, viết bằng React Native + Expo, có
**widget thật** trên màn hình chính và màn hình khóa, ôn tập theo FSRS, hai hệ thống
General English / IELTS, phát âm, luyện nói, streak, nhắc nhở, gợi ý từ bằng **Groq (mặc định)
hoặc Gemini**, **nhập danh sách từ và cụm từ** rồi để Groq viết nghĩa/phiên âm/ví dụ (không còn
phụ thuộc API từ điển), **bài học từ mới có giới thiệu trước khi kiểm tra**, **nhạc nền tự tạo**,
**ba trò chơi học từ**, **xu ảo** và **khôi phục chuỗi ngày học**, **lịch ôn tùy chỉnh**,
**reset tiến độ an toàn**, **album từ vựng có thông báo ngẫu nhiên** và **hiệu ứng âm thanh**.

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

## Tạo bộ từ: hai cách, một quy trình

Màn hình **Tạo bộ từ** có hai chế độ, cùng nằm trên tab Từ vựng:

1. **AI chọn từ** — chọn track/level/chủ đề/số từ, Gemini hoặc Groq (theo Cài đặt) đề xuất, bạn
   sửa và chọn từng từ.
2. **Nhập danh sách từ** — dán danh sách của bạn, mỗi mục cách nhau bằng phẩy, chấm phẩy hoặc
   xuống dòng. Groq viết nghĩa, IPA, ví dụ và cấp độ cho từng mục — **cả từ đơn lẫn cụm từ**.

Không còn API từ điển nào trong ứng dụng. Trước đây bước tra từ điển từ chối mọi cụm như
`take into account`, nên Groq tạo xong vẫn không lưu được; giờ Groq là nguồn duy nhất, và mọi
điều kiện "từ điển phải xác nhận" đã bị xoá khỏi luồng lưu.

### Nhập danh sách

```
criminal, civil, take into account, in terms of, carry out an investigation
```

- Dấu phẩy / chấm phẩy / xuống dòng là dấu phân cách; **khoảng trắng bên trong cụm được giữ nguyên**.
  `take into account` là **một** mục, không bị tách thành ba.
- Cắt khoảng trắng thừa, bỏ mục rỗng, bỏ trùng lặp không phân biệt hoa/thường, giữ thứ tự bạn nhập.
- Màn hình xem trước hiện số mục hợp lệ và những mục bị bỏ kèm lý do (quá dài, không phải chữ Latin).
  Không có mục nào biến mất âm thầm.
- Danh sách tối đa 50 mục; phần vượt quá được báo rõ thay vì cắt lặng lẽ.

### Groq xử lý và lưu

- Một request cho cả danh sách (chia lô khi dài), trả đúng schema: `term`, `partOfSpeech`, `ipa`,
  `meaningVi`, `definitionEn`, `exampleEn`, `exampleVi`, `synonyms`, `collocations`, `level`,
  `category`.
- Cụm từ được giải nghĩa **theo toàn cụm** và có ví dụ đúng ngữ cảnh; không ghép nghĩa của từng từ.
- Thiếu IPA thì để trống và ghi "Thiếu: phiên âm IPA", không bịa.
- Cấp độ lấy từ kho từ kèm app khi có; phần còn lại do Groq xếp CEFR trong cùng request.
- Trùng với ngân hàng từ vựng (kể cả khác hoa/thường hoặc khoảng trắng) bị loại trước khi lưu; kết quả
  ghi rõ số mục đã thêm, số mục trùng và số mục lỗi.
- Timeout 20 giây/lần, tự thử lại có backoff cho lỗi mạng/429/5xx, **không** thử lại khi key sai hay
  request không hợp lệ. Bấm nhiều lần không tạo nhiều request (single-flight); kết quả được cache theo
  nội dung để dán lại không tốn token.
- Danh sách 10 mục mà 8 mục xong, 2 mục lỗi thì báo đúng "8 thành công, 2 lỗi" và cho **Thử lại**
  riêng phần lỗi, không bắt nhập lại.

Cả hai chế độ đều đi qua cùng lớp kiểm tra trùng lặp, chuẩn hoá và lưu (`src/db/words.ts`), nên dữ liệu
không bị chia thành hai hệ thống.

**Thêm từ không bao giờ bị khoá vì còn từ đến hạn.** Bạn có thể thêm từ đơn, cụm từ, dán danh sách
hoặc dùng AI bất cứ lúc nào; từ vừa thêm nằm trong ngân hàng với trạng thái `new`, **không** có
`due_at` và không được tính là đã học. Chỉ khi bắt đầu **phiên học từ mới** (màn hình Học từ mới)
ứng dụng mới yêu cầu hoàn thành các từ đến hạn trước. Quy tắc này nằm ở `createWord` (không gọi cổng
ôn tập) và `src/study/gate.ts` (chỉ `startNewLearning` bị chặn), có test riêng.

## Tùy chỉnh lịch ôn tập

Mỗi lần tự đánh giá một từ, bạn chọn **Chưa nhớ / Khó / Dễ / Rất dễ**. Khoảng thời gian tới lần
kiểm tra tiếp theo của từng mức nằm trong **Cài đặt → Học tập → Tùy chỉnh lịch ôn tập**:

| Mức | Mặc định |
|---|---|
| Chưa nhớ | 5 phút |
| Khó | 30 phút |
| Dễ | 12 giờ |
| Rất dễ | 24 giờ |

- Nhập số + chọn phút/giờ/ngày (tối thiểu 1 phút, tối đa 7 ngày = 10.080 phút); có
  **Khôi phục mặc định**.
- Cài đặt lưu trong SQLite và được dùng thật khi tính `next_review_at` trong `src/srs/fsrs.ts`.
- Đổi cài đặt **không** sửa lịch đã đặt cho những từ đang chờ; từ đã lên lịch giữ nguyên `due_at`,
  lần đánh giá kế tiếp mới áp giá trị mới.
- Lỗi mạng/API/âm thanh không được ghi thành câu trả lời sai và không đổi lịch.

## Reset dữ liệu học tập

**Cài đặt → Dữ liệu → Reset dữ liệu học tập** (có hộp thoại xác nhận) đưa **mọi từ** về trạng thái
chưa học: `learning_state = 'new'`, `due_at = NULL`, `reps/lapses/streak/ratings = 0`, xoá lịch sử
`reviews`. Giữ nguyên từ, nghĩa, ví dụ, chủ đề, level, album, **số dư xu**, streak và lịch sử giao dịch.

Mỗi lần reset tạo một **chu kỳ học mới** (`studyCycleId` trong cài đặt). Xu khi học lại được tính theo chu kỳ:
- Lần đầu trả lời đúng một từ trong chu kỳ mới được thưởng theo giá hiện hành.
- Mỗi `(từ, chu kỳ)` chỉ thưởng một lần, kể cả bấm đúp, retry hay gọi API nhiều lần
  (`coin_ledger.source_id UNIQUE` + `event_id`).
- Gặp lại từ đã thưởng mà trả lời sai vẫn bị trừ xu.
- Reset **không** xoá lịch sử giao dịch và không thể khai thác bằng cách xoá rồi thêm lại từ.

## Groq tự xếp level cho từng từ

Level bạn chọn trên giao diện chỉ là **định hướng** (`requestedLevel`), không phải level chính thức.
Khi nhập danh sách, Groq đánh giá **từng từ/cụm từ** theo nghĩa và ngữ cảnh rồi trả `level`; app
validate và lưu `actualLevel`. Ví dụ chọn B2 nhưng nhập
`abandon, criminal, undertake, ubiquitous, take into account` thì `abandon`/`criminal` vẫn có thể là
B1, `ubiquitous` có thể là C1.

- `actualLevel` là level dùng cho hiển thị, lọc, thống kê, độ khó câu hỏi và tính xu.
- Level AI trả **không bị ghi đè** bởi level đã chọn. Nếu AI bỏ trống level, app thử kho từ kèm máy;
  chỉ khi cả hai đều không có mới dùng level đã chọn và ghi rõ nguồn là cài đặt kèm cảnh báo — mục đó
  không được coi là `actualLevel` do AI đánh giá.
- Cụm từ được giữ nguyên khi tách danh sách và khi gửi Groq; không phân loại theo độ dài từ.

## Album từ vựng và thông báo ngẫu nhiên

- Trong **Từ vựng**, bấm **Chọn** để bật chế độ chọn hàng loạt: checkbox từng từ, **Chọn tất cả kết
  quả đang lọc**, bỏ chọn vài từ, rồi **Thêm vào Album** trong một thao tác.
- Bộ lọc: level (`actualLevel`), chủ đề, trạng thái học (mới/đang học/cần ôn/đã thành thạo),
  có/không trong album. Sắp xếp: A–Z, Z–A, level tăng/giảm, mới/cũ, tỷ lệ sai/đúng, từ đến hạn.
- **Album** là màn hình riêng: xem từ, level, nghĩa, chủ đề, trạng thái; tìm/lọc/sắp xếp; chọn nhiều
  để xoá khỏi album; phát âm; mở chi tiết.
- Album chỉ lưu **liên kết** `album_words` tới từ trong ngân hàng, không sao chép dữ liệu. Sửa nghĩa,
  ví dụ, chủ đề hay level trong ngân hàng được phản ánh ngay trong album. Xoá khỏi album không xoá từ,
  không đổi trạng thái học, không đụng xu.

**Thông báo ngẫu nhiên:** bật trong Album; app tự chọn từ bằng túi từ có trọng số trên **toàn bộ
album** — bạn không phải bật thông báo cho từng từ. Mỗi thông báo có từ/cụm từ, nghĩa tiếng Việt và
câu ví dụ ngắn. Chống lặp bằng lịch sử gần đây; album ít từ vẫn hoạt động; từ mới thêm có cơ hội ngay.

- Chu kỳ 10/15/30 phút, 1/2/4 giờ; khung giờ bắt đầu–kết thúc.
- Tối đa 48 thông báo cục bộ được lên lịch trước (dưới giới hạn 64 pending của iOS); đổi cài đặt sẽ
  **huỷ lịch cũ** rồi tạo lại; tắt là không tạo lịch mới.
- **iOS không bảo đảm đúng từng phút**: thông báo cục bộ có thể trễ hoặc bị gộp khi máy ở chế độ tiết
  kiệm pin/Focus. App lên lịch trước thay vì chạy nền vô hạn.
- Nhấn thông báo mở chi tiết từ. Thông báo **không** đánh dấu đã học, không tăng streak, không trao xu,
  không đổi lịch ôn.

## Hiệu ứng âm thanh

Các hiệu ứng ngắn cho: trả lời đúng, trả lời sai, nhận xu, hoàn thành lượt học, đạt mốc streak và bắn
trúng thiên thạch. Sáu file WAV tự tạo trong `assets/sfx/` (script `scripts/generate-sfx.mjs`), phát
bằng `expo-audio`. Bật/tắt và chỉnh âm lượng trong **Cài đặt → Hiệu ứng âm thanh**; lưu qua lần khởi
động lại. Hiệu ứng được throttle (70 ms giữa hai âm bất kỳ, 120 ms cho cùng một âm) và không chồng lên
nhau; **tắt hiệu ứng không tắt giọng đọc từ vựng**.

## Từ tôi hay quên

Mục này trong **Học** là truy vấn động từ dữ liệu thật (`wrong_count`, `last_wrong_at`, `last_rating`,
`hint_count`, `due_at`), không phải danh sách lưu riêng. Từ sai nhiều và tự đánh giá “Chưa nhớ/Khó”
được ưu tiên; khi trả lời đúng nhiều lần, mức ưu tiên giảm dần. Có thể bắt đầu phiên ôn ngắn từ đây.

## Mô tả song ngữ khi điền từ (General English)

Khi một bài tập đưa **mô tả** rồi yêu cầu điền từ, General English luôn hiện cả hai ngôn ngữ:

```
ENGLISH DESCRIPTION
An object you use to protect yourself from rain.

MÔ TẢ TIẾNG VIỆT
Một vật dụng dùng để che mưa, thường gấp lại và mang theo.
```

- Tiếng Anh lấy từ `definition_en`; nếu thiếu thì dùng câu ví dụ với chính từ mục tiêu được thay bằng
  `_____`. Tiếng Việt lấy từ `meaning_vi`. Không gọi mạng cho từng câu hỏi.
- Từ mục tiêu bị thay bằng chỗ trống trong **cả hai** mô tả, nên không lộ đáp án. Cụm từ được xử lý
  như một đơn vị, không tách từng chữ.
- Áp dụng cho dạng nhập từ, chọn từ theo nghĩa, điền vào câu, mô tả nghĩa và thiên thạch. Bài nghe,
  luyện nói và câu hỏi một chiều giữ mục tiêu riêng, không ép hiển thị bản dịch.
- Nếu từ chưa có mô tả tiếng Anh, app **chỉ hiện phần tiếng Việt** và không bịa câu tiếng Anh;
  phần tiếng Việt luôn có vì `meaning_vi` là trường bắt buộc khi lưu từ.

## Học từ mới có hướng dẫn

Không đưa một từ chưa từng gặp vào câu hỏi trắc nghiệm ngay. Mỗi từ mới đi qua:

1. **Giới thiệu** — từ, nghĩa tiếng Việt, IPA, từ loại, nút nghe.
2. **Lật thẻ** — định nghĩa tiếng Anh, câu ví dụ + bản dịch, collocations, từ đồng nghĩa, ghi chú.
   Có nút nghe riêng cho câu ví dụ; lật thẻ không cộng xu.
3. **Kiểm tra nhẹ** — một câu hỏi dựa trên đúng thông tin vừa giới thiệu (nhận diện nghĩa với từ dễ,
   gõ lại từ với cấp cao hơn).
4. **Tự đánh giá** — Chưa nhớ / Khó / Tốt / Rất dễ, quyết định lịch ôn FSRS. Chỉ bước này mới ghi
   nhận lượt học; mở màn hình hay bấm "đã hiểu" không được tính là đã thuộc.

Nếu trả lời sai, từ được xếp "Chưa nhớ" và quay lại sớm trong Ôn tập. Không có xu cho việc lật thẻ,
nghe hay tự chọn "Rất dễ".

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
    gõ sai không được điểm, thiên thạch chạm đáy mất một khiên, có combo và tạm dừng. Mật độ đã
    giảm (một từ mỗi ~3,2 giây, tối đa 4 từ cùng lúc, có làn riêng để không chồng nhau). Từ trên
    thiên thạch **bị đục một vài ký tự** (`cr_minal`) để phải nhớ chính tả; gõ đúng chữ nào thì chữ
    đó hiện ra, chữ đầu của mỗi từ luôn nhìn thấy được.
  - **60 giây**: chọn nghĩa đúng nhanh nhất. Đồng hồ là thứ duy nhất kết thúc lượt: khi hết bộ câu
    hỏi mà vẫn còn giờ, app tự xáo thêm câu mới, nên chơi được trọn 60 giây kể cả khi bạn chỉ có vài từ.
  - **Cặp đôi từ vựng**: lật thẻ ghép từ với nghĩa.

  Cả ba game đều có nút **tạm dừng / tiếp tục / thoát**, và tự tạm dừng khi bạn chuyển app sang nền
  để không mất lượt chơi trong lúc nghe điện thoại.
- **Xu ảo** (không phải tiền thật, không quy đổi): từ mới trả 100 xu (Starter) → 1.000 xu (C1/C2)
  khi bạn trả lời đúng **lần đầu**; mỗi 10 ngày học liên tục tăng hệ số 0,1; ôn sai bị trừ đúng giá
  trị gốc của từ và số dư không bao giờ âm.
  - Mỗi **từ/cụm từ** chỉ nhận thưởng một lần trong toàn bộ lịch sử, kể cả khi xoá rồi thêm lại, gặp
    lại trong Học ngay/Ôn tập/game, hay reset xu. Danh tính thưởng lưu theo `term_key`
    (`normalizedTerm|track`) trong bảng `word_study_history` và ledger, không dựa vào `isLearned`.
  - Gặp lại từ đã thưởng mà trả lời **sai** vẫn bị trừ xu; trả lời đúng thì nhận 0 xu.
  - Mỗi lượt trả lời có `event_id`; gửi lại/ bấm đúp không tạo thêm giao dịch. Ledger ghi lý do, số dư
    trước/sau, từ liên quan và chế độ học; Cài đặt → Kinh tế có lịch sử giao dịch.
  - Reset xu chỉ tạo một giao dịch reset, **không** xoá từ, lịch sử học, lịch thưởng, streak hay FSRS.
  - Không cộng/trừ xu khi luyện nói, khi câu hỏi lỗi tải, khi audio/micro lỗi hoặc khi bạn bấm bỏ qua.
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
│   ├── ai/                 # AI client (Gemini + Groq), prompt, schema, cache, retry
│   ├── audio/              # audio session: media ↔ playback cho TTS
│   ├── sound/              # hiệu ứng tương tác (expo-audio, WAV trong assets/sfx)
│   ├── coins/              # ledger, giá xu, hệ số streak
│   ├── components/         # UI primitives, patterns, motion, chuyển màn hình
│   ├── data/seed.ts        # 40 từ khởi tạo (General + IELTS)
│   ├── db/                 # schema v5, migration, repository, album (album.ts), reset, backup
│   ├── games/              # engine thuần: asteroid, rush, memory
│   ├── lib/                # text, date, id
│   ├── navigation/         # stack + tab
│   ├── notifications/      # nhắc nhở hằng tuần + thông báo album ngẫu nhiên
│   ├── quiz/               # sinh câu hỏi + chấm điểm
│   ├── screens/            # màn hình (gồm LearnScreen nhiều giai đoạn)
│   ├── speech/             # TTS, nhận diện, phản hồi
│   ├── srs/                # FSRS
│   ├── state/              # AppProvider
│   ├── streak/             # streak thuần
│   ├── study/              # cổng chặn phiên học từ mới + điểm ưu tiên từ
│   ├── theme/              # design tokens
│   ├── wordlist/           # phân tách danh sách từ/cụm từ
│   └── widgets/            # snapshot + sync
├── docs/                   # khả thi, kiến trúc, build, test
└── scripts/                # setup, validate checkpoint
```

## Giới hạn đã biết

- Widget cần Apple Developer Program trả phí (App Groups) và một lần build native.
- Không chấm điểm phát âm theo âm vị; chỉ so khớp từ bằng nhận diện giọng nói.
- Widget không cập nhật tức thì; iOS điều tiết tần suất.
- AI (Gemini hoặc Groq) có thể trả dữ liệu sai; mọi từ phải qua bước xem/sửa/lưu.
- Không còn API từ điển; chất lượng IPA/ví dụ phụ thuộc vào model AI đang chọn.
- Thông báo album là thông báo cục bộ: iOS không bảo đảm đúng từng phút, có thể trễ/gộp khi máy ở
  chế độ tiết kiệm pin hoặc Focus; app lên lịch trước tối đa 48 thông báo và huỷ lịch cũ khi đổi cài đặt.
- Chưa có giới hạn số thông báo/ngày riêng, giờ yên tĩnh riêng, chọn ngày trong tuần hay bộ lọc nâng cao
  cho nguồn thông báo album (các mục này là tùy chọn trong yêu cầu).
- Hiệu ứng âm thanh dùng WAV qua expo-audio; chưa nghe thử trên iPhone thật.
- Chưa hỗ trợ Android (cấu hình `platforms: ["ios"]`).
- Chưa có đồng bộ nhiều thiết bị (dữ liệu cục bộ, backup thủ công).
- Chưa chạy các tính năng mới trên iPhone: máy Windows không build iOS; phải build lại qua GitHub Actions/EAS rồi cài.

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Bash is required but was not found` | Cài Git for Windows, mở lại app; hoặc đặt `CODEBUFF_GIT_BASH_PATH` |
| Typecheck lỗi sau `npm install` | Chạy `npx expo install --fix` |
| App trắng màn hình sau khi cài | Xem log Metro; thường do native module chưa build lại |
| Widget không xuất hiện | Mở app một lần; kiểm tra target extension trong `ios/`; build lại |
| Widget không đổi số liệu | Mở app lại; iOS trễ refresh; kiểm tra App Group trong Signing |
| Không nghe thấy từ dù đang ở chế độ im lặng | Đã sửa: khi phát từ vựng app nâng audio session lên playback (không phụ thuộc công tắc chuông) rồi trả về media. Nếu vẫn im: kiểm tra âm lượng **media**, chọn giọng trong Cài đặt → Giọng đọc, hoặc cài voice tiếng Anh trong Cài đặt iOS |
| Micro không nhận / "chưa nhận diện được giọng nói" | Cài đặt iOS → VocabMaster → Micro + Nhận diện giọng nói; bật Siri/Đọc chính tả nếu dùng nhận diện ngoại tuyến; hoặc tắt "Nhận diện trên thiết bị" để dùng qua mạng. Sau ~9 giây không có kết quả cuối, app tự dừng và chấm phần đã nghe được thay vì treo "Đang nghe…" |
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
npm test                  # 30 bộ unit test, 284 test
npm run typecheck         # TypeScript strict
npm run check:migrations  # migration 1→5 trên SQLite thật (node:sqlite)
npm run verify            # typecheck + test + migration + checkpoint
node scripts/validate-checkpoint.mjs
```

Trạng thái thật của các lần chạy nằm trong `CHECKPOINT.json → test_results`.

## Tài liệu bàn giao

- `CHECKPOINT.md` — bàn giao đầy đủ cho AI/người tiếp theo
- `CHECKPOINT.json` — trạng thái máy đọc được
- `CHANGELOG.md` — lịch sử thay đổi theo phiên
- `NEXT_SESSION.md` — việc cần làm ngay
- `docs/FEASIBILITY.md`, `docs/ARCHITECTURE.md`, `docs/BUILD_AND_INSTALL.md`, `docs/TEST_PLAN.md`
