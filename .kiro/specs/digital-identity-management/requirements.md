# Tài liệu Yêu cầu — Hệ thống Quản lý Danh tính Số (Digital Identity Management)

## Giới thiệu

Hệ thống Quản lý Danh tính Số (Digital Identity Management) là một nền tảng desktop cho phép người dùng tạo và quản lý nhiều hồ sơ trình duyệt (browser profile) cô lập, mỗi hồ sơ có dấu vân tay (fingerprint) riêng biệt. Hệ thống hỗ trợ chống phát hiện fingerprint, quản lý proxy, tự động hóa thao tác trình duyệt, cộng tác nhóm và quản lý tiện ích mở rộng (extension) tập trung. Mục tiêu là cung cấp một giải pháp tương tự AdsPower, giúp người dùng vận hành nhiều tài khoản trực tuyến một cách an toàn và hiệu quả.

## Bảng thuật ngữ (Glossary)

- **Hệ_thống (System)**: Toàn bộ nền tảng Quản lý Danh tính Số, bao gồm ứng dụng desktop và các dịch vụ backend
- **Hồ_sơ_trình_duyệt (Browser_Profile)**: Một container cô lập chứa Cookie, LocalStorage, IndexedDB, Cache và cấu hình fingerprint riêng
- **Trình_quản_lý_hồ_sơ (Profile_Manager)**: Module quản lý vòng đời tạo, sửa, xóa, đồng bộ hồ sơ trình duyệt
- **Bộ_giả_lập_fingerprint (Fingerprint_Spoofer)**: Module chịu trách nhiệm tạo và áp dụng các giá trị fingerprint giả lập cho mỗi hồ sơ
- **Trình_quản_lý_proxy (Proxy_Manager)**: Module quản lý cấu hình, kiểm tra và xoay vòng proxy
- **Bộ_kiểm_tra_proxy (Proxy_Checker)**: Thành phần kiểm tra trạng thái hoạt động và tốc độ của proxy
- **API_cục_bộ (Local_API)**: Server HTTP cục bộ cung cấp giao diện điều khiển trình duyệt cho các công cụ tự động hóa bên ngoài
- **Bộ_RPA (RPA_Engine)**: Module thực thi các kịch bản tự động hóa dạng kéo-thả (no-code)
- **Hệ_thống_RBAC (RBAC_System)**: Module phân quyền dựa trên vai trò (Role-Based Access Control)
- **Trung_tâm_tiện_ích (Extension_Center)**: Module quản lý tập trung các tiện ích mở rộng trình duyệt
- **Bộ_đồng_bộ_đám_mây (Cloud_Sync)**: Module đồng bộ dữ liệu hồ sơ lên cloud và tải về máy khác
- **Người_dùng (User)**: Người sử dụng hệ thống với một trong các vai trò: Admin, Manager, User
- **Nhật_ký_hành_động (Action_Log)**: Bản ghi lịch sử hoạt động của từng thành viên trong nhóm
- **Trình_duyệt_nhúng (Embedded_Browser)**: Trình duyệt tùy chỉnh dựa trên Chromium (SunBrowser) hoặc Firefox (FlowerBrowser)
- **Mẫu_tự_động (Automation_Template)**: Kịch bản tự động hóa được xây dựng sẵn cho các nền tảng cụ thể

## Yêu cầu

### Yêu cầu 1: Tạo và quản lý hồ sơ trình duyệt

