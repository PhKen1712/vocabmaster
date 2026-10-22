# Dictionary API — nguồn đã kiểm chứng, cách dùng, giới hạn

Tài liệu này ghi lại **những gì đã gọi thật** ngày 2026-10-22/23, không phải suy đoán từ
tài liệu. Mọi endpoint dưới đây đều trả lời thật, dữ liệu mẫu là phản hồi thật (đã rút gọn).

## 1. Hai nguồn, hai việc khác nhau

| Nguồn | Endpoint | Cho gì | Key | Giấy phép |
|---|---|---|---|---|
| **dict.minhqnd.com** | `GET /api/v1/lookup?word=<từ>&lang=en` | **Nghĩa tiếng Việt** cho từ tiếng Anh, IPA, audio TTS, **từ loại bằng tiếng Việt** | Không | CC BY-SA 4.0, **bắt buộc ghi công** |
| **api.dictionaryapi.dev** | `GET /api/v2/entries/en/<từ>` | Định nghĩa **tiếng Anh**, câu ví dụ, từ đồng nghĩa/trái nghĩa, IPA, file mp3 | Không | CC BY-SA 3.0 (dữ liệu Wiktionary) |

Chạy thử:

```bash
curl "https://dict.minhqnd.com/api/v1/lookup?word=criminal&lang=en"
curl "https://api.dictionaryapi.dev/api/v2/entries/en/criminal"
```

### dict.minhqnd.com — dạng phản hồi đã thấy

```json
{
  "exists": true,
  "word": "criminal",
  "results": [{
    "lang_code": "en",
    "audio": "/api/v1/tts?word=criminal&lang=en",
    "meanings": [
      { "definition": "Có tội, phạm tội, tội ác.", "definition_lang": "vi", "example": "a criminal act", "pos": "Tính từ", "source": "Wiktionary" },
      { "definition": "Kẻ phạm tội, tội phạm.", "definition_lang": "vi", "example": "war criminal", "pos": "Danh từ", "source": "Wiktionary" }
    ],
    "pronunciations": [{ "ipa": "/ˈkrɪ.mə.nᵊl/", "region": null }],
    "relations": [{ "related_word": "criminal conversation", "relation_type": "Liên quan" }]
  }]
}
```

- Có **CORS** (`Access-Control-Allow-Origin: *`), không cần key.
- Không có tài liệu về rate limit. Vì vậy app tự giới hạn: **3 request đồng thời**, timeout 8 giây,
  tối đa 2 lần thử cho lỗi tạm thời.
- Từ không tồn tại → **404** `{"exists": false, "word": "..."}`.
- `audio` là đường dẫn tương đối tới `/api/v1/tts?word=...&lang=en` (trả `audio/mpeg`); app ghép
  thành URL tuyệt đối và chỉ dùng khi Wiktionary không có file mp3 thật.
- `pos` là tiếng Việt (`"Tính từ"`, `"Danh từ"`); app map sang `adjective`/`noun`/… để khớp mô hình từ.
- Ví dụ từ nguồn này thường là **cụm từ** (`"a criminal act"`), không phải câu đầy đủ. App chỉ dùng
  khi Wiktionary không có câu ví dụ, và chỉ nhận khi cụm đó chứa đúng từ.

### api.dictionaryapi.dev — dạng phản hồi đã thấy

Mảng các entry, mỗi entry có `phonetic`, `phonetics[{text, audio}]`, `meanings[{partOfSpeech,
definitions[{definition, example?, synonyms[], antonyms[]}], synonyms[], antonyms[]}]`,
`license {name: "CC BY-SA 3.0"}`, `sourceUrls: ["https://en.wiktionary.org/wiki/criminal"]`.

**Lỗi đã gặp thật, không phải tài liệu:** từ **không tồn tại** không trả 404 JSON mà trả
**HTTP 530** với body chữ thường `error code: 1033` (Cloudflare tunnel). Ba lần thử liên tiếp đều
như vậy, trong khi từ thật luôn 200. Vì thế `WIKTIONARY_SOURCE.notFoundStatuses = [404, 530]` và
**530 không bị retry** — retry chỉ làm chậm thêm cho một từ sai chính tả.

## 2. Dữ liệu nào thật sự có, dữ liệu nào có thể thiếu

| Trường trong app | Nguồn | Có thể thiếu? |
|---|---|---|
| `term` | Người dùng nhập | Không |
| `ipa` | minhqnd → Wiktionary | Có (từ hiếm, từ viết tắt) |
| `audioUrl` | Wiktionary mp3 → minhqnd TTS | Có |
| `partOfSpeech` | minhqnd (map VI→EN) → Wiktionary | Có |
| `meaningVi` | minhqnd | **Có** — đây là lý do duy nhất app gọi Gemini |
| `definitionEn` | Wiktionary → minhqnd (nếu có `definition_lang = en`) | Có |
| `exampleEn` | Wiktionary → minhqnd | Có |
| `synonyms` / `antonyms` | cả hai | Thường thiếu (nhiều từ thật không có) |
| `level` | **Người dùng chọn**, không lấy từ từ điển | Không (luôn có, nhưng là ước lượng của bạn) |
| `topic` | Người dùng nhập | Có |

Không trường nào được bịa để lấp giao diện. Trường thiếu được liệt kê trong `missing` của kết quả
tra, lưu vào cột `words.missing_fields`, hiện trên thẻ từ trước khi lưu và trong màn hình chi tiết
từ ("Còn thiếu: …").

## 3. Luồng xử lý

