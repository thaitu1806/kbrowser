# Tài liệu Yêu cầu — Tích hợp RPA tại cấp Profile (Profile-RPA)

## Giới thiệu

Tính năng Profile-RPA cung cấp lớp tích hợp giữa hệ thống RPA Engine và Profile Manager, cho phép người dùng gán, cấu hình và thực thi các kịch bản RPA trực tiếp trên từng hồ sơ trình duyệt hoặc hàng loạt nhiều hồ sơ. Tính năng bao gồm hàng đợi tác vụ (task queue), lập lịch thực thi (scheduling), theo dõi trạng thái và hỗ trợ thực thi theo thứ tự hoặc ngẫu nhiên — tương tự giao diện RPA Dialog của AdsPower.

## Bảng thuật ngữ (Glossary)

- **Hệ_thống (System)**: Toàn bộ nền tảng Quản lý Danh tính Số
- **Bộ_RPA (RPA_Engine)**: Module thực thi các kịch bản tự động hóa dạng no-code
- **Trình_quản_lý_hồ_sơ (Profile_Manager)**: Module quản lý vòng đời hồ sơ trình duyệt
- **Bộ_điều_phối_RPA (RPA_Orchestrator)**: Module mới chịu trách nhiệm điều phối việc gán và thực thi kịch bản RPA trên các hồ sơ
- **Hồ_sơ_trình_duyệt (Browser_Profile)**: Một container cô lập chứa dữ liệu trình duyệt và cấu hình fingerprint
- **Kịch_bản_RPA (RPA_Script)**: Một chuỗi hành động tự động hóa được định nghĩa sẵn
- **Tác_vụ_RPA (RPA_Task)**: Một đơn vị thực thi gồm một Kịch_bản_RPA được gán cho một Hồ_sơ_trình_duyệt cụ thể với cấu hình thực thi
- **Hàng_đợi_tác_vụ (Task_Queue)**: Danh sách các Tác_vụ_RPA chờ thực thi, được sắp xếp theo thứ tự ưu tiên
- **Thứ_tự_thực_thi (Execution_Order)**: Cách sắp xếp thứ tự chạy các tác vụ: Tuần_tự (Ordered) hoặc Ngẫu_nhiên (Random)
- **Loại_tác_vụ (Task_Type)**: Phân loại tác vụ: Thường (Common — chạy một lần) hoặc Lập_lịch (Scheduled — chạy theo lịch)
- **Ưu_tiên_thực_thi (Priority_Execution)**: Cờ cho phép tác vụ được đẩy lên đầu hàng đợi để thực thi trước
- **Lịch_trình (Schedule)**: Cấu hình thời gian chạy tự động dạng cron cho tác vụ lập lịch
- **Trạng_thái_tác_vụ (Task_Status)**: Trạng thái hiện tại của tác vụ: pending, running, completed, failed, cancelled
- **Người_dùng (User)**: Người sử dụng hệ thống

## Yêu cầu

### Yêu cầu 1: Gán kịch bản RPA cho hồ sơ trình duyệt

**User Story:** Là một người dùng, tôi muốn gán một kịch bản RPA cho một hoặc nhiều hồ sơ trình duyệt, để tôi có thể chạy tự động hóa trên các hồ sơ cụ thể.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng mở dialog RPA cho một Hồ_sơ_trình_duyệt, THE Bộ_điều_phối_RPA SHALL hiển thị danh sách tất cả Kịch_bản_RPA khả dụng để lựa chọn
2. WHEN Người_dùng chọn một Kịch_bản_RPA từ danh sách, THE Bộ_điều_phối_RPA SHALL tạo một Tác_vụ_RPA liên kết Kịch_bản_RPA đó với Hồ_sơ_trình_duyệt được chọn
3. WHEN Người_dùng chọn nhiều Hồ_sơ_trình_duyệt từ danh sách hồ sơ, THE Bộ_điều_phối_RPA SHALL cho phép gán cùng một Kịch_bản_RPA cho tất cả hồ sơ được chọn trong một thao tác
4. IF Kịch_bản_RPA được chọn không tồn tại hoặc đã bị xóa, THEN THE Bộ_điều_phối_RPA SHALL hiển thị thông báo lỗi và không tạo Tác_vụ_RPA

