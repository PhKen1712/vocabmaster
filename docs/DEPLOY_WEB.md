# Bản web: chạy trong trình duyệt và đưa lên internet

Cập nhật: 2026-10-28 · Trạng thái: **đã deploy và kiểm thử trên trình duyệt thật**

---

## 1. Địa chỉ đang chạy

| Thứ | Địa chỉ |
|---|---|
| **Ứng dụng học (bản web)** | https://site-2fec18316472491faa6991234ac99ad6.freebuff.page |
| **Bảng quản trị** | https://site-803d281e336549f99eaf45a04acd4531.freebuff.page |

Cả hai cùng dùng chung một Supabase, nên đăng nhập cùng tài khoản là dùng chung một dữ liệu.

---

## 2. Chạy trên máy (không cần internet)

```bash
npm install
npm run start:web          # mở http://localhost:8081
```

Trên điện thoại **cùng mạng Wi-Fi**: mở địa chỉ `http://<IP-máy-tính>:8081`. Lấy IP bằng `ipconfig`
(Windows). Trình duyệt trên điện thoại cần HTTPS hoặc localhost cho một số tính năng (micro), nên
cách chắc chắn nhất để thử trên điện thoại là dùng địa chỉ đã deploy ở mục 1.

## 3. Đóng gói để deploy

```bash
npm run web:build          # export bản web rồi dựng gói deploy
```

Lệnh này chạy hai bước:

1. `expo export --platform web` → thư mục `dist-web/` (JS, WASM, nhạc, hiệu ứng âm thanh).
2. `scripts/build-web-site.mjs` → thư mục **`web/site/`** gồm `index.html`, `manifest.json` (cho máy
   chủ), `worker.js` và `assets/`.

Script thứ hai làm bốn việc mà bản export thô **không** có, và nếu thiếu thì bản web sẽ hỏng theo
những cách rất khó đoán:

| Việc | Vì sao bắt buộc |
|---|---|
| Gửi header `Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy` | `expo-sqlite` trên web chạy wa-sqlite trong Web Worker và cần `SharedArrayBuffer`; trình duyệt chỉ cho khi trang `crossOriginIsolated`. Thiếu header → không mở được database → ứng dụng trắng. |
| Đổi asset trong `node_modules/` sang `wasm/` | Máy chủ tĩnh từ chối gói chứa `node_modules` (coi là "dependencies"), và đường dẫn nội bộ của dự án cũng không nên lộ ra web. Đổi tên kèm cập nhật tham chiếu trong bundle. |
| Thêm PWA manifest + icon | Để "Thêm vào màn hình chính" trên iPhone/Android mở ra như một ứng dụng (không thanh địa chỉ). Icon được vẽ bằng mã trong script nên repo không chứa ảnh nhị phân. |
| Kiểm cú pháp `worker.js` | Worker sai cú pháp chỉ lộ ra khi Cloudflare từ chối deploy (lỗi 10021, "worker_upload") với thông báo không nói gì về cú pháp. |

Chọn `require-corp` chứ **không** `credentialless`: Safari trên iPhone không hiểu `credentialless`,
gặp giá trị lạ thì coi như không có cô lập → SQLite chết. `require-corp` chạy được trên cả ba nhóm
trình duyệt; đổi lại mọi tài nguyên ngoài miền phải có CORS/CORP — ứng dụng chỉ gọi Supabase và API
AI (đều là CORS fetch) nên không gặp trở ngại này.

## 4. Đưa lên mạng

1. `npm run web:build`
2. Copy gói deploy vào thư mục workspace của Freebuff (xem ghi chú bên dưới) rồi bấm **Publish**
   trong bảng Sites, hoặc nhờ trợ lý deploy.

Script nhận tham số `--out` để ghi thẳng vào thư mục đó:

```bash
node scripts/build-web-site.mjs --out "../App TANH/web-site"
```

