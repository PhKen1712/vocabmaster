# VocabMaster

Ứng dụng học từ vựng tiếng Anh cá nhân trên iPhone, viết bằng React Native + Expo, có
**widget thật** trên màn hình chính và màn hình khóa, ôn tập theo FSRS, hai hệ thống
General English / IELTS, phát âm, luyện nói, streak, nhắc nhở và gợi ý từ bằng Gemini.

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

## Cấu hình Gemini

1. Lấy API key tại https://aistudio.google.com/apikey
2. Trong app: **Cài đặt → Gemini AI → dán key → Lưu key**.
3. Key được lưu trong Keychain của iPhone, không nằm trong mã nguồn/Git/backup.
4. Model mặc định là `gemini-3.8-flash`. Nếu Google ngừng model đó, app tự chuyển sang model
   còn khả dụng và báo trong AI Studio; bấm **Kiểm tra key + model** trong Cài đặt để lưu lại.
5. Khi Gemini lỗi, app phân loại nguyên nhân (key sai, hết hạn mức, mạng, timeout, model bị ngừng,
   JSON bị cắt, dữ liệu không hợp lệ) thay vì báo chung "lỗi tạm thời". Lỗi tạm thời (5xx, mất mạng,
   timeout, rate limit) được tự thử lại tối đa 3 lần với exponential backoff + jitter; key sai và hạn
   mức thì **không** thử lại. Câu báo lỗi có nút **Thử lại** khi phù hợp và dòng "Kỹ thuật" ghi mã lỗi
   + HTTP status.
6. **Cài đặt → Gemini AI → "Lần gọi Gemini gần đây"** ghi lại các lần gọi trong bộ nhớ của phiên
   hiện tại: giai đoạn (request → response → parse → validate), HTTP status, mã lỗi, model, thời gian.
   Không có API key, không có nội dung bạn học, không gửi đi đâu.
7. Không có key: mọi chức năng học, ôn, tìm kiếm, nhập CSV, widget vẫn hoạt động.

**Cảnh báo bảo mật:** app gọi Gemini trực tiếp từ iPhone. Key lưu trên máy có thể bị lộ nếu
máy jailbreak hoặc bị mở khoá. Với app cá nhân, đây là đánh đổi để tránh chi phí backend.
Không dán key vào chat, ảnh chụp màn hình, commit, hay file checkpoint.

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
│   ├── ai/                 # Gemini client, prompt, validate
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
| Micro không nhận | Cài đặt iOS → VocabMaster → Micro + Nhận diện giọng nói |
| Gemini 429 | Chờ vài phút; giảm số từ; kiểm tra hạn mức model. Nếu là hạn mức theo ngày, app báo riêng và không tự thử lại |
| Gemini 403 | Key sai hoặc chưa bật Gemini API |
| Gemini 503 / "đang bận" | App đã tự thử lại 3 lần; chờ khoảng 1 phút rồi bấm **Thử lại** |
| "Gemini phản hồi quá lâu" | Giảm số từ cần tạo (5–8 từ) rồi thử lại |
| "Không đọc được JSON" / "dữ liệu không dùng được" | Câu trả lời bị cắt hoặc bị chặn; bấm **Thử lại** với ít từ hơn |
| Không biết lỗi ở đâu | Cài đặt → Gemini AI → **Lần gọi Gemini gần đây** (mã lỗi + HTTP status từng bước) |
| Không mở được DB sau cập nhật | Đóng hẳn app, mở lại; migration rollback giữ dữ liệu cũ |

## Kiểm thử

```bash
npm test              # 9 bộ unit test, 104 test
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
