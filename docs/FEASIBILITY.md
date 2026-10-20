# Báo cáo khả thi — VocabMaster (Windows + iPhone, widget thật)

Cập nhật: 2026-10-19 · Người lập: phiên làm việc đầu tiên (AI)

Tài liệu này trả lời đúng những câu hỏi trong yêu cầu trước khi xây dựng tính năng:
có thể phát triển trên Windows không, build iOS bằng gì, cài lên iPhone thật bằng cách nào,
widget thật có đọc được dữ liệu ứng dụng không, và tốn bao nhiêu tiền.

---

## 0. Trạng thái môi trường thực tế (đã kiểm tra, không suy đoán)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Ghi file vào `C:\Users\Lenovo\Desktop\VocabMaster` | **Đã xác minh** | Đã tạo file thật trong thư mục này (xem `CHECKPOINT.json → important_files`) |
| Terminal / Git Bash | **Đã xác minh** | Sau khi cài Git for Windows: node/npm/git/tsc/jest đều chạy được trong phiên 2026-10-20 |
| Node.js, npm, Git | **Đã xác minh** | Node 24.18.0, npm 11.16.0, git 2.56.0 |
| Trình giả lập / máy Mac | Không có (theo yêu cầu) | — |
| iPhone thật | Có, nhưng chưa kết nối với phiên này | Cần người dùng cài và kiểm tra |

**Hệ quả (cập nhật 2026-10-20):** `npm install`, `npm run typecheck` (0 lỗi), `npm test`
(36/36 test pass) và `npx expo-doctor` (20/20) **đã chạy thật và xanh**. **Chưa chạy:**
`expo prebuild` cho iOS (Expo chặn trên Windows), EAS build và cài lên iPhone — ba việc này
cần macOS/EAS. Không có kết quả kiểm thử nào được báo cáo giả; số liệu nằm trong
`CHECKPOINT.md → mục 14` và `tools/verify-report.txt`.

---

## 1. Kết luận ngắn

1. **Phát triển trên Windows: hoàn toàn được.** React Native + Expo SDK 58, viết code và
   chạy Metro trên Windows; build iOS đẩy lên macOS cloud.
2. **Widget iOS thật: làm được** bằng `expo-widgets` (stable từ SDK 56, bản hiện tại
   `~58.0.20`). Hỗ trợ widget màn hình chính (`systemSmall/Medium/Large`) và màn hình khóa
   (`accessoryCircular/Rectangular/Inline`).
3. **Rào cản thật sự không phải widget, mà là App Groups + chữ ký ứng dụng.**
   `expo-widgets` chia sẻ dữ liệu app ↔ widget qua **App Group**. Apple chỉ cấp capability
   App Groups cho **Apple Developer Program trả phí ($99/năm)**. Tài khoản Apple miễn phí
   (Personal Team) không có App Groups, nên widget sẽ không đọc được dữ liệu học thật.
4. **Chi phí tối thiểu để đáp ứng đúng yêu cầu widget:** **99 USD/năm**, cộng **0 USD**
   cho build cloud (EAS Free: 15 build iOS/tháng). Không cần mua Mac.
5. **Phương án 0 USD** vẫn cài được app lên iPhone (Sideloadly + Apple ID miễn phí, hạn
   7 ngày), nhưng **không đáp ứng yêu cầu widget đọc dữ liệu thật** và phải ký lại mỗi
   7 ngày. Đây là lựa chọn đánh đổi, không phải “gần như tương đương”.

---

