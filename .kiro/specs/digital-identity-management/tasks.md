hoạch Triển khai — Hệ thống Quản lý Danh tính Số

## Task 1: Khởi tạo dự án và cấu trúc cơ sở

- [x] 1.1 Khởi tạo dự án Electron + React + TypeScript với Vite
- [x] 1.2 Cấu hình SQLite (better-sqlite3) và tạo schema database cho các bảng: users, profiles, profile_data, proxies, rotation_configs, extensions, profile_extensions, profile_access, rpa_scripts, action_logs
- [x] 1.3 Thiết lập cấu trúc thư mục dự án theo kiến trúc multi-layer (renderer, main, shared/types, services)
- [x] 1.4 Cấu hình Vitest và fast-check cho testing
- [x] 1.5 Định nghĩa tất cả TypeScript interfaces và types theo tài liệu thiết kế (ProfileConfig, FingerprintConfig, ProxyConfig, RPAScript, v.v.)

## Task 2: Profile Manager — Quản lý hồ sơ trình duyệt

- [x] 2.1 Triển khai createProfile(): tạo hồ sơ mới với vùng lưu trữ cô lập (Cookie, LocalStorage, IndexedDB, Cache) trong thư mục riêng
- [x] 2.2 Triển khai openProfile(): khởi chạy Playwright browser context với dữ liệu cô lập và trả về WebSocket endpoint
- [x] 2.3 Triển khai closeProfile(): đóng browser, lưu trạng thái hồ sơ
- [x] 2.4 Triển khai deleteProfile(): xóa hồ sơ và toàn bộ dữ liệu cô lập liên quan
- [x] 2.5 Triển khai updateProfile(): lưu thay đổi cấu hình hồ sơ
- [x] 2.6 Triển khai listProfiles(): trả về danh sách hồ sơ với tên, trạng thái, proxy, thời gian sử dụng gần nhất
- [x] 2.7 Hỗ trợ lựa chọn loại trình duyệt: SunBrowser (Chromium) và FlowerBrowser (Firefox)
- [x] 2.8 Viết property tests cho P1 (tạo hồ sơ cô lập), P2 (xóa hồ sơ), P3 (cập nhật cấu hình round-trip), P4 (danh sách đầy đủ thông tin)

## Task 3: Fingerprint Spoofer — Giả lập fingerprint

- [x] 3.1 Triển khai generateFingerprint(): tạo fingerprint data từ config bao gồm Canvas seed, WebGL seed, Audio seed
- [x] 3.2 Triển khai Canvas noise injection: thêm nhiễu vào kết quả render Canvas dựa trên seed
- [x] 3.3 Triển khai WebGL noise injection: thêm nhiễu vào kết quả render WebGL dựa trên seed
- [x] 3.4 Triển khai AudioContext frequency offset theo cấu hình hồ sơ
- [x] 3.5 Triển khai giả lập CPU cores (1-32) và RAM (1-64GB) qua navigator.hardwareConcurrency và navigator.deviceMemory
- [x] 3.6 Triển khai applyFingerprint(): inject JavaScript vào browser context để áp dụng tất cả fingerprint values
- [x] 3.7 Triển khai validateConsistency(): kiểm tra tính nhất quán giữa User-Agent, platform, appVersion, oscpu
- [x] 3.8 Triển khai giả lập User-Agent và giới hạn danh sách font theo cấu hình
- [x] 3.9 Triển khai WebRTC spoofing: chế độ "Disable" (vô hiệu hóa hoàn toàn) và "Proxy" (định tuyến qua proxy)
- [x] 3.10 Viết property tests cho P7 (fingerprint khác biệt), P8 (CPU/RAM range), P9 (nhất quán trong phiên), P10 (UA consistency), P11 (font list)

## Task 4: Proxy Manager — Quản lý proxy