**User Story:** Là một người dùng, tôi muốn tạo và quản lý nhiều hồ sơ trình duyệt cô lập, để mỗi hồ sơ hoạt động như một thiết bị riêng biệt với dữ liệu tách biệt hoàn toàn.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng yêu cầu tạo hồ sơ mới, THE Trình_quản_lý_hồ_sơ SHALL tạo một Hồ_sơ_trình_duyệt với vùng lưu trữ Cookie, LocalStorage, IndexedDB và Cache riêng biệt
2. WHEN Người_dùng mở một Hồ_sơ_trình_duyệt, THE Trình_quản_lý_hồ_sơ SHALL khởi chạy Trình_duyệt_nhúng với dữ liệu cô lập của hồ sơ đó mà không ảnh hưởng đến các hồ sơ khác
3. WHEN Người_dùng chọn loại trình duyệt khi tạo hồ sơ, THE Trình_quản_lý_hồ_sơ SHALL hỗ trợ lựa chọn giữa SunBrowser (Chromium) và FlowerBrowser (Firefox)
4. WHEN Người_dùng xóa một Hồ_sơ_trình_duyệt, THE Trình_quản_lý_hồ_sơ SHALL xóa toàn bộ dữ liệu cô lập liên quan bao gồm Cookie, LocalStorage, IndexedDB và Cache
5. WHEN Người_dùng chỉnh sửa cấu hình hồ sơ, THE Trình_quản_lý_hồ_sơ SHALL lưu thay đổi và áp dụng cấu hình mới cho lần khởi chạy tiếp theo
6. THE Trình_quản_lý_hồ_sơ SHALL hiển thị danh sách tất cả hồ sơ với thông tin tên, trạng thái, proxy được gán và thời gian sử dụng gần nhất

### Yêu cầu 2: Đồng bộ hồ sơ lên đám mây

**User Story:** Là một người dùng, tôi muốn đồng bộ hồ sơ trình duyệt lên cloud, để tôi có thể mở hồ sơ trên bất kỳ máy tính nào mà không thay đổi fingerprint.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng kích hoạt đồng bộ cho một Hồ_sơ_trình_duyệt, THE Bộ_đồng_bộ_đám_mây SHALL tải toàn bộ dữ liệu hồ sơ bao gồm Cookie, LocalStorage, IndexedDB, Cache và cấu hình fingerprint lên máy chủ đám mây
2. WHEN Người_dùng mở một hồ sơ đã đồng bộ trên máy tính khác, THE Bộ_đồng_bộ_đám_mây SHALL tải dữ liệu hồ sơ về và khôi phục chính xác cấu hình fingerprint ban đầu
3. IF quá trình đồng bộ bị gián đoạn do mất kết nối mạng, THEN THE Bộ_đồng_bộ_đám_mây SHALL lưu trạng thái đồng bộ và tiếp tục từ điểm dừng khi kết nối được khôi phục
4. WHEN hai máy tính cùng chỉnh sửa một hồ sơ, THE Bộ_đồng_bộ_đám_mây SHALL phát hiện xung đột và thông báo cho Người_dùng chọn phiên bản giữ lại
5. THE Bộ_đồng_bộ_đám_mây SHALL mã hóa dữ liệu hồ sơ trước khi truyền tải lên máy chủ đám mây

### Yêu cầu 3: Giả lập fingerprint phần cứng

**User Story:** Là một người dùng, tôi muốn mỗi hồ sơ trình duyệt có fingerprint phần cứng riêng biệt, để các trang web không thể liên kết các hồ sơ với nhau thông qua Canvas, WebGL, AudioContext, CPU hoặc RAM.

#### Tiêu chí chấp nhận

1. WHEN một Hồ_sơ_trình_duyệt được khởi chạy, THE Bộ_giả_lập_fingerprint SHALL thêm nhiễu (noise) vào kết quả render Canvas sao cho giá trị hash Canvas khác biệt giữa các hồ sơ
2. WHEN một Hồ_sơ_trình_duyệt được khởi chạy, THE Bộ_giả_lập_fingerprint SHALL thêm nhiễu vào kết quả render WebGL sao cho giá trị hash WebGL khác biệt giữa các hồ sơ
3. WHEN một Hồ_sơ_trình_duyệt được khởi chạy, THE Bộ_giả_lập_fingerprint SHALL thay đổi tần số đầu ra AudioContext theo cấu hình của hồ sơ
4. WHEN Người_dùng cấu hình hồ sơ, THE Bộ_giả_lập_fingerprint SHALL cho phép khai báo số lõi CPU ảo trong khoảng từ 1 đến 32 lõi
5. WHEN Người_dùng cấu hình hồ sơ, THE Bộ_giả_lập_fingerprint SHALL cho phép khai báo dung lượng RAM ảo trong khoảng từ 1GB đến 64GB
6. WHILE một Hồ_sơ_trình_duyệt đang hoạt động, THE Bộ_giả_lập_fingerprint SHALL duy trì giá trị fingerprint phần cứng nhất quán trong suốt phiên làm việc

