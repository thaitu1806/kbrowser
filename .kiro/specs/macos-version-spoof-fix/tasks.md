# Tasks - macOS Version Spoof Fix

## Tasks

- [x] 1. Fix `getOSToken()` cho macOS 11+
  - [x] 1.1 Trong `src/renderer/pages/NewProfileForm.tsx`, sửa case 'macos' của hàm `getOSToken()`: parse major version từ version string, nếu >= 11 trả về format `Macintosh; Intel Mac OS X {major}_1_0`, nếu <= 10 trả về `Macintosh; Intel Mac OS X 10_15_7`
- [x] 2. Fix `handleSave()` oscpu cho macOS
  - [x] 2.1 Trong `src/renderer/pages/NewProfileForm.tsx`, sửa logic oscpu trong `handleSave()`: thay hardcode `'Intel Mac OS X 10.15'` bằng logic động - nếu major >= 11 trả về `Intel Mac OS X {major}.1`, nếu <= 10 trả về `Intel Mac OS X 10.15`
- [x] 3. Viết tests
  - [x] 3.1 Tạo file test `src/renderer/pages/__tests__/getOSToken.test.ts` với unit tests cho `getOSToken()`: test macOS 26, 15, 11 (format mới), macOS 10 (legacy), Windows, Linux, Android, iOS (preservation)
  - [x] 3.2 Tạo file test `src/renderer/pages/__tests__/oscpu.test.ts` với unit tests cho oscpu logic: test macOS 26+Firefox (dynamic), macOS 10+Firefox (legacy), Windows+Firefox, Linux+Firefox (preservation)
  - [x] 3.3 [PBT-exploration] Property-based test: generate random macOS versions >= 11 và assert `getOSToken()` trên code CHƯA fix trả về sai format (chứa `10_`)
  - [x] 3.4 [PBT-fix] Property-based test: generate random macOS versions >= 11 và assert `getOSToken()` trên code ĐÃ fix trả về đúng format `{major}_1_0`
  - [x] 3.5 [PBT-preservation] Property-based test: generate random non-macOS-11+ inputs và assert output của `getOSToken()` không thay đổi sau fix