## 2. Phương án kỹ thuật đã chọn

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Framework | React Native 0.88 + Expo SDK 58, TypeScript strict | Chạy tốt trên Windows, hệ sinh thái native module đầy đủ |
| Điều hướng | Navigator nội bộ (stack + tab) tự viết | Ít dependency, không cần react-navigation; đủ cho 5 tab + màn hình chi tiết |
| Lưu trữ | `expo-sqlite` (SQLite, WAL), schema có `PRAGMA user_version` + migration forward-only | Dữ liệu bền vững, không mất khi đóng app; nâng cấp schema an toàn |
| Ôn tập | FSRS-5 (bộ trọng số mặc định) + bước học đầu tiên rút gọn | Lên lịch theo trí nhớ thực tế, có test cho các bất biến |
| Widget | `expo-widgets` + `@expo/ui/swift-ui`, config plugin tạo target WidgetKit | Widget thật, không phải PWA/website |
| Chia sẻ dữ liệu widget | App Group `group.com.vocabmaster.personal` (plugin tự tạo) | Cơ chế chính thức của Expo |
| Phát âm | `expo-speech` (TTS trên máy, miễn phí) | Không cần API, không tốn tiền, chọn giọng en-US/en-GB |
| Luyện nói | `expo-speech-recognition` (Apple Speech framework), ưu tiên on-device | Trên máy, miễn phí; chỉ so khớp từ, **không chấm âm vị** |
| AI | Gemini API gọi trực tiếp từ app, key trong iOS Keychain (`expo-secure-store`) | Không hardcode, không cần backend; có cảnh báo rủi ro |
| Build iOS | EAS Build (macOS cloud) | Không cần Mac |
| Cài lên iPhone | Development build qua EAS (khuyến nghị) hoặc Sideloadly (phương án 0 USD) | Không cần App Store |

---

## 3. Bốn câu hỏi bắt buộc — trả lời có nguồn

### 3.1. Có thể phát triển trên Windows bằng công cụ nào?

Có. Node.js LTS + Git for Windows + editor bất kỳ. Expo CLI/Metro chạy trên Windows.
**Không** build được iOS cục bộ, **không** chạy Simulator iOS trên Windows — build phải qua
macOS cloud (EAS) hoặc máy Mac.

### 3.2. Build iOS bằng dịch vụ macOS cloud nào?

**EAS Build** của Expo: mỗi build chạy trên một macOS VM mới, có gói Free
**15 build Android + 15 build iOS mỗi tháng**, hàng đợi ưu tiên thấp (có thể chờ 90+ phút
giờ cao điểm), timeout 45 phút, tối đa 1 job macOS đồng thời.

- https://expo.dev/pricing
- https://docs.expo.dev/build/introduction/
- https://docs.expo.dev/build-reference/ios-builds/

Gói trả phí (nếu sau này cần build nhanh hơn): Starter 19 USD/tháng + 2 USD/build medium;
Production 199 USD/tháng. Không cần cho dự án cá nhân.

### 3.3. Cài lên iPhone thật mà không lên App Store?

Hai đường:

**A. Development build qua EAS + Apple Developer Program ($99/năm) — khuyến nghị.**
EAS ký bằng chứng chỉ của bạn, cài qua QR/link, dùng được TestFlight hoặc ad hoc
(tối đa 100 thiết bị/năm). Không cần App Store. Thiết bị phải được đăng ký UDID.

**B. 0 USD: Sideloadly + Apple ID miễn phí.**
EAS không hỗ trợ ký ad hoc bằng tài khoản miễn phí (Expo ghi rõ internal distribution
“requires a paid Apple Developer account”). Đường miễn phí thực tế là tạo một bản `.ipa`
rồi để Sideloadly ký bằng Apple ID miễn phí trên Windows. Giới hạn của Apple ID miễn phí:

- Tối đa **10 App ID**, hết hạn sau **7 ngày**
- Tối đa **3 thiết bị**, đăng ký hết hạn sau **7 ngày**
- Tối đa **3 app** cài trên mỗi thiết bị
- Provisioning profile hết hạn sau **7 ngày** → phải build/ký lại và cài lại

Nguồn: https://developer.apple.com/help/account/basics/about-your-developer-account/
· https://sideloadly.io/faq.html · https://docs.expo.dev/build/internal-distribution/

**C. Không dùng PWA.** Website thêm vào màn hình chính không có WidgetKit, không có widget
màn hình khóa. Đã loại.

### 3.4. Widget Home Screen + Lock Screen thật, đọc dữ liệu app?

**Có, với `expo-widgets`:**
- `systemSmall`, `systemMedium`, `systemLarge` (và `systemExtraLarge` chỉ iPad)
- `accessoryCircular`, `accessoryRectangular`, `accessoryInline` cho màn hình khóa
- Không chạy trong Expo Go; cần development build
- Widget chạy trong runtime tách biệt: không hook, không async, chỉ `@expo/ui/swift-ui`
- Dữ liệu truyền qua props (`updateSnapshot` / `updateTimeline`) và thư mục chia sẻ
  `widgetsDirectory`. Plugin dùng `groupIdentifier` để tạo App Group.

