# Gmail SMTP 설정과 실제 수신 확인(사용자 수행)

앱 비밀번호를 채팅·메일·Git·문서에 적지 않습니다. 실제 교직원 주소로 시험하지 않습니다.

## 1. 앱 비밀번호 만들기
1. 발신 전용 Gmail 계정에 2단계 인증을 켭니다.
2. Google 계정 → 보안 → 앱 비밀번호에서 새 비밀번호를 만듭니다.

## 2. 학교 PC에서 1통 보내기
이 PowerShell 창에만 값을 넣고, 창을 닫으면 사라집니다.
```powershell
cd C:\Users\user\Projects\safe-school-beta2
$env:MAIL_PROVIDER = "gmail"
$env:GMAIL_SMTP_USER = "발신계정@gmail.com"
$p = Read-Host "앱 비밀번호" -AsSecureString
$env:GMAIL_SMTP_APP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))
npm run mail:test -- 본인시험주소@example.com
Remove-Item Env:MAIL_PROVIDER, Env:GMAIL_SMTP_USER, Env:GMAIL_SMTP_APP_PASSWORD
```
**"접수했습니다"는 수신 성공이 아닙니다.** 받은 편지함과 스팸함에서 실제로 메일을 확인해야 완료입니다.

## 3. 결과 해석
| 출력 | 원인 |
|---|---|
| `mail_failed`, 서버 로그 `auth 535` | 앱 비밀번호 오류, 2단계 인증 꺼짐 |
| `connect`, `timeout` | 학교망이 465 포트를 막았을 수 있음 |
| 실제 발송 설정이 없습니다 | 환경변수 누락 |

## 4. 배포 시
- `beta.env`에 넣고 권한 640을 유지합니다. 가상 데이터 모드에서는 `gmail`이면 시작을 거부합니다.
- VPS에서 465 포트가 열려 있는지 별도로 확인해야 합니다.

## 5. 운영 전 결정 사항
- Gmail은 국외 사업자이므로 이메일 주소의 국외 처리 고지 여부를 학교 개인정보 담당자와 정해야 합니다.
- 개인 Gmail 계정의 하루 발송 한도와 계정 정지 위험은 Google 정책을 확인해야 합니다. 한도를 넘으면 가입이 502로 실패합니다.
- 발송 실패 시 대체 절차: `MAIL_PROVIDER=manual`로 바꾸고 `npm run operator -- email-code <주소>`로 전달합니다.
