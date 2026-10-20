# Build iOS từ Windows và cài lên iPhone

> Đọc `docs/FEASIBILITY.md` trước. Tóm tắt: build cloud miễn phí, nhưng widget đọc dữ liệu
> thật cần Apple Developer Program ($99/năm) vì App Groups.

> **Muốn cài miễn phí ngay (không widget)?** Dùng
> **[`docs/FREE_SIDELOAD.md`](FREE_SIDELOAD.md)**: GitHub Actions build `.ipa` không ký trên
> macOS, Sideloadly ký bằng Apple ID thường. Tài liệu dưới đây là đường EAS + tài khoản trả phí.

---

## 0. Cài công cụ trên Windows (một lần)

1. **Git for Windows** (bắt buộc — cũng cấp Git Bash cho công cụ AI):
   https://git-scm.com/download/win
   Kiểm tra: mở Git Bash → `git --version`
2. **Node.js LTS 22.13+ hoặc 24.x**: https://nodejs.org
   Kiểm tra: `node --version` và `npm --version`
3. **Expo/EAS CLI** (không cần cài global):
   ```bash
   npx eas-cli@latest --version
   ```
4. Tài khoản Expo miễn phí: https://expo.dev/signup
5. (Chỉ khi dùng Sideloadly) iTunes bản tải từ apple.com, **không** phải bản Microsoft Store.

---

## 1. Cài dependency và kiểm tra code

```bash
cd "C:/Users/Lenovo/Desktop/VocabMaster"
node scripts/setup.mjs
npm run typecheck
npm test
```

Kỳ vọng: typecheck không lỗi; 4 file test pass (FSRS, quiz, streak, text). Nếu lỗi, xem
`CHANGELOG.md` mục “Lỗi đã biết” trước khi sửa.

---

## 2. Chuẩn bị bundle identifier và App Group

Trong `app.json`:

```json
"bundleIdentifier": "com.vocabmaster.personal"
```

App Group mặc định: `group.com.vocabmaster.personal`.

**Phải đổi `com.vocabmaster.personal` thành duy nhất** nếu Apple báo trùng (ví dụ thêm tên
bạn: `com.lenovo.vocabmaster`). Nếu đổi, đổi cả `groupIdentifier` cho khớp.

---

## 3. Đăng nhập EAS

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

`eas init` tạo `projectId` trong `app.json`. Đây là định danh project trên Expo, không phải
secret.

---

## 4. Đăng ký Apple Developer Program (cần cho widget dữ liệu thật)

1. https://developer.apple.com/programs/enroll/ → 99 USD/năm.
2. Dùng cùng Apple ID với iPhone.
3. Sau khi được duyệt, chạy:

```bash
npx eas-cli@latest device:create
```

Quét QR bằng iPhone để đăng ký UDID (cần cho ad hoc).

---

## 5. Build development (khuyến nghị)

```bash
npx eas-cli@latest build --platform ios --profile development
```

- EAS sẽ hỏi Apple ID, tạo certificate + provisioning profile, bật App Groups.
- Gói Free: 15 build iOS/tháng, có thể chờ lâu.
- Khi xong, mở link trên iPhone → cài. Lần đầu cần bật **Developer Mode**:
  Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển.

Nếu Apple từ chối App Group, kiểm tra:
- Tài khoản đã là Apple Developer Program (không phải Personal Team).
- `groupIdentifier` khớp App Group đã tạo trong Apple Developer portal.
- Chạy lại `npx eas-cli@latest credentials` và để EAS tạo lại profile.

---

## 6. Cài lên iPhone

**Cách A — EAS development build:** mở link build trên iPhone, bấm Install.

**Cách B — Sideloadly (0 USD, không có widget dữ liệu thật):**
1. Tạo file `.ipa` từ build (EAS cần tài khoản trả phí để ký; nếu không có, phải tự build
   unsigned trên macOS runner — xem mục 8).
2. Mở Sideloadly trên Windows, kéo `.ipa`, nhập Apple ID, bấm Start.
3. Trên iPhone: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → tin cậy developer.
4. Hết hạn sau 7 ngày → ký lại.

> Với Apple ID miễn phí, App Group không được cấp → widget không đọc được dữ liệu học.
> Đây là giới hạn của Apple, không phải lỗi code.

---

## 7. Thêm widget

