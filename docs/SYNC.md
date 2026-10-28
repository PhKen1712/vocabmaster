# Đồng bộ một tài khoản, nhiều thiết bị

Cập nhật: 2026-10-28 · Trạng thái: **backend kiểm chứng 14/14; app kiểm chứng thật bằng hai phiên trình duyệt cùng một tài khoản (đẩy, kéo, bỏ yêu thích lan hai chiều) trên bản web đã deploy; chưa chạy trên iPhone**

---

## 1. Một câu tóm tắt

SQLite trên máy là **nơi làm việc** (học được cả khi mất mạng). Supabase là **nguồn sự thật**
(cùng một tài khoản, mọi thiết bị nhìn thấy cùng một dữ liệu). Thay đổi được gửi lên **tự động**,
không có nút "Upload" nào để quên bấm.

## 2. Luồng chạy

```
Người học thao tác
      │
      ▼
Ghi vào SQLite  ──(mốc thời gian)──►  sync_push   ──► Supabase (nguồn sự thật)
      │                                                  │
      └──────────── sync_pull (kể từ mốc lần trước) ◄────┘
```

- **Đẩy:** quét theo mốc `last_push_at`. Cách này cố ý không bắt từng chỗ ghi phải "nhớ" gọi đồng
  bộ — một tính năng thêm sau này cũng tự được gửi, không thể quên.
- **Kéo:** hỏi server những gì đổi kể từ `last_pulled_at`, rồi trộn vào SQLite.
- **Tự động:** sau mỗi thao tác, việc gửi diễn ra sau một nhịp 1,5 giây (gộp nhiều thay đổi thành
  một request). Quay lại ứng dụng sau khi để máy một lúc cũng kéo về một lần.
- **Mất mạng:** dòng chưa gửi vẫn nằm trên máy; lần sau có mạng sẽ gửi tiếp. Không có nhánh nào
  báo "đã lưu" khi thực tế chưa lưu.

## 3. Chống trùng và chống mất dữ liệu

| Dữ liệu | Khoá chống trùng | Ghi chú |
|---|---|---|
| Từ (nội dung dùng chung) | `(normalized, track)` | Cùng một từ ở General và IELTS là **hai** bản ghi với tiến độ riêng |
| Tiến độ từng từ | `(user_id, term_id)` | Bộ đếm chỉ **tăng**; lịch ôn theo bản `updated_at` mới hơn |
| Lượt ôn | `id` do máy sinh | Gửi lại không nhân đôi |
| Hoạt động theo ngày | `(user_id, day)` | Cộng theo `greatest` |
| Album / thành viên album | `(user_id, client_id)` / `(album_id, term_id)` | Xoá khỏi album là **xoá mềm** nên máy khác cũng thấy |
| Yêu thích | `(user_id, term_id)` + cột `favorite_at` | Chỉ máy **thật sự bấm** mới đổi được; xem mục 4.1 |
| Xu | `(user_id, source_id)` | Chỉ ghi qua `award_coins`; không có đường nào để client tự đặt số dư |
| Cài đặt | `profiles.settings` | Chỉ áp từ server khi máy không có thay đổi đang chờ |

Số dư xu **luôn do server tính**. Máy khách gửi *sự kiện* (thưởng cho việc gì, khoá chống trùng là
gì), không bao giờ gửi "số dư mới".

## 4. Reset tiến độ học

Nút **Reset tiến độ** trong Cài đặt, khi đang đăng nhập, gọi server trước:

1. `reset_study_progress` đưa tiến độ của tài khoản về chưa học và mở một **chu kỳ học mới**
   (chu kỳ này là căn cứ để lần học lại đầu tiên được thưởng xu bình thường, một lần duy nhất).
2. Server xong mới xoá tiến độ trên máy. Nếu server lỗi thì **không xoá gì** và báo rõ — tránh
   cảnh reset xong rồi lần đồng bộ sau kéo tiến độ cũ về.

Giữ nguyên: từ vựng, nghĩa, ví dụ, chủ đề, level, album, **số dư xu** và **streak**.

## 4.1. Trạng thái yêu thích: lỗi đã gặp thật và cách sửa

Kiểm thử hai phiên trình duyệt (một phiên thường, một phiên ẩn danh) cùng một tài khoản đã phát
hiện một lỗi **mất dữ liệu thật**:

1. Máy A bấm yêu thích “breakfast” → lên máy chủ đúng.
2. Máy B vừa đăng nhập lần đầu, có sẵn 114 từ nhưng chưa ai bấm gì, đẩy toàn bộ lên → ghi đè
   `is_favorite = false` và **xoá mất** dấu yêu thích của máy A.

Nguyên nhân: trong `sync_push`, dòng `is_favorite = excluded.is_favorite` không có gì phân biệt
“người dùng vừa bỏ yêu thích” với “máy này chưa từng biết gì về từ đó”. Mọi trường khác đều đã có
luật (bộ đếm chỉ tăng, lịch ôn theo bản mới hơn) — chỉ trường này bị ghi đè vô điều kiện.

Cách sửa (migration `0005_favorite_timestamp.sql`, SQLite schema v7):

- Thêm `favorite_at` — mốc lúc người dùng **thật sự bấm**. Gói tin không mang mốc thì không được
  đổi giá trị; giữa hai mốc thì bản mới hơn thắng.
