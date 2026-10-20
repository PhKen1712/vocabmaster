# Kế hoạch kiểm thử

> **Trạng thái (2026-10-20):** mục 1 đã chạy thật — `npm test -- --ci` cho 4/4 suite, 36/36 test
> pass. Các mục từ 2 trở đi là kiểm thử thủ công trên iPhone và **chưa chạy** vì chưa có build.
> Không dòng nào được đánh dấu pass nếu chưa thực sự chạy.

## 1. Unit test tự động (Jest + jest-expo)

| File | Nội dung | Trạng thái |
|---|---|---|
| `src/srs/__tests__/fsrs.test.ts` | thứ tự difficulty, interval theo retention, bước học đầu, tăng stability, lapse không tăng stability, same-day, determinism, clamp retention | **Pass** (2026-10-20) |
| `src/quiz/__tests__/quiz.test.ts` | option duy nhất + có đáp án, fallback khi thiếu distractor, cloze đúng điều kiện, giới hạn số câu, chấm theo id, bỏ qua hoa/thường, near-miss, “to + verb” | **Pass** (2026-10-20) |
| `src/streak/__tests__/streak.test.ts` | chuỗi liên tiếp, ân hạn hôm nay, đứt chuỗi, best streak, ngày sai định dạng, mục tiêu | **Pass** (2026-10-20) |
| `src/lib/__tests__/text.test.ts` | chuẩn hoá, Levenshtein, tokenize, CSV có ngoặc kép/CRLF/escaped quote, split list | **Pass** (2026-10-20) |

Lệnh:
```bash
npm test
npm run typecheck
```

## 2. Kiểm thử thủ công trên iPhone thật

### 2.1. Cài đặt và khởi động
- [ ] Cài được bản development build lên iPhone.
- [ ] Mở app lần đầu: hiện onboarding, chọn track/level/mục tiêu.
- [ ] Tắt app, mở lại: dữ liệu và cài đặt còn nguyên.
- [ ] Bật/tắt chế độ tối: toàn bộ màn hình đổi màu, không có chữ trắng trên nền trắng.

### 2.2. Từ vựng
- [ ] Thêm từ thủ công với đủ trường → xuất hiện trong danh sách.
- [ ] Thêm trùng từ trong cùng track → báo lỗi, không tạo bản ghi thứ hai.
- [ ] Thêm cùng từ ở track khác → được phép, có cảnh báo (nếu UI hiển thị).
- [ ] Sửa từ → danh sách và chi tiết cập nhật.
- [ ] Xoá từ → hỏi xác nhận, xoá cả lịch sử.
- [ ] Tìm theo từ, nghĩa, ghi chú.
- [ ] Yêu thích/bỏ yêu thích, lọc “Yêu thích”.
- [ ] Nhập CSV có dấu phẩy trong ngoặc kép → đúng nghĩa.
- [ ] Xuất JSON → mở lại bằng trình đọc, đúng cấu trúc.
- [ ] Khôi phục JSON chế độ “Gộp” → không nhân đôi từ.
- [ ] Khôi phục JSON chế độ “Thay thế” → dữ liệu cũ bị thay, có xác nhận.
- [ ] File sai định dạng → báo lỗi, không xoá dữ liệu.

### 2.3. Học và ôn
- [ ] Buổi học sinh câu hỏi từ từ thật trong DB, không có từ lạ.
- [ ] 4 lựa chọn không trùng, có đúng 1 đáp án.
- [ ] Gõ “Borrow”, “borrow ”, “BORROW.” đều đúng.
- [ ] Gõ sai 1 ký tự → báo “gần đúng”, không cộng điểm.
- [ ] Nghe: bấm loa phát đúng từ, nghe lại được.
- [ ] Nói: cấp quyền micro, đọc từ, thấy transcript; từ đúng → ghi nhận đúng.
- [ ] Từ chối quyền micro → có thông báo rõ, không crash.
- [ ] Sau mỗi câu: chọn Lại/Khó/Nhớ/Dễ → lịch ôn đổi theo.
- [ ] Trả lời sai → từ quay lại trong buổi “Làm lại từ vừa sai”.
- [ ] Đóng app giữa buổi, mở lại → các câu đã trả lời vẫn được lưu.
- [ ] Từ đã trả lời đúng không xuất hiện lại ngay ngày hôm đó (trừ khi rating thấp).