Nguồn: https://docs.expo.dev/versions/latest/sdk/widgets/ (bản docs hiện tại: `~58.0.20`)
· https://expo.dev/changelog/sdk-56-beta (“Widgets for iOS promoted to stable”)

**Nhưng:** App Group là capability phụ thuộc loại thành viên chương trình. Apple nêu rõ
“The capabilities available to an iOS provisioning profile depend on your program membership”,
và App Groups chỉ có với Apple Developer Program trả phí. Vì vậy:

| Tài khoản | Cài app lên iPhone | Widget hiển thị | Widget đọc dữ liệu học thật |
|---|---|---|---|
| Apple ID miễn phí | Có (7 ngày/ký lại) | Có thể build extension, nhưng App Group không được cấp | **Không** |
| Apple Developer Program ($99/năm) | Có (ad hoc/TestFlight) | Có | **Có** |

Nguồn: https://developer.apple.com/help/account/reference/supported-capabilities-ios/
· https://developer.apple.com/help/account/identifiers/enable-app-capabilities/
· https://developer.apple.com/help/account/membership/program-enrollment/ ($99/năm)

> Điểm này cần được xác nhận lần cuối bằng **một lần build thật có App Group** trên tài
> khoản của bạn. Nếu Apple thay đổi chính sách, ghi lại kết quả vào checkpoint. Cho tới lúc
> đó, đây là kết luận từ tài liệu chính thức, chưa phải `verified_on_device`.

---

## 4. Chi phí (minh bạch)

| Khoản | Chi phí | Ghi chú |
|---|---|---|
| Phát triển trên Windows | 0 USD | Node, Git, VS Code đều miễn phí |
| EAS Build Free | 0 USD | 15 build iOS/tháng, 45 phút/build, hàng đợi chậm |
| Apple Developer Program | **99 USD/năm** | Bắt buộc cho App Groups → widget dữ liệu thật; gia hạn hằng năm |
| Gemini API | 0 USD trong hạn mức miễn phí, sau đó theo bảng giá Google | Hạn mức và giá thay đổi; kiểm tra https://ai.google.dev/gemini-api/docs/pricing |
| TTS + nhận diện giọng nói | 0 USD | Dùng engine của iOS |
| Widget, SQLite, thông báo cục bộ | 0 USD | Không có server |
| Mac thuê (chỉ nếu không muốn EAS) | ~1 USD/giờ (MacinCloud PAYG) | Không bắt buộc |

Không có khoản phí ẩn nào khác trong thiết kế hiện tại. Nếu dùng proxy backend để giấu
Gemini key, sẽ phát sinh chi phí hosting — dự án này **không** dùng proxy.

---

## 5. Giới hạn đã biết (phải nói rõ với người dùng)

1. **Widget không cập nhật tức thì.** iOS quyết định thời điểm refresh theo ngân sách riêng;
   app chỉ “đề nghị” cập nhật. Dữ liệu được đẩy khi bạn học/sửa từ/mở lại app.
2. **Không có deep link riêng cho từng widget trong `expo-widgets`.** Chạm widget mở app;
   app mở ở tab Hôm nay. (Live Activity có tham số URL, widget thì tài liệu không nêu.)
3. **Không chấm điểm phát âm theo âm vị.** Apple Speech chỉ trả transcript + confidence của
   từ. Ứng dụng chỉ báo “nhận đúng từ / chưa nhận đúng”, không tạo điểm phát âm giả.
4. **Nhận diện on-device phụ thuộc máy.** Nếu iPhone chưa có model tiếng Anh on-device, iOS
   báo lỗi; UI hiển thị lỗi và cho phép thử lại (có thể dùng mạng nếu người dùng chọn).
5. **Gemini có thể sai.** Mọi từ AI đều ở dạng đề xuất, phải được xem/sửa và bấm lưu.
6. **Sideloadly/AltStore 7 ngày.** Với tài khoản miễn phí, app hết hạn và phải ký lại.
7. **Expo Go không dùng được cho widget/speech recognition.** Cần development build.
8. **Không có App Store.** Đúng theo yêu cầu; app chỉ cài trên máy cá nhân.

---

## 6. Kế hoạch triển khai