### Yêu cầu 2: Cấu hình thực thi RPA trên hồ sơ

**User Story:** Là một người dùng, tôi muốn cấu hình cách thức thực thi RPA trên hồ sơ (thứ tự, loại tác vụ, ưu tiên), để tôi có thể kiểm soát hành vi chạy tự động hóa theo nhu cầu.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng tạo Tác_vụ_RPA, THE Bộ_điều_phối_RPA SHALL cho phép chọn Thứ_tự_thực_thi là Tuần_tự hoặc Ngẫu_nhiên
2. WHEN Người_dùng chọn Thứ_tự_thực_thi là Tuần_tự, THE Bộ_điều_phối_RPA SHALL thực thi các tác vụ theo đúng thứ tự trong danh sách hồ sơ được chọn
3. WHEN Người_dùng chọn Thứ_tự_thực_thi là Ngẫu_nhiên, THE Bộ_điều_phối_RPA SHALL xáo trộn thứ tự hồ sơ trước khi thực thi
4. WHEN Người_dùng tạo Tác_vụ_RPA, THE Bộ_điều_phối_RPA SHALL cho phép chọn Loại_tác_vụ là Thường hoặc Lập_lịch
5. WHEN Người_dùng bật cờ Ưu_tiên_thực_thi cho một Tác_vụ_RPA, THE Bộ_điều_phối_RPA SHALL đặt tác vụ đó lên đầu Hàng_đợi_tác_vụ
6. WHEN Người_dùng chọn Loại_tác_vụ là Thường, THE Bộ_điều_phối_RPA SHALL thực thi tác vụ một lần duy nhất và đánh dấu hoàn thành sau khi kết thúc

### Yêu cầu 3: Hàng đợi tác vụ RPA theo hồ sơ

**User Story:** Là một người dùng, tôi muốn hệ thống quản lý hàng đợi tác vụ RPA cho từng hồ sơ, để nhiều kịch bản có thể được xếp hàng và thực thi tuần tự trên cùng một hồ sơ.

#### Tiêu chí chấp nhận

1. THE Bộ_điều_phối_RPA SHALL duy trì một Hàng_đợi_tác_vụ riêng biệt cho mỗi Hồ_sơ_trình_duyệt
2. WHEN một Tác_vụ_RPA mới được thêm vào Hàng_đợi_tác_vụ của một hồ sơ đang có tác vụ chạy, THE Bộ_điều_phối_RPA SHALL đặt tác vụ mới ở cuối hàng đợi với Trạng_thái_tác_vụ là pending
3. WHEN tác vụ hiện tại hoàn thành hoặc thất bại, THE Bộ_điều_phối_RPA SHALL tự động lấy tác vụ tiếp theo trong Hàng_đợi_tác_vụ và bắt đầu thực thi
4. WHEN Người_dùng hủy một Tác_vụ_RPA đang ở trạng thái pending, THE Bộ_điều_phối_RPA SHALL xóa tác vụ khỏi Hàng_đợi_tác_vụ và đặt Trạng_thái_tác_vụ là cancelled
5. WHEN Người_dùng hủy một Tác_vụ_RPA đang ở trạng thái running, THE Bộ_điều_phối_RPA SHALL dừng thực thi ngay lập tức và đặt Trạng_thái_tác_vụ là cancelled
6. THE Bộ_điều_phối_RPA SHALL giới hạn số lượng tác vụ chạy đồng thời trên toàn hệ thống theo cấu hình tối đa do Người_dùng thiết lập

### Yêu cầu 4: Thực thi RPA hàng loạt trên nhiều hồ sơ