### Yêu cầu 4: Giả lập fingerprint phần mềm

**User Story:** Là một người dùng, tôi muốn tùy chỉnh fingerprint phần mềm cho mỗi hồ sơ, để các trang web không thể nhận diện hồ sơ qua User-Agent, font chữ hoặc WebRTC.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng cấu hình hồ sơ, THE Bộ_giả_lập_fingerprint SHALL cho phép thay đổi chuỗi User-Agent bao gồm tên trình duyệt, phiên bản và hệ điều hành
2. WHEN một Hồ_sơ_trình_duyệt được khởi chạy, THE Bộ_giả_lập_fingerprint SHALL giới hạn danh sách font hệ thống hiển thị cho trang web theo cấu hình của hồ sơ để tránh nhận diện qua font-family
3. WHEN Người_dùng cấu hình WebRTC cho hồ sơ ở chế độ "Disable", THE Bộ_giả_lập_fingerprint SHALL vô hiệu hóa hoàn toàn giao thức WebRTC để ngăn rò rỉ IP thực
4. WHEN Người_dùng cấu hình WebRTC cho hồ sơ ở chế độ "Proxy", THE Bộ_giả_lập_fingerprint SHALL định tuyến lưu lượng WebRTC qua proxy được gán cho hồ sơ
5. THE Bộ_giả_lập_fingerprint SHALL đảm bảo tính nhất quán giữa User-Agent và các thuộc tính navigator khác (platform, appVersion, oscpu) trong cùng một hồ sơ

### Yêu cầu 5: Quản lý proxy

**User Story:** Là một người dùng, tôi muốn gán và quản lý proxy cho từng hồ sơ trình duyệt, để mỗi hồ sơ sử dụng địa chỉ IP khác nhau.

#### Tiêu chí chấp nhận

1. THE Trình_quản_lý_proxy SHALL hỗ trợ cấu hình proxy với các giao thức HTTP, HTTPS và SOCKS5
2. WHEN Người_dùng gán proxy cho một Hồ_sơ_trình_duyệt, THE Trình_quản_lý_proxy SHALL lưu cấu hình proxy bao gồm giao thức, địa chỉ máy chủ, cổng, tên đăng nhập và mật khẩu
3. WHEN Người_dùng yêu cầu kiểm tra proxy, THE Bộ_kiểm_tra_proxy SHALL kết nối thực sự qua proxy đó (HTTP, HTTPS hoặc SOCKS5) đến dịch vụ IP checker (IP2Location, ipinfo.io hoặc tương đương) và trả về kết quả bao gồm: trạng thái kết nối (passed/failed), địa chỉ IP thực tế đi ra, quốc gia (Country/Region), vùng (Region), thành phố (City) và thời gian phản hồi (Response time) trong vòng 30 giây
4. WHEN Bộ_kiểm_tra_proxy thực hiện kiểm tra, THE Bộ_kiểm_tra_proxy SHALL hỗ trợ lựa chọn dịch vụ IP checker bao gồm IP2Location, ipinfo.io và ip-api.com
5. WHEN kết quả kiểm tra proxy được trả về, THE Trình_quản_lý_proxy SHALL hiển thị thông tin geo-location (IP, Country, Region, City) cùng với thời gian phản hồi cho Người_dùng
4. WHEN Người_dùng khởi chạy Hồ_sơ_trình_duyệt có proxy được gán, THE Trình_quản_lý_proxy SHALL cấu hình Trình_duyệt_nhúng sử dụng proxy đã gán trước khi tải bất kỳ trang web nào
5. IF proxy được gán cho hồ sơ không hoạt động khi khởi chạy, THEN THE Trình_quản_lý_proxy SHALL thông báo cho Người_dùng và cho phép chọn proxy thay thế hoặc khởi chạy không có proxy