- [x] 4.1 Triển khai addProxy() và removeProxy(): CRUD proxy với hỗ trợ HTTP, HTTPS, SOCKS5
- [x] 4.2 Triển khai assignToProfile(): gán proxy cho hồ sơ trình duyệt
- [x] 4.3 Triển khai checkProxy(): kết nối thực sự qua proxy (HTTP/HTTPS/SOCKS5) đến IP checker service (IP2Location, ipinfo.io, ip-api.com), trả về IP thực tế, Country, Region, City và Response time
- [x] 4.3.1 Triển khai SOCKS5 proxy connection: tạo kết nối SOCKS5 handshake với authentication, sau đó gửi HTTP request qua tunnel đến IP checker
- [x] 4.3.2 Triển khai HTTP/HTTPS proxy connection: gửi request qua HTTP CONNECT proxy đến IP checker
- [x] 4.3.3 Triển khai IP checker adapters: hỗ trợ IP2Location, ipinfo.io và ip-api.com với khả năng chọn provider
- [x] 4.3.4 Triển khai parse geo-location response: trích xuất IP, Country, Region, City từ response của IP checker
- [x] 4.4 Triển khai cấu hình browser sử dụng proxy đã gán trước khi tải trang
- [x] 4.5 Triển khai xử lý proxy không hoạt động: thông báo người dùng, cho phép chọn proxy thay thế hoặc khởi chạy không proxy
- [x] 4.6 Viết property test cho P12 (lưu proxy config round-trip) và unit tests cho các giao thức proxy

## Task 5: Xoay vòng IP tự động

- [x] 5.1 Triển khai tích hợp API Luminati và Oxylabs cho xoay vòng IP
- [x] 5.2 Triển khai configureRotation(): cấu hình xoay vòng IP theo khoảng thời gian
- [x] 5.3 Triển khai rotateIP(): xoay vòng IP với xác minh IP mới trước khi áp dụng
- [x] 5.4 Triển khai retry logic: thử tối đa 3 lần, thông báo lỗi và giữ IP hiện tại nếu thất bại
- [x] 5.5 Viết property test cho P13 (xoay vòng đúng khoảng thời gian) và unit test cho retry logic

## Task 6: Local API Server — API cục bộ

- [x] 6.1 Triển khai Express HTTP server khởi chạy trên cổng 5015
- [x] 6.2 Triển khai middleware xác thực API key (X-API-Key header)
- [x] 6.3 Triển khai POST /api/v1/profiles/:id/open — mở hồ sơ, trả về WebSocket endpoint
- [x] 6.4 Triển khai POST /api/v1/profiles/:id/close — đóng hồ sơ, lưu trạng thái
- [x] 6.5 Triển khai GET /api/v1/profiles — danh sách hồ sơ với trạng thái
- [x] 6.6 Triển khai error handling middleware: trả mã lỗi HTTP phù hợp với thông báo mô tả
- [x] 6.7 Viết property tests cho P14 (API error codes), P15 (API key auth) và smoke test cho P7.1 (server port)

## Task 7: RPA Engine — Bộ tự động hóa kéo-thả

- [x] 7.1 Triển khai RPAEngine.executeScript(): thực thi tuần tự các action blocks (navigate, click, type, wait, scroll, screenshot)
- [x] 7.2 Triển khai xử lý lỗi RPA: stop (dừng ngay), skip (bỏ qua), retry (thử lại)
- [x] 7.3 Triển khai saveScript() và loadScript(): lưu/tải kịch bản RPA
- [x] 7.4 Triển khai thư viện mẫu tự động hóa cho Facebook, Amazon, TikTok
- [x] 7.5 Triển khai loadTemplate(): tải mẫu vào trình soạn thảo, lưu phiên bản tùy chỉnh riêng biệt
- [x] 7.6 Viết property tests cho P16 (thực thi tuần tự), P17 (xử lý lỗi), P18 (lưu script round-trip), P19 (tải mẫu hợp lệ), P20 (không ghi đè mẫu)

## Task 8: RBAC System — Phân quyền

- [x] 8.1 Triển khai createUser(): tạo tài khoản với vai trò (Admin/Manager/User) và phạm vi quyền
- [x] 8.2 Triển khai checkAccess(): kiểm tra quyền truy cập hồ sơ dựa trên vai trò và permissions
- [x] 8.3 Triển khai updateRole(): thay đổi vai trò, áp dụng quyền mới ngay lập tức
- [x] 8.4 Triển khai shareProfile(): cấp quyền truy cập hồ sơ mà không tiết lộ mật khẩu đã lưu
- [x] 8.5 Triển khai revokeAccess(): thu hồi quyền và ngắt phiên làm việc hiện tại
- [x] 8.6 Viết property tests cho P21 (access control), P22 (role change), P23 (không lộ mật khẩu), P24 (giữ nguyên fingerprint)

## Task 9: Action Logger — Nhật ký hành động