1. Mở app ít nhất một lần (để widget xuất hiện trong gallery).
2. Màn hình chính: giữ màn hình → nút **+** → tìm “VocabMaster” → chọn
   **Từ vựng hôm nay** (Small/Medium/Large).
3. Màn hình khóa: giữ màn hình khóa → **Tuỳ chỉnh** → **Màn hình khóa** → **Thêm widget**
   → VocabMaster → **Ôn tập nhanh** (Circular/Rectangular/Inline).
4. Quay lại app, học vài từ, mở lại app → widget cập nhật (iOS có thể trễ vài phút).

Kiểm tra dữ liệu thật: thêm một từ mới → widget phải hiển thị đúng số từ cần ôn / từ trong ngày.
Nếu không đổi, xem mục “Widget không cập nhật” trong README.

---

## 8. Phương án không có Apple trả phí (giới hạn)

Không có đường miễn phí nào cho **widget đọc dữ liệu app** vì App Groups là capability trả phí.
Các lựa chọn:

- Dùng app không widget (vẫn đủ học/ôn/Gemini) và ký lại mỗi 7 ngày.
- Thuê Mac theo giờ (MacinCloud ~1 USD/giờ) để dùng Xcode Personal Team — vẫn không có
  App Groups.
- Chờ/tiết kiệm 99 USD.

Không có cách nào trong ba cách trên tạo ra widget dữ liệu thật. Đừng đánh dấu
`verified_on_device` cho widget cho tới khi build bằng tài khoản trả phí.

---

## 9. Khi chứng chỉ / profile hết hạn

### Apple Developer Program (trả phí)

- Membership hết hạn sau 1 năm → gia hạn tại developer.apple.com. App đã cài vẫn chạy tới khi
  provisioning profile hết hạn.
- Profile ad hoc có thời hạn (thường 1 năm). Khi hết hạn: `eas credentials` để tạo lại
  certificate/profile, rồi `eas build --profile development`. Cài đè lên app cũ để giữ dữ liệu.
- TestFlight: mỗi build hết hạn sau 90 ngày → upload build mới.
- Không xoá app khỏi iPhone trước khi xuất backup JSON nếu chưa chắc dữ liệu đã an toàn.

### Apple ID miễn phí (Sideloadly / AltStore / SideStore)

- App hết hạn sau **7 ngày** và sẽ không mở được. Đây là giới hạn của Apple, không phải lỗi app.
- Cách gia hạn:
  1. Kết nối iPhone với PC (hoặc cùng Wi-Fi nếu công cụ hỗ trợ).
  2. Mở Sideloadly/AltStore, chọn app, bấm refresh/re-sign.
  3. Nếu iOS yêu cầu, bật lại Developer Mode và tin cậy máy tính.
- Cài đè (không xoá app) thường giữ dữ liệu; tuy nhiên **luôn xuất JSON backup trước** vì
  re-sign có thể thất bại và buộc phải xoá/cài lại.
- Sideloadly chỉ tự refresh khi PC bật và nhận được iPhone; AltStore/SideStore có cơ chế refresh
  riêng nhưng vẫn tiêu tốn 1 trong 3 slot app.

### EAS credentials bị thu hồi

- Chạy `npx eas-cli@latest credentials`, xoá profile/certificate cũ nếu cần, để EAS tạo lại,
  sau đó build lại. Không tự sửa file `.mobileprovision` bằng tay.

---

## 10. Lỗi build thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `App Group ... not found` | Profile chưa có capability | Tạo App Group trong portal, chạy lại `eas credentials` |
| `Provisioning profile doesn't include entitlement` | Dùng Personal Team | Cần Apple Developer Program |
| `Widget target missing` | Chưa prebuild | `npx expo prebuild --platform ios --clean` rồi build lại |
| `No bundle identifier` | Thiếu `ios.bundleIdentifier` | Điền trong `app.json` |
| `expo-widgets not available in Expo Go` | Chạy bằng Expo Go | Dùng development build |
| Build timeout 45 phút | Gói Free | Giảm dependency, build lại, hoặc nâng gói |

---

## 11. Cập nhật app sau khi sửa code

- Sửa JS/TS: chỉ cần build lại, hoặc dùng development build + Metro (`npm start`).
- Sửa `app.json`, thêm native module, đổi widget: **phải build lại** native.
- Sau khi đổi schema DB: tăng `SCHEMA_VERSION` + thêm migration mới, không sửa migration cũ.