### Yêu cầu 6: Xoay vòng IP tự động

**User Story:** Là một người dùng, tôi muốn tích hợp với nhà cung cấp proxy để tự động xoay vòng IP, để giảm nguy cơ bị phát hiện khi sử dụng cùng một IP quá lâu.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng cấu hình tích hợp nhà cung cấp proxy, THE Trình_quản_lý_proxy SHALL hỗ trợ kết nối qua API của các nhà cung cấp bao gồm Luminati và Oxylabs
2. WHEN Người_dùng bật xoay vòng IP cho một hồ sơ, THE Trình_quản_lý_proxy SHALL tự động thay đổi IP theo khoảng thời gian do Người_dùng cấu hình
3. WHEN IP được xoay vòng, THE Trình_quản_lý_proxy SHALL xác minh IP mới hoạt động trước khi áp dụng cho Hồ_sơ_trình_duyệt
4. IF xoay vòng IP thất bại sau 3 lần thử, THEN THE Trình_quản_lý_proxy SHALL thông báo lỗi cho Người_dùng và giữ nguyên IP hiện tại

### Yêu cầu 7: API cục bộ cho tự động hóa

**User Story:** Là một nhà phát triển, tôi muốn điều khiển trình duyệt thông qua API cục bộ, để tôi có thể tích hợp với Selenium, Playwright hoặc Puppeteer cho các kịch bản tự động hóa tùy chỉnh.

#### Tiêu chí chấp nhận

1. THE API_cục_bộ SHALL khởi chạy một HTTP server trên cổng mặc định 5015 khi Hệ_thống được khởi động
2. WHEN một yêu cầu mở hồ sơ được gửi đến API_cục_bộ, THE API_cục_bộ SHALL khởi chạy Hồ_sơ_trình_duyệt và trả về thông tin kết nối (WebSocket endpoint) để Selenium, Playwright hoặc Puppeteer kết nối điều khiển
3. WHEN một yêu cầu đóng hồ sơ được gửi đến API_cục_bộ, THE API_cục_bộ SHALL đóng Trình_duyệt_nhúng và lưu trạng thái hồ sơ
4. WHEN một yêu cầu lấy danh sách hồ sơ được gửi đến API_cục_bộ, THE API_cục_bộ SHALL trả về danh sách hồ sơ với trạng thái hiện tại (đang mở, đã đóng)
5. IF yêu cầu API không hợp lệ hoặc thiếu tham số bắt buộc, THEN THE API_cục_bộ SHALL trả về mã lỗi HTTP phù hợp kèm thông báo mô tả lỗi cụ thể
6. THE API_cục_bộ SHALL xác thực mỗi yêu cầu bằng API key để ngăn truy cập trái phép

### Yêu cầu 8: Bộ RPA kéo-thả (No-code)

**User Story:** Là một người dùng không biết lập trình, tôi muốn tạo kịch bản tự động hóa bằng giao diện kéo-thả, để tôi có thể tự động hóa các thao tác như nuôi tài khoản, lướt feed và click quảng cáo.

#### Tiêu chí chấp nhận

1. THE Bộ_RPA SHALL cung cấp giao diện kéo-thả cho phép Người_dùng tạo kịch bản tự động hóa bằng cách kết nối các khối hành động (action block)
2. THE Bộ_RPA SHALL hỗ trợ các khối hành động cơ bản bao gồm: mở URL, click phần tử, nhập văn bản, chờ đợi, cuộn trang và chụp ảnh màn hình
3. WHEN Người_dùng thực thi kịch bản RPA trên một Hồ_sơ_trình_duyệt, THE Bộ_RPA SHALL thực hiện tuần tự các hành động đã định nghĩa trong kịch bản
4. IF một hành động trong kịch bản RPA thất bại, THEN THE Bộ_RPA SHALL ghi log lỗi chi tiết và cho phép Người_dùng cấu hình hành vi xử lý lỗi (dừng, bỏ qua, hoặc thử lại)
5. WHEN Người_dùng lưu kịch bản RPA, THE Bộ_RPA SHALL lưu kịch bản dưới dạng có thể tái sử dụng và chia sẻ với các thành viên khác trong nhóm

