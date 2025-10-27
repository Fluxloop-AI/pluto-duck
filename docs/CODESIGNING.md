# macOS 코드 서명 및 노터라이제이션 가이드

## 개요
Pluto Duck macOS 앱을 다른 Mac에서 실행 가능하도록 코드 서명 및 노터라이제이션하는 방법입니다.

## Phase 1: Apple Developer 계정 준비

### 1.1 Apple Developer Program 가입
1. https://developer.apple.com/programs/ 방문
2. "Enroll" 클릭
3. Apple ID로 로그인
4. $99/년 결제 및 동의서 작성
5. 승인 대기 (보통 24-48시간)

### 1.2 인증서 생성

#### A. Keychain Access에서 Certificate Signing Request (CSR) 생성
```bash
# 또는 GUI로:
# 1. Keychain Access 앱 실행
# 2. Keychain Access > Certificate Assistant > Request a Certificate from a Certificate Authority
# 3. 이메일 주소 입력
# 4. Common Name: "Pluto Duck Developer"
# 5. "Save to disk" 선택
# 6. CertificateSigningRequest.certSigningRequest 파일 저장
```

#### B. Developer Portal에서 인증서 다운로드
1. https://developer.apple.com/account/resources/certificates/list 방문
2. "+" 버튼 클릭
3. **"Developer ID Application"** 선택 (Mac 앱 배포용)
4. CSR 파일 업로드
5. 인증서 다운로드 (.cer 파일)
6. 다운로드한 .cer 파일 더블클릭 → Keychain에 자동 설치

#### C. 인증서 확인
```bash
# 설치된 인증서 확인
security find-identity -v -p codesigning

# 출력 예시:
# 1) ABC123... "Developer ID Application: Your Name (TEAM_ID)"
```

`TEAM_ID`를 메모해두세요 (괄호 안의 10자리 코드).

## Phase 2: 앱 서명 설정

### 2.1 Tauri 설정 업데이트

`tauri-shell/src-tauri/tauri.conf.json` 수정:

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "entitlements": "entitlements.plist"
    },
    "resources": [
      "../../dist/pluto-duck-backend"
    ],
    "icon": [
      "icons/icon.icns",
      "icons/icon.png",
      "icons/icon.ico"
    ]
  }
}
```

### 2.2 Entitlements 파일 생성

`tauri-shell/src-tauri/entitlements.plist` 생성:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

**주요 권한 설명:**
- `allow-jit`: Python JIT 컴파일 허용
- `network.client/server`: 백엔드 서버 실행 허용
- `files.user-selected.read-write`: 파일 업로드/다운로드 허용

## Phase 3: 노터라이제이션 설정

### 3.1 App-Specific Password 생성

1. https://appleid.apple.com/account/manage 방문
2. "Sign-In and Security" → "App-Specific Passwords" 클릭
3. "Generate an app-specific password" 클릭
4. 이름: "Pluto Duck Notarization"
5. 생성된 비밀번호 복사 (예: `abcd-efgh-ijkl-mnop`)

### 3.2 Keychain에 비밀번호 저장

```bash
# Apple ID와 App-Specific Password 저장
xcrun notarytool store-credentials "pluto-duck-notarize" \
  --apple-id "your.email@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "abcd-efgh-ijkl-mnop"

# 확인
xcrun notarytool history --keychain-profile "pluto-duck-notarize"
```

### 3.3 빌드 후 노터라이제이션 스크립트

`scripts/notarize.sh` 생성:

```bash
#!/bin/zsh
set -euo pipefail

APP_PATH="$1"
KEYCHAIN_PROFILE="pluto-duck-notarize"

echo "Notarizing $APP_PATH..."

# .app을 zip으로 압축
ZIP_PATH="${APP_PATH}.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

# 노터라이제이션 제출
xcrun notarytool submit "$ZIP_PATH" \
  --keychain-profile "$KEYCHAIN_PROFILE" \
  --wait

# 성공하면 스테이플링
xcrun stapler staple "$APP_PATH"

# 임시 zip 제거
rm "$ZIP_PATH"

echo "✓ Notarization complete!"
```

실행 권한 부여:
```bash
chmod +x scripts/notarize.sh
```

## Phase 4: 서명된 앱 빌드

### 4.1 빌드 스크립트 업데이트

`scripts/build.sh`에 서명 단계 추가:

```bash
# Step 3 뒤에 추가:

# Step 4: Notarize (optional)
if [ "${NOTARIZE:-false}" = "true" ]; then
  echo "Step 4/4: Notarizing app..."
  echo "-----------------------------------------"
  ./scripts/notarize.sh "$ROOT_DIR/tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app"
  echo "✓ Notarization complete"
  echo ""
fi
```

### 4.2 빌드 실행

```bash
# 서명만 (노터라이제이션 없음 - 빠름)
./scripts/build.sh

# 서명 + 노터라이제이션 (완전한 배포용 - 느림, 5-10분 소요)
NOTARIZE=true ./scripts/build.sh
```

## Phase 5: 검증

### 5.1 서명 확인

```bash
# 앱 서명 확인
codesign -dv --verbose=4 "/path/to/Pluto Duck.app"

# 실행 파일 서명 확인
codesign -dv --verbose=4 "/path/to/Pluto Duck.app/Contents/MacOS/app"