```
danh sách người dùng nhập
  → parseWordList (tách phẩy / chấm phẩy / xuống dòng, trim, gộp khoảng trắng,
    bỏ mục rỗng, bỏ trùng không phân biệt hoa thường, giữ thứ tự, tối đa 50 từ)
  → với mỗi từ: minhqnd + Wiktionary song song, sau limiter 3 request
  → cache (SQLite) theo khoá `nguồn:en:từ`, TTL 30 ngày; xoá bản cũ hơn 90 ngày lúc mở app
  → merge (nghĩa Việt + IPA ưu tiên minhqnd; định nghĩa/ví dụ ưu tiên Wiktionary)
  → nếu thiếu meaningVi: Gemini bổ sung tối đa 5 từ, đánh dấu `aiFilled = ['meaningVi']`
    và thêm `gemini` vào `sources`
  → người dùng chọn từ → createWord (source = 'dictionary', kèm dict_source + missing_fields)
```

Retry: **chỉ** mạng / timeout / 429 / 5xx, tối đa 2 lần, backoff 400 ms × 2^(n-1) có jitter,
`Retry-After` được tôn trọng nhưng cap 3 giây. 404, 530, JSON hỏng: **không** retry.
Timeout là deadline cứng 8 giây cho mỗi request, không có lớp retry thứ hai.

## 4. Nghĩa vụ ghi công (bắt buộc)

- Màn hình **Tạo bộ từ** có dòng ghi công bấm được tới https://dict.minhqnd.com.
- Dữ liệu minhqnd là **CC BY-SA 4.0**: ghi nguồn `@minhqnd`, dẫn link, và nếu chia sẻ lại dữ liệu
  đã chỉnh sửa thì phải theo cùng giấy phép.
- Dữ liệu Wiktionary (qua dictionaryapi.dev) là **CC BY-SA 3.0**.
- App **không** bundle dữ liệu của hai nguồn này vào repo; chỉ lưu những từ bạn chủ động thêm,
  trên máy bạn. Nếu sau này xuất bộ từ để chia sẻ, phải giữ ghi công và giấy phép.
- Không dùng Oxford 3000/5000, không dùng dataset EN–VI scraped không rõ giấy phép.

## 5. Kiểm thử

Chạy `npm test -- --ci` (14 suite, 153 test). Riêng từ điển:

| # | Trường hợp | Test |
|---|---|---|
| 1–4 | `criminal`, `civil`, `justice`, `evidence` | `src/dict/__tests__/lookup.test.ts` (payload thật, rút gọn) |
| 5–8 | khoảng trắng thừa, phẩy liên tiếp, từ trùng, cụm nhiều từ | `src/dict/__tests__/list.test.ts` |
| 9 | từ không tồn tại (404 + 530) | `reports "not found" when both dictionaries have no answer` |
| 10 | 429 rồi thành công | `retries a 429 once and succeeds` |
| 11 | timeout / mất mạng | `stops after the attempt budget and reports a timeout` (đúng 4 request, không retry thêm) |
| 12 | thiếu IPA/audio/nghĩa | `marks the fields a partial answer could not fill` |
| 13 | batch có từ thành công và từ lỗi | `keeps one bad word from breaking the rest of the batch` |
| 14 | tạo lại cùng danh sách | `serves a repeat lookup from the cache without any request` + `DuplicateWordError` khi lưu |
| 15 | dùng offline sau khi đã lưu | cache test (client ném lỗi mạng, kết quả vẫn `found`) |
| 16 | Gemini vẫn hoạt động | `src/ai/__tests__/*` (không đổi hành vi) |
| 17 | tính năng học cũ | 14 suite còn lại |

Kiểm tra ngoài unit test, chạy thật trong phiên này:

- `lookupWords(['criminal','civil','justice','evidence','zzqqxxvvyy','civil law'])` với endpoint
  thật: **6 từ trong 906 ms**, 4 từ đúng dữ liệu, 1 từ không tồn tại, 1 cụm từ bị cả hai từ điển
  từ chối (đúng như thiết kế).
- SQLite thật (`node:sqlite`): chạy migration 1 → chèn từ cũ → migration 2 → từ cũ giữ nguyên
  nghĩa, `reps`, `stability`, `due_at`; hai cột mới nhận `NULL` / `'[]'`.

**Chưa kiểm chứng:** giao diện trên iPhone (chưa có build mới), hành vi `AbortController` của
React Native, và mọi lời gọi Gemini thật trong luồng nhập danh sách.

## 6. Giới hạn đã biết

1. **Chỉ tra từ đơn.** `civil law`, `take off` đều 404 ở cả hai nguồn (đã thử). App báo rõ
   "hai từ điển này chỉ tra từ đơn" và đề nghị thêm tay, thay vì lưu một từ rỗng.
2. **Không có bản dịch câu ví dụ.** Cả hai nguồn chỉ trả ví dụ tiếng Anh, nên `exampleVi` để trống
   thay vì dịch máy.
3. **Level không đến từ từ điển.** CEFR không có trong dữ liệu trả về; app dùng cấp độ bạn chọn.
4. **Nghĩa Việt đầu tiên được chọn.** Các nghĩa khác được hiện trong thẻ ("Nghĩa khác: …") nhưng
   chỉ nghĩa đầu được lưu, vì mô hình `words` có một trường `meaningVi`.
5. **Offline chỉ đúng với từ đã tra.** Từ chưa từng tra cần mạng; từ đã tra nằm trong cache SQLite.
6. **Chất lượng dữ liệu của bên thứ ba.** minhqnd ghi rõ một số câu ví dụ do AI/LLM tạo; IPA có thể
   lệch với từ điển chuẩn. Vì vậy app ưu tiên file mp3 thật của Wiktionary và hiển thị nguồn từng từ.
