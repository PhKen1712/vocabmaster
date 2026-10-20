# Kiến trúc VocabMaster

## 1. Tổng quan

```
App.tsx
 └─ SafeAreaProvider
    └─ AppProvider (SQLite, settings, stats, widget sync)
       └─ ThemeProvider (light/dark từ settings)
          └─ NavigationProvider (stack + tab tự viết)
             └─ Screens (Today / Study / Words / Stats / Settings / Session / …)
```

Không dùng Expo Router hay React Navigation: chỉ có 5 tab và ~6 màn hình chi tiết, một
navigator nhỏ giữ số dependency thấp và tránh rủi ro lệch phiên bản native.

## 2. Các lớp

| Lớp | Thư mục | Trách nhiệm | Phụ thuộc |
|---|---|---|---|
| Domain types | `src/types.ts` | Word, Settings, QuizQuestion, DailyStats… | không |
| Tiện ích thuần | `src/lib` | chuẩn hoá chuỗi, CSV, ngày tháng, id | không |
| Dữ liệu | `src/db` | schema, migration, repository, backup | expo-sqlite, expo-file-system |
| Máy học | `src/srs`, `src/quiz`, `src/streak` | FSRS, sinh câu hỏi, chấm điểm, streak | chỉ domain + lib (pure) |
| AI | `src/ai` | prompt, schema, gọi Gemini, lưu key | expo-secure-store |
| Giọng nói | `src/speech` | TTS, hook nhận diện, phản hồi | expo-speech, expo-speech-recognition |
| Widget | `widgets/`, `src/widgets` | UI SwiftUI, snapshot, đồng bộ | expo-widgets, @expo/ui |
| Giao diện | `src/components`, `src/screens`, `src/navigation`, `src/theme` | UI | react-native |
| Trạng thái app | `src/state/AppProvider.tsx` | mở DB, seed, settings, stats, refresh | tất cả lớp trên |

**Nguyên tắc:** logic học (FSRS, quiz, streak) là hàm thuần, không import React Native.
Nhờ vậy test chạy bằng Jest mà không cần thiết bị, và widget có thể dùng lại kiểu dữ liệu.

## 3. Cơ sở dữ liệu

SQLite, file `vocabmaster.db`, WAL. Phiên bản schema lưu ở `PRAGMA user_version`.

| Bảng | Nội dung chính |
|---|---|
| `words` | từ, IPA, nghĩa VI, định nghĩa EN, ví dụ + bản dịch, synonym/antonym/collocation/word family, chủ đề, track, level, nguồn, ghi chú, favorite, trạng thái học, `due_at`, stability, difficulty, reps, lapses |
| `reviews` | từng lượt trả lời: rating 1–4, đúng/sai, dạng câu hỏi, thời gian, khoảng ôn trước/sau |
| `daily_activity` | theo ngày: số từ mới, số lượt ôn, số câu, số đúng, đạt mục tiêu chưa |
| `app_settings` | key/value: `settings` (JSON), `seed_version` |

Ràng buộc:
- `UNIQUE(normalized_term, track)` → không trùng từ trong cùng hệ thống; cùng một từ có thể
  tồn tại ở cả General và IELTS (UI cảnh báo khi điều này xảy ra).
- `reviews.word_id` có FK `ON DELETE CASCADE`.
- Migration chạy trong transaction; lỗi → rollback, giữ nguyên dữ liệu cũ.

**Ghi dữ liệu nguyên tử:** `recordReview()` ghi đồng thời review + cập nhật SRS của từ +
tăng bộ đếm ngày trong **một** transaction. Nhờ vậy không thể có chuyện “đã tính 1 câu đúng
nhưng lịch ôn không đổi”.

## 4. Luồng học

```
Today/Study
  → buildStudyPlan(db, track, level, newLimit, reviewLimit)
  → generateQuestions(candidates, pool)      // sinh câu hỏi từ dữ liệu thật
  → SessionScreen (trả lời, chấm điểm)
  → schedule(card, rating, now, retention)   // FSRS
  → recordReview(...)                        // transaction
  → notifyDataChanged()                      // refresh stats + đẩy widget
```