### Yêu cầu 9: Mẫu tự động hóa theo nền tảng

**User Story:** Là một người dùng, tôi muốn sử dụng các mẫu tự động hóa có sẵn cho Facebook, Amazon và TikTok, để tôi có thể bắt đầu tự động hóa nhanh chóng mà không cần tạo kịch bản từ đầu.

#### Tiêu chí chấp nhận

1. THE Bộ_RPA SHALL cung cấp thư viện Mẫu_tự_động cho các nền tảng Facebook, Amazon và TikTok
2. WHEN Người_dùng chọn một Mẫu_tự_động, THE Bộ_RPA SHALL tải mẫu vào trình soạn thảo kéo-thả để Người_dùng có thể tùy chỉnh trước khi thực thi
3. WHEN Người_dùng tùy chỉnh và lưu một Mẫu_tự_động, THE Bộ_RPA SHALL lưu phiên bản tùy chỉnh riêng biệt mà không ghi đè lên mẫu gốc

### Yêu cầu 10: Phân quyền dựa trên vai trò (RBAC)

**User Story:** Là một quản trị viên, tôi muốn phân quyền cho các thành viên trong nhóm theo vai trò, để kiểm soát ai có thể truy cập và thao tác trên hồ sơ trình duyệt nào.

#### Tiêu chí chấp nhận

1. THE Hệ_thống_RBAC SHALL hỗ trợ ba vai trò: Admin (toàn quyền), Manager (quản lý hồ sơ và thành viên trong phạm vi được gán) và User (chỉ sử dụng hồ sơ được cấp quyền)
2. WHEN Admin tạo tài khoản thành viên mới, THE Hệ_thống_RBAC SHALL yêu cầu chỉ định vai trò và phạm vi quyền truy cập hồ sơ
3. WHEN Người_dùng có vai trò User cố truy cập hồ sơ không được cấp quyền, THE Hệ_thống_RBAC SHALL từ chối truy cập và hiển thị thông báo không có quyền
4. WHEN Admin thay đổi vai trò của một thành viên, THE Hệ_thống_RBAC SHALL áp dụng quyền mới ngay lập tức cho phiên làm việc tiếp theo của thành viên đó
5. THE Hệ_thống_RBAC SHALL ngăn chặn Người_dùng có vai trò User xóa hoặc chỉnh sửa cấu hình hồ sơ mà Người_dùng đó chỉ có quyền sử dụng

### Yêu cầu 11: Chia sẻ hồ sơ trình duyệt

**User Story:** Là một quản lý nhóm, tôi muốn chia sẻ hoặc chuyển giao quyền truy cập hồ sơ cho thành viên khác, mà không để lộ mật khẩu hoặc thay đổi fingerprint của hồ sơ.

#### Tiêu chí chấp nhận

1. WHEN Manager hoặc Admin chia sẻ hồ sơ cho thành viên khác, THE Hệ_thống_RBAC SHALL cấp quyền truy cập mà không tiết lộ mật khẩu các tài khoản đã lưu trong hồ sơ
2. WHEN hồ sơ được chia sẻ, THE Trình_quản_lý_hồ_sơ SHALL giữ nguyên toàn bộ cấu hình fingerprint của hồ sơ đó
3. WHEN Manager hoặc Admin thu hồi quyền truy cập hồ sơ của một thành viên, THE Hệ_thống_RBAC SHALL ngắt phiên làm việc hiện tại của thành viên đó trên hồ sơ (nếu đang mở) và xóa quyền truy cập

### Yêu cầu 12: Nhật ký hành động

