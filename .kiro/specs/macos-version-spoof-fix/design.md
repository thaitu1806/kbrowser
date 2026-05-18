# macOS Version Spoof Fix - Bugfix Design

## Overview

Hàm `getOSToken()` và `handleSave()` trong `src/renderer/pages/NewProfileForm.tsx` tạo sai format OS token và oscpu cho macOS 11+. Từ macOS 11 (Big Sur), Apple chuyển sang versioning scheme mới (`{major}.{minor}.{patch}`) nhưng code hiện tại vẫn dùng format legacy `10_XX_7`. Fix sẽ phân biệt macOS 10 (legacy) và macOS 11+ (modern) để tạo đúng format, đồng thời sinh oscpu động thay vì hardcode `10.15`.

## Glossary

- **Bug_Condition (C)**: Điều kiện kích hoạt bug - khi người dùng chọn macOS phiên bản 11 trở lên
- **Property (P)**: Hành vi mong muốn - OS token format `{major}_{minor}_{patch}` và oscpu phản ánh đúng phiên bản
- **Preservation**: Hành vi không thay đổi - format legacy cho macOS 10, format Windows/Linux/Android/iOS
- **getOSToken()**: Hàm trong `src/renderer/pages/NewProfileForm.tsx` chuyển đổi OS + version thành OS token cho User-Agent string
- **handleSave()**: Hàm trong `src/renderer/pages/NewProfileForm.tsx` tạo profile config bao gồm fingerprint với oscpu
- **oscpu**: Property trong FingerprintConfig dùng cho Firefox fingerprint, biểu thị OS/CPU info

## Bug Details

### Bug Condition

Bug xảy ra khi người dùng chọn macOS phiên bản 11 trở lên. Hàm `getOSToken()` luôn extract số version và đặt vào format `10_XX_7`, dẫn đến output sai như `10_26_7` thay vì `26_1_0`. Đồng thời `handleSave()` hardcode oscpu là `'Intel Mac OS X 10.15'` cho mọi phiên bản macOS.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { os: OSType, osVersion: string, browser: BrowserType }
  OUTPUT: boolean
  
  major ← extractNumber(input.osVersion)  // "macOS 26" → 26
  RETURN input.os = 'macos' AND major >= 11
END FUNCTION
```

### Examples

- Chọn "macOS 26": `getOSToken()` trả về `Macintosh; Intel Mac OS X 10_26_7` (sai) → mong đợi `Macintosh; Intel Mac OS X 26_1_0`
- Chọn "macOS 15": `getOSToken()` trả về `Macintosh; Intel Mac OS X 10_15_7` (sai) → mong đợi `Macintosh; Intel Mac OS X 15_1_0`
- Chọn "macOS 11": `getOSToken()` trả về `Macintosh; Intel Mac OS X 10_11_7` (sai) → mong đợi `Macintosh; Intel Mac OS X 11_1_0`
- Chọn "macOS 10": `getOSToken()` trả về `Macintosh; Intel Mac OS X 10_10_7` → mong đợi `Macintosh; Intel Mac OS X 10_15_7` (legacy format, giữ nguyên logic cũ)
- Chọn "macOS 26" + Firefox: oscpu là `'Intel Mac OS X 10.15'` (sai) → mong đợi `'Intel Mac OS X 26.1'`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- macOS 10 (legacy): `getOSToken()` tiếp tục trả về format `Macintosh; Intel Mac OS X 10_15_7`
- Windows: `getOSToken()` tiếp tục trả về đúng format Windows NT (ví dụ: `Windows NT 10.0; Win64; x64`)
- Linux: `getOSToken()` tiếp tục trả về `X11; Linux x86_64`
- Android: `getOSToken()` tiếp tục trả về format `Linux; Android {ver}; Pixel 8`
- iOS: `getOSToken()` tiếp tục trả về format `iPhone; CPU iPhone OS {ver}_0 like Mac OS X`
- Windows + Firefox: oscpu tiếp tục là `'Windows NT 10.0; Win64; x64'`
- Linux + Firefox: oscpu tiếp tục là `'Linux x86_64'`

**Scope:**
Tất cả input không liên quan đến macOS 11+ sẽ hoàn toàn không bị ảnh hưởng bởi fix này. Bao gồm:
- Mọi phiên bản Windows
- Linux
- Android mọi phiên bản
- iOS mọi phiên bản
- macOS 10 (Catalina trở về trước)

## Hypothesized Root Cause

Based on code analysis, the root causes are confirmed:

1. **getOSToken() - Sai format cho macOS 11+**: Dòng `return \`Macintosh; Intel Mac OS X 10_${ver}_7\`` luôn đặt version number vào vị trí minor version của macOS 10.x format. Với macOS 26, output là `10_26_7` thay vì `26_1_0`. Code thiếu logic phân biệt macOS 10 (legacy) vs macOS 11+ (modern versioning).