> **Ghi chú quan trọng:** Freebuff chỉ deploy được file nằm trong **thư mục workspace của nó**, mà
> workspace đó không phải thư mục repo này. Đó là lý do phải copy gói sang đó (`web-site/` cho bản
> web, `admin-site/` cho bảng quản trị). Deploy thẳng từ trong repo sẽ báo
> "Check arguments and workspace files".

## 5. Bảng quản trị

```bash
npm run admin:build        # vite build + dựng gói deploy vào admin/site/
```

Script **chặn deploy nếu bản build thiếu cấu hình Supabase** (kiểm tra bundle có `supabase.co`
không) — đúng kiểu lỗi "panel không kết nối được" vì `VITE_*` được nhúng lúc build, thiếu file
`admin/.env` là ra trang trắng dù deploy thành công.

Cách vào bảng quản trị: xem [ADMIN_ACCESS.md](ADMIN_ACCESS.md).

## 6. Tính năng nào **không** chạy trên web

Nói rõ để không hứa hẹn sai:

| Tính năng | Trên web |
|---|---|
| Thông báo đẩy nhắc từ vựng | **Không có.** `expo-notifications` chỉ ghi log cảnh báo trên web. Phải dùng bản cài trên iPhone. |
| Widget màn hình chính | **Không có.** Chỉ bản native. |
| Đồng hồ khoá / widget | **Không có.** Chỉ bản native. |
| Luyện nói (nhận diện giọng nói) | Phụ thuộc trình duyệt. Chrome/Edge trên máy tính chạy tốt; Safari trên iPhone hạn chế. Bản cài iOS là bản đầy đủ. |
| Giọng đọc từ vựng (TTS) | Có, bằng giọng của hệ điều hành/trình duyệt. |
| Nhạc nền và hiệu ứng âm thanh | Có. Trình duyệt chỉ cho phát sau khi người dùng chạm một lần — bấm vào ứng dụng là được. |
| Dữ liệu học, album, xu, streak, đồng bộ | **Có đầy đủ** (SQLite trong máy bằng WASM + Supabase). |

## 7. Những gì đã kiểm thử trên bản đã deploy

| Kiểm thử | Kết quả |
|---|---|
| Trang tải được, `crossOriginIsolated = true`, `SharedArrayBuffer` có | Đạt |
| SQLite ghi/đọc bền (làm onboarding → tải lại trang vẫn giữ thiết lập, thư mục `expo-sqlite/` trong OPFS) | Đạt |
| Header `COEP: require-corp`, `COOP: same-origin`; file WASM trả `application/wasm` | Đạt |
| Giao diện 390×844 (điện thoại) | Một cột, 6 tab dưới đáy, **không tràn ngang** (`scrollWidth = 390`) |
| Giao diện 820×1180 (máy tính bảng) | Tab dưới đáy, cột nội dung 718px căn giữa, không tràn |
| Giao diện 1440×900 (máy tính) | Thanh điều hướng bên trái 6 mục kèm phím tắt 1–6 |
| Lỗi console | Chỉ 3 cảnh báo của `expo-notifications` (đã ghi rõ ở mục 6), không có lỗi |
| PWA | `manifest.webmanifest` và icon được phục vụ đúng; **chưa** cài lên màn hình chính thiết bị thật |

**Chưa kiểm được, không được coi là đạt:** Safari trên iPhone thật và Chrome trên Android thật —
không có thiết bị/máy ảo trong môi trường này. Phần cô lập nguồn gốc đã chọn đúng cho Safari
(`require-corp`), nhưng chỉ thiết bị thật mới xác nhận được.

## 8. Khi sửa code thì phải làm gì

Sửa xong, chạy `npm run web:build` rồi publish lại. **Không cần build lại IPA của iOS** — hai bản
dùng chung mã nguồn nhưng đóng gói độc lập. Chỉ khi sửa phần native (widget, quyền, thư viện có mã
native) mới phải build lại ứng dụng cài trên máy.

Một chi tiết dễ quên: biến `EXPO_PUBLIC_*` được **nhúng vào bundle lúc build**. Đổi Supabase URL hay
khoá anon thì phải build lại rồi deploy lại, sửa file `.env` trên máy chủ không có tác dụng.