# 백엔드 서명 확인
codesign -dv --verbose=4 "/path/to/Pluto Duck.app/Contents/Resources/_up_/_up_/dist/pluto-duck-backend/pluto-duck-backend"
```

**기대 출력:**
```
Authority=Developer ID Application: Your Name (TEAM_ID)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
```

### 5.2 노터라이제이션 확인

```bash
# Staple 확인
stapler validate "/path/to/Pluto Duck.app"

# 또는
spctl -a -vv "/path/to/Pluto Duck.app"
```

**성공 시:**
```
/path/to/Pluto Duck.app: accepted
source=Notarized Developer ID
```

## 문제 해결

### "코드 서명에 실패했습니다"
```bash
# 인증서 확인
security find-identity -v -p codesigning

# Keychain Access에서 인증서가 "항상 신뢰"로 설정되어 있는지 확인
```

### "노터라이제이션이 실패했습니다"
```bash
# 상세 로그 확인
xcrun notarytool log SUBMISSION_ID --keychain-profile "pluto-duck-notarize"
```

일반적인 문제:
- **Hardened Runtime 누락**: `entitlements.plist` 확인
- **서명되지 않은 바이너리**: 백엔드 바이너리도 서명 필요
- **잘못된 권한**: entitlements 재검토

### 백엔드 바이너리도 서명하기

PyInstaller 빌드 후 서명:

`scripts/build-backend.sh`에 추가:

```bash
# 빌드 후 서명
if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  echo "Signing backend binary..."
  codesign --force --options runtime \
    --sign "$CODESIGN_IDENTITY" \
    --timestamp \
    dist/pluto-duck-backend/pluto-duck-backend
  
  # 모든 .dylib 파일도 서명
  find dist/pluto-duck-backend/_internal -name "*.dylib" -exec \
    codesign --force --options runtime --sign "$CODESIGN_IDENTITY" --timestamp {} \;
fi
```

실행:
```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)" ./scripts/build-backend.sh
```

## 자동화된 빌드 스크립트

`scripts/build-signed.sh` 생성:

```bash
#!/bin/zsh
set -euo pipefail

# 환경 변수 확인
: ${CODESIGN_IDENTITY:?"CODESIGN_IDENTITY must be set"}
: ${NOTARIZE_PROFILE:="pluto-duck-notarize"}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Building signed Pluto Duck app..."
echo "Code signing identity: $CODESIGN_IDENTITY"
echo ""

# 백엔드 빌드 및 서명
CODESIGN_IDENTITY="$CODESIGN_IDENTITY" ./scripts/build-backend.sh

# 프론트엔드 빌드
cd "$ROOT_DIR/frontend/pluto_duck_frontend"
pnpm install
pnpm build

# Tauri 빌드 (자동 서명)
cd "$ROOT_DIR/tauri-shell"
cargo tauri build

# 노터라이제이션
APP_PATH="$ROOT_DIR/tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app"
echo ""
echo "Notarizing app..."
./scripts/notarize.sh "$APP_PATH"

echo ""
echo "✅ Signed and notarized app ready!"
echo "Location: $APP_PATH"
```

실행:
```bash
chmod +x scripts/build-signed.sh
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)" ./scripts/build-signed.sh
```

## 빠른 시작 체크리스트

- [ ] Apple Developer Program 가입 완료
- [ ] Developer ID Application 인증서 생성 및 설치
- [ ] TEAM_ID 확인 (`security find-identity -v -p codesigning`)
- [ ] App-Specific Password 생성
- [ ] Notarization 프로필 설정 (`xcrun notarytool store-credentials`)
- [ ] `entitlements.plist` 생성
- [ ] `tauri.conf.json` 업데이트
- [ ] `scripts/notarize.sh` 생성 및 실행 권한 부여
- [ ] 서명된 빌드 실행 및 검증
- [ ] 다른 Mac에서 설치 테스트

## 참고 자료

- [Apple 코드 서명 가이드](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Tauri 코드 서명 문서](https://tauri.app/v1/guides/distribution/sign-macos)
- [xcrun notarytool 문서](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/customizing_the_notarization_workflow)




좋은 아이디어입니다! 스크립트에 기본값을 추가하되, 필요시 오버라이드 가능하게 하겠습니다:

[1 tool called]

완벽합니다! 이제 간단하게 사용할 수 있습니다:

```bash
# 기본 서명 ID로 빌드 (매우 간단!)
./scripts/build-signed.sh

# 노터라이제이션까지
NOTARIZE=true ./scripts/build-signed.sh

# 다른 인증서 사용하려면 (선택사항)
CODESIGN_IDENTITY="Other Identity" ./scripts/build-signed.sh
```

**요약:**

✅ **Phase 5 완료!**
- 로컬 빌드: `./scripts/build.sh`
- 서명 빌드: `./scripts/build-signed.sh`
- 노터라이제이션: `NOTARIZE=true ./scripts/build-signed.sh`

**배포 파일:**
- `.app`: `/Users/user/Documents/pluto_duck_oss/tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app`
- `.dmg`: `/Users/user/Documents/pluto_duck_oss/tauri-shell/src-tauri/target/release/bundle/dmg/Pluto Duck_0.1.0_aarch64.dmg`

**기능:**
- ✅ 백엔드 + 프론트엔드 통합
- ✅ 자동 시작/종료
- ✅ macOS 표준 동작 (창 숨기기/재활성화)
- ✅ 코드 서명

노터라이제이션 완료 확인은:
```bash
xcrun notarytool info 88da2af6-8498-480f-b2f2-ff4e02c7fff6 --keychain-profile "pluto-duck-notarize"
```