2. **handleSave() - Hardcode oscpu**: Dòng `form.os === 'macos' ? 'Intel Mac OS X 10.15'` không sử dụng version đã chọn. Cần sinh oscpu động dựa trên `form.osVersion` tương tự logic trong `getOSToken()`.

3. **Thiếu awareness về Apple versioning change**: Từ macOS 11 Big Sur (2020), Apple chuyển từ `10.x.y` sang `{major}.{minor}.{patch}`. Code được viết với assumption rằng mọi macOS đều là `10.x`.

## Correctness Properties

Property 1: Bug Condition - OS Token Format cho macOS 11+

_For any_ input where os = 'macos' và major version >= 11, hàm `getOSToken()` đã fix SHALL trả về format `Macintosh; Intel Mac OS X {major}_1_0` (ví dụ: `Macintosh; Intel Mac OS X 26_1_0` cho macOS 26).

**Validates: Requirements 2.1**

Property 2: Bug Condition - oscpu Value cho macOS 11+ (Firefox)

_For any_ input where os = 'macos', major version >= 11, và browser = 'firefox', hàm `handleSave()` đã fix SHALL gán oscpu = `Intel Mac OS X {major}.1` (ví dụ: `Intel Mac OS X 26.1` cho macOS 26).

**Validates: Requirements 2.2**

Property 3: Preservation - Non-macOS11+ Behavior

_For any_ input where bug condition does NOT hold (os khác 'macos' HOẶC macOS version < 11), hàm `getOSToken()` và logic oscpu đã fix SHALL produce cùng kết quả như code gốc, preserving format legacy cho macOS 10 và format đúng cho Windows/Linux/Android/iOS.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

**File**: `src/renderer/pages/NewProfileForm.tsx`

**Function 1**: `getOSToken()` - case 'macos'

**Specific Changes**:
1. **Extract major version**: Parse số từ version string (ví dụ: "macOS 26" → 26, "macOS 10" → 10)
2. **Thêm điều kiện phân biệt**: Nếu major >= 11, dùng format mới `Macintosh; Intel Mac OS X {major}_1_0`
3. **Giữ legacy format**: Nếu major <= 10, tiếp tục dùng `Macintosh; Intel Mac OS X 10_15_7`

**Code thay đổi (getOSToken - case 'macos')**:
```typescript
case 'macos': {
  const ver = parseInt(version.match(/\d+/)?.[0] ?? '15', 10);
  if (ver >= 11) {
    return `Macintosh; Intel Mac OS X ${ver}_1_0`;
  }
  return 'Macintosh; Intel Mac OS X 10_15_7';
}
```

**Function 2**: `handleSave()` - oscpu assignment

**Specific Changes**:
4. **Sinh oscpu động cho macOS**: Thay hardcode `'Intel Mac OS X 10.15'` bằng logic dựa trên `form.osVersion`
5. **Phân biệt macOS 10 vs 11+**: macOS 10 → `'Intel Mac OS X 10.15'`, macOS 11+ → `'Intel Mac OS X {major}.1'`

**Code thay đổi (handleSave - oscpu)**:
```typescript
oscpu: form.browser === 'firefox' ? (
  form.os === 'windows' ? 'Windows NT 10.0; Win64; x64' :
  form.os === 'macos' ? (() => {
    const ver = parseInt(form.osVersion.match(/\d+/)?.[0] ?? '15', 10);
    return ver >= 11 ? `Intel Mac OS X ${ver}.1` : 'Intel Mac OS X 10.15';
  })() :
  'Linux x86_64'
) : '',
```

## Testing Strategy

### Validation Approach

