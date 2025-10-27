# 빠른 시작: macOS 코드 서명

## 1단계: 인증서 확인

```bash
# 현재 설치된 서명 인증서 확인
security find-identity -v -p codesigning
```

**출력 예시:**
```
1) ABC1234567 "Developer ID Application: Your Name (TEAM123)"
```

괄호 안의 `TEAM123` (Team ID)를 메모하세요.

인증서가 없다면 → `docs/CODESIGNING.md`의 Phase 1 참고

## 2단계: Notarization 프로필 설정 (선택사항)

노터라이제이션을 하려면:

```bash
# App-Specific Password 생성: https://appleid.apple.com/account/manage
# 그 후 프로필 저장:

xcrun notarytool store-credentials "pluto-duck-notarize" \
  --apple-id "your.email@example.com" \
  --team-id "TEAM123" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

## 3단계: tauri.conf.json 업데이트

`tauri-shell/src-tauri/tauri.conf.json`에 추가:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM123)",
      "hardenedRuntime": true,
      "entitlements": "entitlements.plist"
    }
  }
}
```

**실제 값으로 교체:**
- `Your Name (TEAM123)` → 1단계에서 확인한 정확한 문자열

## 4단계: 빌드

### 서명만 (노터라이제이션 없음)

```bash
# 환경 변수로 서명 ID 전달
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM123)" ./scripts/build-signed.sh
```

### 서명 + 노터라이제이션 (완전한 배포)

```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM123)" \
NOTARIZE=true \
./scripts/build-signed.sh
```

**소요 시간:**
- 서명만: ~2분
- 서명 + 노터라이제이션: ~7-15분 (Apple 서버 대기 시간)

## 5단계: 검증

```bash
# 서명 확인
codesign -dv --verbose=4 "/path/to/Pluto Duck.app"

# 노터라이제이션 확인 (노터라이제이션한 경우)
spctl -a -vv "/path/to/Pluto Duck.app"
```

**성공 시 출력:**
```
source=Notarized Developer ID
accepted
```

## 빠른 체크리스트

빌드 전:
- [ ] `security find-identity -v -p codesigning` 실행하여 인증서 확인
- [ ] Team ID 복사
- [ ] `tauri.conf.json`에 서명 ID 추가
- [ ] (노터라이제이션 시) Notarization 프로필 설정 완료

빌드:
```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM123)" \
./scripts/build-signed.sh
```

검증:
```bash
codesign -dv --verbose=4 "./tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app"
```

## 문제 해결

### "no identity found" 오류
→ Apple Developer Portal에서 Developer ID Application 인증서 생성 필요
→ `docs/CODESIGNING.md` Phase 1 참고

### "손상된 앱" 오류 (서명했는데도)
→ 노터라이제이션 필요 또는 임시로:
```bash
xattr -cr "/path/to/Pluto Duck.app"
```

### 노터라이제이션 실패
```bash
# 상세 로그 확인
xcrun notarytool log SUBMISSION_ID --keychain-profile "pluto-duck-notarize"
```

일반적 원인:
- Entitlements 누락
- 서명되지 않은 바이너리 (backend의 .dylib 파일들)
- Hardened Runtime 미적용