**User Story:** Là một quản trị viên, tôi muốn xem lịch sử hoạt động của từng thành viên, để kiểm soát rủi ro và phát hiện hành vi bất thường.

#### Tiêu chí chấp nhận

1. WHEN một Người_dùng thực hiện hành động trên hồ sơ (mở, đóng, chỉnh sửa, xóa), THE Hệ_thống SHALL ghi Nhật_ký_hành_động bao gồm tên người dùng, hành động, hồ sơ liên quan và thời gian thực hiện
2. WHEN Admin hoặc Manager yêu cầu xem nhật ký, THE Hệ_thống SHALL hiển thị danh sách Nhật_ký_hành_động có hỗ trợ lọc theo người dùng, loại hành động và khoảng thời gian
3. THE Hệ_thống SHALL lưu trữ Nhật_ký_hành_động trong tối thiểu 90 ngày
4. WHEN Người_dùng có vai trò User yêu cầu xem nhật ký, THE Hệ_thống SHALL chỉ hiển thị nhật ký hành động của chính Người_dùng đó

### Yêu cầu 13: Quản lý tiện ích mở rộng tập trung

**User Story:** Là một quản trị viên, tôi muốn quản lý tiện ích mở rộng trình duyệt tập trung, để tôi có thể cài đặt tự động các addon cần thiết cho tất cả hồ sơ được chỉ định.

#### Tiêu chí chấp nhận

1. WHEN Admin tải lên tiện ích mở rộng dưới dạng file .zip, THE Trung_tâm_tiện_ích SHALL xác thực định dạng file và lưu trữ tiện ích trong kho tập trung
2. WHEN Admin cung cấp liên kết Chrome Web Store, THE Trung_tâm_tiện_ích SHALL tải về và lưu trữ tiện ích mở rộng tương ứng
3. WHEN Admin gán tiện ích cho một nhóm hồ sơ, THE Trung_tâm_tiện_ích SHALL tự động cài đặt tiện ích vào tất cả Hồ_sơ_trình_duyệt trong nhóm đó
4. WHEN một Hồ_sơ_trình_duyệt được khởi chạy, THE Trung_tâm_tiện_ích SHALL đảm bảo tất cả tiện ích được gán đã được cài đặt và kích hoạt
5. WHEN Admin xóa tiện ích khỏi kho tập trung, THE Trung_tâm_tiện_ích SHALL gỡ cài đặt tiện ích đó khỏi tất cả Hồ_sơ_trình_duyệt đã được gán
6. IF file tiện ích tải lên không đúng định dạng hoặc bị hỏng, THEN THE Trung_tâm_tiện_ích SHALL từ chối file và hiển thị thông báo lỗi mô tả nguyên nhân cụ thể

### Yêu cầu 14: Tuần tự hóa và khôi phục cấu hình hồ sơ

**User Story:** Là một người dùng, tôi muốn xuất và nhập cấu hình hồ sơ, để tôi có thể sao lưu hoặc di chuyển cấu hình giữa các hệ thống.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng yêu cầu xuất cấu hình hồ sơ, THE Trình_quản_lý_hồ_sơ SHALL tuần tự hóa (serialize) toàn bộ cấu hình fingerprint, proxy và tiện ích thành định dạng JSON
2. WHEN Người_dùng nhập file cấu hình JSON, THE Trình_quản_lý_hồ_sơ SHALL phân tích (parse) file và tạo Hồ_sơ_trình_duyệt mới với cấu hình tương ứng
3. FOR ALL cấu hình hồ sơ hợp lệ, việc tuần tự hóa rồi phân tích rồi tuần tự hóa lại SHALL tạo ra kết quả tương đương với bản tuần tự hóa ban đầu (thuộc tính round-trip)
4. IF file cấu hình JSON không hợp lệ hoặc thiếu trường bắt buộc, THEN THE Trình_quản_lý_hồ_sơ SHALL trả về thông báo lỗi mô tả cụ thể trường bị thiếu hoặc giá trị không hợp lệ
