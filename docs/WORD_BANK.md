# Kho từ vựng đi kèm — kế hoạch 5.000 từ

Mục tiêu: 2.500 từ General English + 2.500 từ IELTS, chọn theo **tính trọng dụng**, số từ
**giảm dần khi level tăng**, dùng được **offline**, không cần API.

Trạng thái 2026-10-22: **hạ tầng xong + 134 từ đã viết tay và kiểm tra** (94 General, 40 IELTS).
Phần còn lại được bổ sung theo lô, mỗi lô phải qua `npm test` trước khi phát hành.

---

## 1. Vì sao bundle thay vì gọi API mỗi lần

| | Bundle sẵn trong app | Gọi API khi cần |
|---|---|---|
| Offline | Có | Không |
| Hạn mức | Không có | Có, thay đổi theo thời gian |
| Độ trễ | 0 ms | 1–20 giây, có thể timeout |
| Chất lượng | Kiểm tra một lần, cố định | Mỗi lần một khác, không kiểm chứng được |
| Dung lượng app | ~50–150 KB cho 5.000 từ | 0 |

Kết luận: **học, ôn, kiểm tra đầu vào, minigame, quiz đều dùng kho bundle**. Gemini chỉ dùng khi
người dùng chủ động tạo bộ từ mới hoặc tra một từ chưa có.

## 2. Phân bổ số từ theo level

Số từ giảm dần khi level tăng vì số từ thật sự hữu dụng ở trình độ cao ít hơn nhiều.

| Level | General | IELTS |
|---|---:|---:|
| Starter (0) | 550 | 0 |
| A1 (1) | 500 | 0 |
| A2 (2) | 450 | 700 |
| B1 (3) | 400 | 650 |
| B2 (4) | 300 | 600 |
| C1 (5) | 200 | 400 |
| C2 (6) | 100 | 150 |
| **Tổng** | **2.500** | **2.500** |

Bảng này nằm trong `TARGET_DISTRIBUTION` ([packs.ts](../src/data/packs.ts)) và được test kiểm tra:
tổng mỗi track = 2.500 và giảm dần theo level.

## 3. Tiêu chí chọn từ

1. **Tần suất thực tế**: từ người bản ngữ dùng hằng ngày (general) hoặc trong bài IELTS (academic).
2. **Hữu dụng theo tình huống**: gia đình, mua sắm, ăn uống, đi lại, sức khoẻ, công việc, cảm xúc,
   môi trường, công nghệ, tin tức, du lịch, giao tiếp.
3. **IELTS**: từ theo chủ đề, collocation, phrasal verb thông dụng, academic vocabulary, từ cho
   Writing Task 1 (tăng/giảm/dao động/tỷ lệ), Task 2 (nguyên nhân – hệ quả – giải pháp), Speaking.
4. **Không lấy từ hiếm chỉ vì khó.** C1/C2 vẫn phải là từ người học dùng được, không phải từ
   "trông sang".
5. **Không bịa**: thiếu IPA thì để trống (UI dùng TTS), không tự chế phiên âm.
6. **Không gắn nhãn Cambridge/Oxford** cho dữ liệu chưa xác minh.

Tiêu chí này được `src/data/__tests__/packs.test.ts` kiểm tra tự động: không trùng trong track,
không trùng với danh sách seed, level hợp lệ, nghĩa tiếng Việt không được trùng từ tiếng Anh,
câu ví dụ phải chứa từ.

## 4. Nguồn dữ liệu miễn phí — cái nào dùng được cho việc gì

| Nguồn | Miễn phí | Có tiếng Việt | Dùng cho |
|---|---|---|---|
| [Free Dictionary API](https://dictionaryapi.dev/) | Có, không cần key | Không | Định nghĩa tiếng Anh, IPA, ví dụ, từ loại |
| [Datamuse API](https://www.datamuse.com/api/) | Có, không cần key | Không | Tần suất (`f:`), synonyms, collocation gợi ý |
| [CMUdict](https://github.com/cmusphinx/cmudict) | Có, giấy phép kiểu BSD | Không | IPA từ ARPAbet cho ~134k từ |
| [wordfreq](https://github.com/rspeer/wordfreq) | Có (giấy phép mở) | Không | Xếp hạng tần suất để chọn từ trọng dụng |
| [Wiktionary](https://www.wiktionary.org/) (CC BY-SA 4.0) | Có | Có, nhưng không đầy đủ | Nghĩa/bản dịch; phải ghi công + share-alike |
| Gemini API (free tier) | Có hạn mức | **Có, chất lượng tốt nhất** | Sinh nghĩa Việt + ví dụ **một lần lúc build**, sau đó review |
| Oxford 3000/5000 | — | — | **Có bản quyền**, không được sao chép nguyên danh sách vào app |
| Dataset EN–VI trên GitHub (100k từ) | "Có" | Có | **Rủi ro bản quyền** vì phần lớn scrape từ từ điển thương mại → không dùng khi không rõ giấy phép |

Kết luận thực tế: **không có API miễn phí nào trả về đồng thời nghĩa tiếng Việt + IPA + level +
tần suất**. Cách đúng là ghép nhiều nguồn:

1. chọn headword bằng tần suất/level (wordfreq, danh sách tham chiếu);
2. nghĩa tiếng Việt + ví dụ: Gemini ở chế độ "lookup" một lần lúc build (không dùng runtime);
3. IPA: CMUdict;
4. review theo lô, nghi từ nào sai thì bỏ, không giữ cho đủ số lượng.

## 5. Quy trình mở rộng lên 5.000 từ

Mỗi lô 200–300 từ:

1. Viết bổ sung vào `GENERAL_ROWS` hoặc `IELTS_ROWS` trong [packs.ts](../src/data/packs.ts).
2. Chạy `npm run typecheck && npm test` — test sẽ chặn từ trùng, nghĩa rỗng, level sai,
   ví dụ không chứa từ.
3. Cập nhật `SEED_VERSION` trong [database.ts](../src/db/database.ts) khi phát hành.
   App dùng `INSERT OR IGNORE` theo unique index `(normalized_term, track)` nên:
   - từ đã có **không bị sửa**, tiến độ FSRS **không mất**;
   - từ người dùng đã sửa nghĩa cũng **không bị ghi đè**;
   - chỉ từ mới được thêm.
4. Ghi số lượng thật vào `CHANGELOG.md` và `CHECKPOINT.json`.

Không có bước nào xoá dữ liệu người dùng, không cần migration schema.

## 6. Hiện có gì

| Pack | Track | Đã viết | Mục tiêu |
|---|---|---:|---:|
| `core-general` | general | 94 | 2.500 |
| `core-ielts` | ielts | 40 | 2.500 |

Ưu tiên các lô tiếp theo: A1/A2 general (tình huống hằng ngày) → B1/B2 general (công việc, xã hội)
→ IELTS B1/B2 theo chủ đề Writing/Speaking → C1/C2.