**User Story:** Là một người dùng, tôi muốn chạy một kịch bản RPA trên nhiều hồ sơ cùng lúc, để tôi có thể tự động hóa thao tác hàng loạt một cách hiệu quả.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng chọn nhiều Hồ_sơ_trình_duyệt và khởi chạy RPA hàng loạt, THE Bộ_điều_phối_RPA SHALL tạo một Tác_vụ_RPA riêng cho mỗi hồ sơ được chọn
2. WHEN thực thi hàng loạt với Thứ_tự_thực_thi là Tuần_tự, THE Bộ_điều_phối_RPA SHALL mở từng Hồ_sơ_trình_duyệt, thực thi Kịch_bản_RPA, và đóng hồ sơ trước khi chuyển sang hồ sơ tiếp theo
3. WHEN thực thi hàng loạt với Thứ_tự_thực_thi là Ngẫu_nhiên, THE Bộ_điều_phối_RPA SHALL chọn ngẫu nhiên hồ sơ tiếp theo từ danh sách chưa thực thi
4. IF một Tác_vụ_RPA trong đợt thực thi hàng loạt thất bại, THEN THE Bộ_điều_phối_RPA SHALL ghi nhận lỗi cho hồ sơ đó và tiếp tục thực thi các hồ sơ còn lại
5. WHEN thực thi hàng loạt hoàn tất, THE Bộ_điều_phối_RPA SHALL tạo báo cáo tổng hợp gồm số hồ sơ thành công, thất bại và danh sách lỗi chi tiết

### Yêu cầu 5: Lập lịch thực thi RPA

**User Story:** Là một người dùng, tôi muốn lập lịch chạy kịch bản RPA trên hồ sơ vào thời điểm cụ thể hoặc theo chu kỳ, để tự động hóa có thể chạy mà không cần can thiệp thủ công.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng chọn Loại_tác_vụ là Lập_lịch, THE Bộ_điều_phối_RPA SHALL hiển thị giao diện cấu hình Lịch_trình với các tùy chọn: thời gian bắt đầu, tần suất lặp lại và thời gian kết thúc
2. WHEN thời điểm trong Lịch_trình đến, THE Bộ_điều_phối_RPA SHALL tự động tạo Tác_vụ_RPA và thêm vào Hàng_đợi_tác_vụ của hồ sơ tương ứng
3. WHILE một Lịch_trình đang hoạt động, THE Bộ_điều_phối_RPA SHALL tiếp tục tạo tác vụ theo tần suất đã cấu hình cho đến khi đạt thời gian kết thúc hoặc Người_dùng hủy lịch
4. WHEN Người_dùng hủy một Lịch_trình, THE Bộ_điều_phối_RPA SHALL dừng tạo tác vụ mới nhưng cho phép tác vụ đang chạy hoàn thành
5. IF hệ thống khởi động lại trong khi có Lịch_trình đang hoạt động, THEN THE Bộ_điều_phối_RPA SHALL khôi phục tất cả Lịch_trình đã lưu và tiếp tục theo dõi thời gian thực thi
6. THE Bộ_điều_phối_RPA SHALL hỗ trợ các tần suất lặp lại: mỗi phút, mỗi giờ, hàng ngày, hàng tuần và biểu thức cron tùy chỉnh

### Yêu cầu 6: Theo dõi trạng thái thực thi RPA theo hồ sơ

**User Story:** Là một người dùng, tôi muốn theo dõi trạng thái thực thi RPA của từng hồ sơ theo thời gian thực, để tôi biết hồ sơ nào đang chạy, hoàn thành hay gặp lỗi.

#### Tiêu chí chấp nhận

