# Bugfix Requirements Document

## Introduction

Khi người dùng chọn phiên bản macOS 11 trở lên (ví dụ: "macOS 26") trong form tạo profile, fingerprint check hiển thị sai phiên bản OS. Cụ thể, chọn "macOS 26" nhưng platform bị phát hiện là "Mac OS 11" thay vì "Mac OS 26.1.0". Nguyên nhân do hai lỗi trong `src/renderer/pages/NewProfileForm.tsx`:

1. Hàm `getOSToken()` luôn tạo format `10_XX_7` cho mọi phiên bản macOS, trong khi từ macOS 11 trở đi Apple sử dụng format `{major}_{minor}_{patch}` trực tiếp.
2. Hàm `handleSave()` hardcode giá trị oscpu là `'Intel Mac OS X 10.15'` bất kể phiên bản macOS được chọn.

Lỗi này khiến fingerprint bị phát hiện không nhất quán (95% authenticity thay vì 100%) khi so sánh với các trình duyệt anti-detect khác như AdsPower.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN người dùng chọn macOS phiên bản 11 trở lên (ví dụ: "macOS 26") THEN hàm `getOSToken()` tạo OS token sai format `Macintosh; Intel Mac OS X 10_26_7` thay vì `Macintosh; Intel Mac OS X 26_1_0`

1.2 WHEN người dùng chọn macOS bất kỳ phiên bản nào và browser là Firefox THEN hàm `handleSave()` luôn gán oscpu là `'Intel Mac OS X 10.15'` bất kể phiên bản macOS được chọn

1.3 WHEN User-Agent chứa OS token sai format (ví dụ: `10_26_7`) THEN fingerprint check site phát hiện sự không nhất quán giữa User-Agent và platform thực tế, dẫn đến giảm điểm authenticity

### Expected Behavior (Correct)

2.1 WHEN người dùng chọn macOS phiên bản 11 trở lên (ví dụ: "macOS 26") THEN hàm `getOSToken()` SHALL tạo OS token đúng format `Macintosh; Intel Mac OS X {major}_{minor}_{patch}` (ví dụ: `Macintosh; Intel Mac OS X 26_1_0` cho macOS 26)

2.2 WHEN người dùng chọn macOS bất kỳ phiên bản nào và browser là Firefox THEN hàm `handleSave()` SHALL gán oscpu phản ánh đúng phiên bản macOS được chọn theo format `Intel Mac OS X {major}.{minor}` (ví dụ: `Intel Mac OS X 26.1` cho macOS 26)

2.3 WHEN User-Agent chứa OS token đúng format THEN fingerprint check site SHALL phát hiện platform nhất quán với User-Agent, đạt 100% authenticity cho mục OS version

### Unchanged Behavior (Regression Prevention)

3.1 WHEN người dùng chọn macOS 10 (Catalina hoặc cũ hơn) THEN hàm `getOSToken()` SHALL CONTINUE TO tạo OS token format legacy `Macintosh; Intel Mac OS X 10_15_7`

3.2 WHEN người dùng chọn Windows bất kỳ phiên bản THEN hàm `getOSToken()` SHALL CONTINUE TO tạo OS token đúng format Windows (ví dụ: `Windows NT 10.0; Win64; x64`)

3.3 WHEN người dùng chọn Linux THEN hàm `getOSToken()` SHALL CONTINUE TO tạo OS token `X11; Linux x86_64`

3.4 WHEN người dùng chọn Android bất kỳ phiên bản THEN hàm `getOSToken()` SHALL CONTINUE TO tạo OS token đúng format Android

3.5 WHEN người dùng chọn iOS bất kỳ phiên bản THEN hàm `getOSToken()` SHALL CONTINUE TO tạo OS token đúng format iOS

3.6 WHEN người dùng chọn Windows và browser là Firefox THEN hàm `handleSave()` SHALL CONTINUE TO gán oscpu là `'Windows NT 10.0; Win64; x64'`

3.7 WHEN người dùng chọn Linux và browser là Firefox THEN hàm `handleSave()` SHALL CONTINUE TO gán oscpu là `'Linux x86_64'`

---

### Bug Condition (Formal)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ProfileFormInput (os: OSType, osVersion: string, browser: BrowserType)
  OUTPUT: boolean
  
  // Bug triggers when macOS version is 11 or higher
  major ← extractMajorVersion(X.osVersion)  // e.g., "macOS 26" → 26
  RETURN X.os = 'macos' AND major >= 11
END FUNCTION
```

```pascal
// Property: Fix Checking - OS Token Format
FOR ALL X WHERE isBugCondition(X) DO
  major ← extractMajorVersion(X.osVersion)
  osToken ← getOSToken'(X.os, X.osVersion)
  ASSERT osToken = "Macintosh; Intel Mac OS X " + major + "_1_0"
END FOR
```

```pascal
// Property: Fix Checking - oscpu Value (Firefox only)
FOR ALL X WHERE isBugCondition(X) AND X.browser = 'firefox' DO
  major ← extractMajorVersion(X.osVersion)
  oscpu ← getOscpu'(X)
  ASSERT oscpu = "Intel Mac OS X " + major + ".1"
END FOR
```

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT getOSToken(X.os, X.osVersion) = getOSToken'(X.os, X.osVersion)
  ASSERT getOscpu(X) = getOscpu'(X)
END FOR
```