- [x] 9.1 Triển khai ActionLogger.log(): ghi nhật ký với username, action, profileId, timestamp
- [x] 9.2 Triển khai ActionLogger.query(): truy vấn nhật ký với bộ lọc (userId, action, startDate, endDate)
- [x] 9.3 Triển khai phân quyền xem nhật ký: Admin/Manager xem tất cả, User chỉ xem của mình
- [x] 9.4 Cấu hình chính sách lưu trữ 90 ngày với job dọn dẹp tự động
- [x] 9.5 Viết property tests cho P25 (đầy đủ thông tin), P26 (lọc chính xác), P27 (User chỉ xem log mình)

## Task 10: Extension Center — Quản lý tiện ích mở rộng

- [x] 10.1 Triển khai uploadExtension(): xác thực file .zip và lưu trữ tiện ích
- [x] 10.2 Triển khai downloadFromStore(): tải tiện ích từ Chrome Web Store URL
- [x] 10.3 Triển khai assignToProfiles(): gán tiện ích cho nhóm hồ sơ, tự động cài đặt
- [x] 10.4 Triển khai removeExtension(): gỡ tiện ích khỏi kho và tất cả hồ sơ đã gán
- [x] 10.5 Triển khai đảm bảo tiện ích đã cài khi khởi chạy hồ sơ
- [x] 10.6 Viết property tests cho P28 (validate extension), P29 (gán nhóm), P30 (xóa tất cả)

## Task 11: Cloud Sync — Đồng bộ đám mây

- [x] 11.1 Triển khai syncProfile(): mã hóa và tải dữ liệu hồ sơ lên PostgreSQL cloud
- [x] 11.2 Triển khai downloadProfile(): tải và giải mã dữ liệu hồ sơ, khôi phục fingerprint
- [x] 11.3 Triển khai resume sync: lưu checkpoint, tiếp tục từ điểm dừng khi có kết nối
- [x] 11.4 Triển khai conflict detection: phát hiện xung đột khi hai máy cùng chỉnh sửa
- [x] 11.5 Triển khai resolveConflict(): cho phép người dùng chọn phiên bản giữ lại
- [x] 11.6 Viết property tests cho P5 (phát hiện xung đột), P6 (mã hóa dữ liệu)

## Task 12: Profile Serializer — Tuần tự hóa cấu hình

- [x] 12.1 Triển khai serialize(): chuyển đổi ProfileConfig thành JSON string bao gồm fingerprint, proxy, extensions
- [x] 12.2 Triển khai deserialize(): phân tích JSON string thành ProfileConfig
- [x] 12.3 Triển khai validate(): kiểm tra JSON hợp lệ, trả thông báo lỗi cụ thể cho trường thiếu/sai
- [x] 12.4 Viết property tests cho P31 (round-trip serialize), P32 (thông báo lỗi JSON)

## Task 13: Giao diện người dùng React

- [x] 13.1 Xây dựng trang quản lý hồ sơ: danh sách, tạo, sửa, xóa hồ sơ
- [x] 13.2 Xây dựng form cấu hình fingerprint: Canvas, WebGL, AudioContext, CPU, RAM, User-Agent, Fonts, WebRTC
- [x] 13.3 Xây dựng trang quản lý proxy: thêm, sửa, xóa, kiểm tra, gán proxy
- [x] 13.4 Xây dựng trình soạn thảo RPA kéo-thả với các action blocks
- [x] 13.5 Xây dựng trang quản lý RBAC: tạo user, phân quyền, chia sẻ hồ sơ
- [x] 13.6 Xây dựng trang nhật ký hành động với bộ lọc
- [x] 13.7 Xây dựng trang quản lý tiện ích mở rộng
- [x] 13.8 Xây dựng trang đồng bộ đám mây và xuất/nhập cấu hình
- [x] 13.9 Xây dựng trang cấu hình xoay vòng IP

## Task 14: Tích hợp và kiểm thử end-to-end

- [x] 14.1 Viết integration tests cho luồng mở hồ sơ với fingerprint và proxy
- [x] 14.2 Viết integration tests cho đồng bộ cloud (với mock server)
- [x] 14.3 Viết integration tests cho Local API endpoints
- [x] 14.4 Viết integration tests cho tích hợp proxy provider (Luminati/Oxylabs mock)
- [x] 14.5 Viết smoke tests cho khởi động server port 5015 và chính sách lưu trữ 90 ngày
- [x] 14.6 Kiểm tra end-to-end toàn bộ luồng: tạo hồ sơ → cấu hình fingerprint → gán proxy → mở browser → chạy RPA script