| Giai đoạn | Nội dung | Trạng thái trong phiên này |
|---|---|---|
| 0 | Khảo sát, tài liệu khả thi, checkpoint | Đã viết xong |
| 1 | Proof of concept: 1 từ + 2 widget + chia sẻ dữ liệu + build | Code đã viết; **chưa build, chưa cài máy thật** |
| 2 | Khung app, SQLite, CRUD, import/export, migration | Code đã viết; typecheck sạch, test lib pass |
| 3 | Bộ máy học, quiz, FSRS, thống kê | Code + unit test **đã chạy: 36/36 pass** |
| 4 | Phát âm, luyện nói | Code đã viết; chưa kiểm thử trên máy |
| 5 | Gemini | Code đã viết; chưa gọi API thật |
| 6 | Widget dữ liệu thật, nhắc nhở, streak | Code đã viết; chưa build/kiểm thử |
| 7 | Kiểm thử toàn bộ, sửa lỗi | **Một phần:** typecheck 0 lỗi, 36/36 unit test pass, expo-doctor 20/20; còn thiết bị thật |
| 8 | Bàn giao | Tài liệu + checkpoint đã có |

**Thứ tự kiểm chứng bắt buộc khi có môi trường:**
1. Cài Git for Windows + Node 22.13/24 LTS.
2. `node scripts/setup.mjs` → `npm run typecheck` → `npm test`.
3. `npx expo prebuild --platform ios` xem prebuild có tạo target widget + App Group không.
4. EAS build development → cài lên iPhone → thêm 2 widget → kiểm tra dữ liệu thay đổi.
5. Chỉ khi bước 4 thành công mới đánh dấu `verified_on_device`.

---

## 7. Điều chưa xác minh (và cách xác minh)

| Điều chưa xác minh | Cách xác minh |
|---|---|
| Code biên dịch TypeScript sạch | `npm run typecheck` |
| Unit test FSRS/quiz/streak pass | `npm test` |
| `expo prebuild` tạo đúng 2 widget target | Chạy prebuild, xem `ios/` có `DailyWordWidget`/`ReviewGlanceWidget` |
| App Group được tạo và dùng được | Build bằng tài khoản trả phí, xem Signing & Capabilities |
| Widget đọc dữ liệu thật | Cài máy thật, thêm từ, xem widget đổi |
| Widget màn hình khóa hiển thị | Thêm accessory widget trên iPhone |
| Apple ID miễn phí có chặn App Group thật không | Thử build với Personal Team — dự kiến lỗi entitlement |
| `expo-widgets` API `createWidget`/`updateSnapshot` đúng như docs | Typecheck + build; nếu sai, sửa theo `node_modules/expo-widgets` |
| Gemini model `gemini-3.8-flash` còn khả dụng | Gọi thử trong app; app tự chuyển model nếu 404, Cài đặt → "Kiểm tra key + model" để lưu model mới |
| iOS có voice en-GB trên máy | Cài Settings → Accessibility → Spoken Content |
| Nhận diện on-device hoạt động | Thử trên iPhone thật, xem lỗi cụ thể |

---

## 8. Nguồn tham khảo

- Expo Widgets: https://docs.expo.dev/versions/latest/sdk/widgets/
- Expo SDK 56 (widgets stable): https://expo.dev/changelog/sdk-56-beta
- Expo SDK 55 (widgets alpha): https://expo.dev/changelog/sdk-55-beta
- EAS pricing: https://expo.dev/pricing
- EAS internal distribution (yêu cầu tài khoản trả phí): https://docs.expo.dev/build/internal-distribution/
- EAS iOS builds: https://docs.expo.dev/build-reference/ios-builds/
- Apple — giới hạn tài khoản miễn phí: https://developer.apple.com/help/account/basics/about-your-developer-account/
- Apple — capabilities theo loại thành viên: https://developer.apple.com/help/account/reference/supported-capabilities-ios/
- Apple — App Groups: https://developer.apple.com/help/account/identifiers/enable-app-capabilities/
- Apple — phí chương trình: https://developer.apple.com/help/account/membership/program-enrollment/
- Apple — mẫu có widget extension ký Personal Team: https://github.com/apple/sample-food-truck
- expo-speech: https://docs.expo.dev/versions/latest/sdk/speech/
- expo-speech-recognition: https://github.com/jamsch/expo-speech-recognition
- Apple — on-device recognition: https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition
- Sideloadly FAQ: https://sideloadly.io/faq.html
- AltStore FAQ: https://faq.altstore.io/altstore-classic/your-altstore
- SideStore FAQ: https://docs.sidestore.io/docs/faq
- Free Dictionary API: https://dictionaryapi.dev/
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