- Vì thế **bỏ yêu thích vẫn lan sang máy khác được** (trước đây luật cũ là hợp nhất “hoặc”, nên
  một khi đã yêu thích thì không gỡ được ở máy khác).
- Dữ liệu cũ: dòng nào đang yêu thích được gán `favorite_at = updated_at`, nên không mất dấu và
  vẫn gỡ được về sau.
- **Tự chữa lành:** nếu máy chủ còn giá trị cũ không có mốc (dữ liệu trước bản vá), lần kéo sau
  máy này giữ lựa chọn của mình và đóng mốc mới; vòng đẩy phụ ngay trong cùng lần đồng bộ đưa máy
  chủ về đúng.
- **Cửa sổ xem lại 24 giờ:** lần kéo lùi mốc 24 giờ thay vì chỉ hỏi phần mới hơn. Nếu không lùi,
  một dòng đã bị ghi đè sai sẽ không bao giờ quay lại để sửa và máy chủ giữ giá trị sai vĩnh viễn.
  Mọi phép trộn đều idempotent nên hỏi lại không gây hại.

Kiểm chứng trên bản đã deploy (hai phiên trình duyệt thật):

| Bước | Kết quả |
|---|---|
| Yêu thích ở máy A → đọc database bằng khoá service | `is_favorite = true` |
| Máy B (mới) đẩy dữ liệu lên | Máy chủ **không** bị xoá dấu yêu thích nữa |
| Máy B tải lại | Hiện `★` — giá trị từ máy chủ xuống đúng |
| Máy B bỏ yêu thích → máy chủ | `is_favorite = false` |
| Máy A tải lại | Hiện `☆` — bỏ yêu thích lan **hai chiều** |

## 5. Kiểm chứng bằng lệnh

```bash
npm run verify:sync
```

Script tự: tạo tài khoản kiểm thử → đăng nhập bằng đúng khoá công khai của app → đẩy một gói dữ
liệu → **đẩy lại y hệt để chứng minh không nhân đôi** → kéo về và so từng trường → reset → kiểm
tra số dư xu còn nguyên → dựng một tài khoản thứ hai để chứng minh **không thấy dữ liệu của nhau**
→ **xoá sạch** tài khoản và từ kiểm thử.

Lần chạy gần nhất: **15/15 đạt** (2026-10-29, thêm kiểm tra cờ `goal_met`).

## 5.1. Cờ “đã đạt mục tiêu” (migration 0008)

Mỗi dòng `daily_activity` gửi lên mang thêm `goalMet`. Vì sao phải gửi tường minh thay vì để server
suy ra từ `new_words + reviews`:

- mục tiêu ngày là **cài đặt cá nhân** và có thể đổi; tính lại bằng mục tiêu hiện tại sẽ **viết lại
  quá khứ** và làm sai chuỗi ngày;
- app còn cộng ngày “khôi phục chuỗi” mà server không biết.

Server lưu vào cột `daily_activity.goal_met` và khi trùng ngày thì lấy `da.goal_met OR excluded.goal_met`
— gói tin cũ đến muộn không thể rút ngắn chuỗi. `sync_pull` trả lại `goalMet` để máy cài mới dựng
lại được lịch sử. Bảng quản trị dùng đúng cột này (`admin_streak_info`) nên không còn cảnh luôn hiện 0.

Một chỗ dễ quên khác: đổi **cài đặt** trước đây chỉ ghi hàng đợi mà không kích hoạt lần gửi nào.
`AppProvider.updateSettings` nay tăng `dataVersion` để `SyncProvider` gửi sau 1,5 giây.

## 6. Giới hạn phải nói thẳng

- **Chưa chạy trên iPhone.** Phần app (client, outbox, engine) đã viết và typecheck xanh, và bản
  web đã được kiểm trong trình duyệt thật, nhưng bản cài trên máy chưa chạy lần nào.
- **Không có xoá mềm cho từ vựng phía server.** Xoá một từ trên máy ghi một sự kiện `word_removed`
  và đánh dấu tiến độ của riêng bạn là đã xoá; bản ghi từ điển dùng chung vẫn còn cho người khác.
- **Cài đặt chỉ áp khi máy không có thay đổi đang chờ.** Hai thiết bị sửa cài đặt cùng lúc thì bản
  gửi sau thắng.
- **Supabase free tạm dừng project sau khoảng một tuần không hoạt động** — dùng đều thì không sao,
  để lâu không mở thì lần đầu vào lại có thể chậm.
- **Web không có Keychain.** Phiên trên trình duyệt nằm trong `localStorage`, yếu hơn Keychain trên
  iOS. Đừng đăng nhập tài khoản quan trọng trên máy tính công cộng.
- **Realtime chưa được dùng để đẩy giao diện.** Đã bật cho 6 bảng nhưng app kéo dữ liệu khi mở
  lại/đổi dữ liệu; muốn "máy B thấy ngay khi máy A vừa sửa" thì cần nối thêm kênh realtime.
- **Cửa sổ xem lại 24 giờ** khi kéo nghĩa là mỗi lần đồng bộ có thể nhận lại một ngày thay đổi gần
  nhất. Với quy mô vài trăm từ thì không đáng kể; nếu sau này lên hàng chục nghìn dòng, cần thay
  bằng cơ chế đối soát theo phiên bản thay vì lùi mốc theo thời gian.