### 2.4. Streak và thống kê
- [ ] Mở app không làm tăng streak.
- [ ] Hoàn thành đủ mục tiêu → streak +1, `daily_activity.goal_met = 1`.
- [ ] Đổi múi giờ máy sang ngày khác → ngày mới được tính đúng theo giờ máy.
- [ ] Streak không reset trước nửa đêm khi hôm nay chưa học.
- [ ] Số liệu trên Today/Stats khớp với lịch sử thật.

### 2.5. Gemini
- [ ] Chưa có key → nút tạo từ báo “Chưa có Gemini API key”, app vẫn học được.
- [ ] Nhập key sai → báo lỗi key không hợp lệ.
- [ ] Ngắt mạng → báo lỗi mạng, không treo.
- [ ] Tạo 8 từ A2 chủ đề Work → preview đúng track/level, có IPA/nghĩa/ví dụ.
- [ ] Bỏ chọn vài từ → chỉ các từ được chọn được lưu.
- [ ] Sửa một từ trong preview → bản lưu dùng nội dung đã sửa.
- [ ] Từ AI không tự động được đánh dấu “đã học”.
- [ ] Key không xuất hiện trong log Metro, không có trong file backup.

### 2.6. Widget (bắt buộc kiểm tra trên máy thật)
- [ ] Build có target widget extension (xem `ios/`).
- [ ] Widget xuất hiện trong gallery sau khi mở app.
- [ ] Thêm widget Small/Medium/Large vào màn hình chính.
- [ ] Thêm widget Circular/Rectangular/Inline vào màn hình khóa.
- [ ] Widget hiển thị từ của ngày và số từ cần ôn thật.
- [ ] Thêm một từ mới → mở lại app → widget đổi số liệu.
- [ ] Học xong một buổi → widget cập nhật tiến độ.
- [ ] Tắt mạng → widget vẫn hiển thị dữ liệu (không gọi Gemini).
- [ ] Chạm widget → mở app.
- [ ] Chế độ tối → widget đọc được, không mất chữ.
- [ ] Ghi lại thời điểm iOS thực sự refresh (có thể trễ vài phút).

### 2.7. Nhắc nhở
- [ ] Bật nhắc nhở, cấp quyền thông báo, chọn 20:00 hằng ngày.
- [ ] Thông báo đến đúng giờ (thử với giờ gần hiện tại).
- [ ] Tắt nhắc nhở → không còn thông báo đã lên lịch.
- [ ] Nội dung thông báo hiển thị số từ cần ôn.

### 2.8. Widget/Expo Go
- [ ] Mở bằng Expo Go → app không crash (nếu crash do native module, ghi nhận và dùng dev build).
- [ ] Xác nhận không tuyên bố widget/speech hoạt động trong Expo Go.

## 3. Tiêu chí hoàn thành (Definition of Done)

Một tính năng chỉ được đánh dấu `tested` khi unit test hoặc kiểm thử thủ công tương ứng đã
chạy và pass. Chỉ đánh dấu `verified_on_device` khi đã thực hiện trên iPhone thật.

- Thêm từ: CRUD + lưu bền + không trùng + xử lý lỗi nhập.
- Học/ôn: câu hỏi từ dữ liệu thật, chấm đúng, lịch ôn đổi, thống kê khớp.
- Gemini: tạo được bộ từ, validate trước khi lưu, xử lý lỗi mạng/quota, không lộ key, offline vẫn dùng được.
- Widget: build extension, App Group, cài máy thật, thêm được 2 loại widget, dữ liệu đổi, tap mở app, ghi rõ giới hạn refresh.
- Checkpoint: đủ file, JSON hợp lệ, khớp code, không secret, có việc tiếp theo.

## 4. Những gì KHÔNG thể kiểm chứng trong môi trường hiện tại

- Không có macOS/Xcode → không xác minh được prebuild/pod install tại chỗ.
- Không có Apple Developer Program → không xác minh được App Group trên thiết bị.
- Không có iPhone kết nối phiên này → không thêm được widget, không kiểm tra mic.
- Không có terminal → không chạy được unit test/typecheck.