1. WHILE một Tác_vụ_RPA đang thực thi, THE Bộ_điều_phối_RPA SHALL cập nhật Trạng_thái_tác_vụ theo thời gian thực bao gồm: số hành động đã hoàn thành, tổng số hành động và hành động hiện tại
2. THE Bộ_điều_phối_RPA SHALL hiển thị trạng thái RPA trên danh sách hồ sơ với các chỉ báo: đang chạy (running), chờ (pending), hoàn thành (completed), lỗi (failed)
3. WHEN một Tác_vụ_RPA hoàn thành, THE Bộ_điều_phối_RPA SHALL lưu kết quả thực thi bao gồm thời gian bắt đầu, thời gian kết thúc, số hành động thành công và danh sách lỗi
4. WHEN Người_dùng xem lịch sử RPA của một Hồ_sơ_trình_duyệt, THE Bộ_điều_phối_RPA SHALL hiển thị danh sách tất cả tác vụ đã thực thi trên hồ sơ đó với kết quả và thời gian
5. IF một Tác_vụ_RPA thất bại, THEN THE Bộ_điều_phối_RPA SHALL hiển thị thông báo lỗi chi tiết bao gồm hành động gây lỗi, thông điệp lỗi và ảnh chụp màn hình tại thời điểm lỗi

### Yêu cầu 7: Quản lý tác vụ RPA từ giao diện hồ sơ

**User Story:** Là một người dùng, tôi muốn quản lý tác vụ RPA trực tiếp từ giao diện danh sách hồ sơ, để tôi có thể nhanh chóng khởi chạy, dừng hoặc xem trạng thái RPA mà không cần chuyển sang màn hình khác.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng nhấn nút RPA trên một Hồ_sơ_trình_duyệt trong danh sách, THE Bộ_điều_phối_RPA SHALL mở dialog cấu hình RPA cho hồ sơ đó với các tùy chọn: chọn kịch bản, thứ tự thực thi, loại tác vụ và ưu tiên
2. WHEN Người_dùng nhấn nút dừng RPA trên một hồ sơ đang chạy tác vụ, THE Bộ_điều_phối_RPA SHALL dừng tác vụ hiện tại và hủy tất cả tác vụ pending trong hàng đợi của hồ sơ đó
3. THE Bộ_điều_phối_RPA SHALL hiển thị biểu tượng trạng thái RPA trên mỗi hồ sơ trong danh sách để phân biệt: không có tác vụ, đang chạy, có tác vụ chờ, hoàn thành gần đây, lỗi gần đây
4. WHEN Hồ_sơ_trình_duyệt đang ở trạng thái đóng và Người_dùng khởi chạy RPA, THE Bộ_điều_phối_RPA SHALL tự động mở hồ sơ trước khi bắt đầu thực thi kịch bản
5. WHEN Kịch_bản_RPA có cấu hình afterTaskAction là quitBrowser, THE Bộ_điều_phối_RPA SHALL tự động đóng Hồ_sơ_trình_duyệt sau khi tác vụ hoàn thành

### Yêu cầu 8: Lưu trữ và truy xuất cấu hình RPA theo hồ sơ

**User Story:** Là một người dùng, tôi muốn hệ thống lưu lại cấu hình RPA gần nhất cho mỗi hồ sơ, để tôi có thể nhanh chóng chạy lại kịch bản mà không cần cấu hình lại từ đầu.

#### Tiêu chí chấp nhận

1. WHEN Người_dùng hoàn tất cấu hình và khởi chạy Tác_vụ_RPA cho một hồ sơ, THE Bộ_điều_phối_RPA SHALL lưu cấu hình đó (kịch bản được chọn, thứ tự thực thi, loại tác vụ, ưu tiên) làm cấu hình gần nhất của hồ sơ
2. WHEN Người_dùng mở dialog RPA cho một hồ sơ đã có cấu hình gần nhất, THE Bộ_điều_phối_RPA SHALL tự động điền các giá trị từ cấu hình gần nhất vào form
3. THE Bộ_điều_phối_RPA SHALL lưu trữ cấu hình RPA trong cơ sở dữ liệu với liên kết đến Hồ_sơ_trình_duyệt tương ứng
4. WHEN Kịch_bản_RPA được liên kết trong cấu hình gần nhất bị xóa, THE Bộ_điều_phối_RPA SHALL hiển thị cảnh báo và yêu cầu Người_dùng chọn kịch bản mới