Testing strategy gồm hai phase: (1) chạy test trên code chưa fix để xác nhận bug tồn tại, (2) chạy test trên code đã fix để verify fix đúng và không gây regression.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples chứng minh bug tồn tại trên code chưa fix. Xác nhận root cause analysis.

**Test Plan**: Viết unit tests gọi `getOSToken('macos', 'macOS 26')` và kiểm tra output. Chạy trên code chưa fix để thấy failure.

**Test Cases**:
1. **macOS 26 Token Test**: `getOSToken('macos', 'macOS 26')` → expect `Macintosh; Intel Mac OS X 26_1_0` (will fail on unfixed code, returns `10_26_7`)
2. **macOS 15 Token Test**: `getOSToken('macos', 'macOS 15')` → expect `Macintosh; Intel Mac OS X 15_1_0` (will fail on unfixed code, returns `10_15_7`)
3. **macOS 11 Token Test**: `getOSToken('macos', 'macOS 11')` → expect `Macintosh; Intel Mac OS X 11_1_0` (will fail on unfixed code, returns `10_11_7`)
4. **oscpu macOS 26 + Firefox**: expect `Intel Mac OS X 26.1` (will fail, returns `Intel Mac OS X 10.15`)

**Expected Counterexamples**:
- `getOSToken('macos', 'macOS 26')` returns `Macintosh; Intel Mac OS X 10_26_7` instead of `26_1_0`
- oscpu always returns `Intel Mac OS X 10.15` regardless of version selected

### Fix Checking

**Goal**: Verify rằng với mọi input thỏa bug condition, hàm đã fix tạo đúng output.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  osToken := getOSToken_fixed(input.os, input.osVersion)
  major := extractNumber(input.osVersion)
  ASSERT osToken = "Macintosh; Intel Mac OS X " + major + "_1_0"
  
  IF input.browser = 'firefox' THEN
    oscpu := getOscpu_fixed(input)
    ASSERT oscpu = "Intel Mac OS X " + major + ".1"
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify rằng với mọi input KHÔNG thỏa bug condition, hàm đã fix cho cùng kết quả như hàm gốc.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT getOSToken_original(input.os, input.osVersion) = getOSToken_fixed(input.os, input.osVersion)
  ASSERT getOscpu_original(input) = getOscpu_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing phù hợp cho preservation checking vì:
- Tự động generate nhiều test cases across toàn bộ input domain (Windows, Linux, Android, iOS, macOS 10)
- Bắt edge cases mà manual unit tests có thể miss
- Đảm bảo mạnh rằng behavior không thay đổi cho mọi non-buggy inputs

**Test Plan**: Observe behavior trên code chưa fix cho non-macOS-11+ inputs, sau đó viết property-based tests capturing behavior đó.

**Test Cases**:
1. **Windows Preservation**: Verify `getOSToken('windows', ...)` cho cùng output trước và sau fix
2. **Linux Preservation**: Verify `getOSToken('linux', ...)` cho cùng output
3. **Android Preservation**: Verify `getOSToken('android', ...)` cho cùng output
4. **iOS Preservation**: Verify `getOSToken('ios', ...)` cho cùng output
5. **macOS 10 Preservation**: Verify `getOSToken('macos', 'macOS 10')` giữ format legacy
6. **oscpu Windows/Linux Preservation**: Verify oscpu cho Windows và Linux không đổi

### Unit Tests

- Test `getOSToken()` cho mỗi macOS version (10, 11, 12, 13, 14, 15, 26)
- Test `getOSToken()` cho "All macOS" (default behavior)
- Test oscpu generation cho macOS 11+ với Firefox
- Test oscpu generation cho macOS 10 với Firefox
- Test edge case: version string không parse được (fallback behavior)

### Property-Based Tests

- Generate random macOS versions >= 11 và verify OS token format `{major}_1_0`
- Generate random macOS versions >= 11 với Firefox và verify oscpu format `Intel Mac OS X {major}.1`
- Generate random non-macOS OS inputs và verify output không thay đổi so với original function
- Generate random macOS 10 inputs và verify legacy format preserved

### Integration Tests

- Test full profile creation flow với macOS 26 và verify User-Agent string chứa đúng OS token
- Test full profile creation flow với macOS 10 và verify legacy format preserved
- Test fingerprint consistency: User-Agent OS token phải match với oscpu value