### FSRS
- Trọng số mặc định FSRS-5 (19 tham số), retention mục tiêu 0.85/0.9/0.95.
- Từ mới: bước học ngắn (10 phút / 1 ngày / 1 ngày / 2 ngày) thay vì S0 nhiều ngày.
- Ôn trong cùng ngày: dùng công thức short-term để không nhảy interval hàng tháng.
- Trả lời sai: stability không bao giờ tăng, interval về 0 (ôn lại sau 10 phút).

### Sinh câu hỏi
- 9 dạng: Anh→Việt, Việt→Anh, gõ từ, điền vào câu, chọn theo định nghĩa, nghe, nói, phân biệt
  từ dễ nhầm, tự nhớ.
- Đáp án nhiễu lấy từ pool thật, khử trùng theo nhãn; nếu không đủ 2 lựa chọn → tự chuyển
  sang dạng gõ từ. Không bịa đáp án.
- Cloze chỉ tạo khi câu ví dụ thực sự chứa từ (regex ranh giới từ).

## 5. Widget

```
AppProvider.notifyDataChanged()
  → syncWidgets(db, settings)
     → getCounts / getActivityForDate / getStreak / getWordOfTheDay
     → buildDailyWordProps / buildGlanceProps   (pure, src/widgets/snapshot.ts)
     → DailyWordWidget.updateSnapshot(props)
     → ReviewGlanceWidget.updateSnapshot(props)
     → updateTimeline([now, next midnight])
```

- Widget **không** đọc SQLite và **không** gọi Gemini. Nó chỉ nhận props đã tính sẵn.
- Hai widget kind:
  - `DailyWordWidget`: systemSmall/Medium/Large
  - `ReviewGlanceWidget`: accessoryCircular/Rectangular/Inline
- App Group: `group.com.vocabmaster.personal` (khai báo trong `app.json`), cần Apple
  Developer Program trả phí.
- Lỗi đồng bộ (Expo Go, simulator, thiếu entitlement) được nuốt an toàn và hiển thị ở Cài đặt;
  app không crash.

## 6. Bảo mật

- Gemini key: nhập trong app → `expo-secure-store` (Keychain,
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Không có trong bundle, `.env`, Git, log, backup.
- Không có backend; request đi thẳng từ iPhone tới Google. Rủi ro: máy bị jailbreak hoặc bị
  mở khoá có thể lộ key. Với app cá nhân, đây là đánh đổi hợp lý; proxy sẽ tốn tiền hosting.
- Backup JSON chứa dữ liệu học, **không** chứa API key.
- `.env` bị `.gitignore`; `.env.example` chỉ có tên biến.

## 7. Những quyết định có chủ ý

| Quyết định | Lý do |
|---|---|
| Không dùng Expo Router | Ít dependency, không cần deep-link phức tạp |
| Không dùng thư viện state ngoài | AppProvider + props đủ; giảm rủi ro phiên bản |
| Không dùng zustand/redux | Không cần cho quy mô này |
| Tự viết CSV parser | Tránh dependency; đã có test cho ngoặc kép/CRLF |
| Tự viết schema validation cho Gemini | Không phụ thuộc zod; kiểm soát lỗi từng trường |
| Seed 40 từ thủ công | Học được ngay khi offline, không cần AI |
| Streak tính theo ngày hoàn thành mục tiêu | Không tăng chỉ vì mở app |
| Level chỉ là gợi ý | Một từ có thể phù hợp nhiều cấp độ |

## 8. Sơ đồ file quan trọng

Xem `CHECKPOINT.json → important_files`. Tóm tắt:

- `App.tsx` — providers, splash, gate onboarding, router, tab bar
- `src/db/schema.ts` — DDL, mapper, thứ tự cột
- `src/db/database.ts` — mở DB, migration, seed
- `src/db/words.ts` — CRUD, tìm kiếm, thống kê, chọn từ cho buổi học
- `src/db/reviews.ts` — ghi lượt ôn nguyên tử
- `src/srs/fsrs.ts` — thuật toán
- `src/quiz/generator.ts` — sinh câu hỏi
- `src/ai/gemini.ts` — client + key
- `src/speech/useSpeechCheck.ts` — hook nhận diện
- `widgets/*.tsx` — widget SwiftUI
- `src/screens/*.tsx` — 11 màn hình
