# STEP 6 공모전 심사 환경(Replit 배포) 릴리스·롤백 절차

2026-10-26 오후 수정: 심사 환경은 **Replit App 공개 Deployment**(2026년 11월 요금제 갱신 후 공개)입니다. 국내 VPS는 실제 학교 시범운영 전용이며 절차는 `docs/step7/step7-vps-operations.md`에 있습니다.
원칙: Replit에서 전체 테스트를 통과한 커밋만 배포합니다. 자동 배포·DB 초기화·강제 push는 하지 않습니다.

## 1. 릴리스 커밋 정하기(GitHub ↔ Replit)
GitHub 개발 커밋과 Replit 검증 커밋은 cherry-pick 때문에 해시가 다릅니다. **내용**으로 비교합니다.
```bash
git fetch origin
git status --short                                       # 커밋 안 된 변경이 없어야 함
bash scripts/release-compare.sh <GitHub 커밋> <Replit 커밋>   # [같음]이어야 함(문서·.replit 차이는 무관)
npm run typecheck && npm test                            # 전체 통과
```
- 다르면 차이 파일을 확인해 사용자 승인 후 맞춥니다(reset·강제 push 금지).
- 승인한 Replit 커밋에 태그: `git tag -a judge-v1 -m "심사 시연 1차" && git push origin judge-v1`(새 태그만, 기존 브랜치 덮어쓰기 없음)

## 2. 배포(11월, 승인 후)
| 순서 | 할 일 | 확인 |
| --- | --- | --- |
| 1 | 배포 Secrets 설정(`step6-environment-isolation.md` 4절 2번). 개발 Secrets와 다른 SESSION_SECRET | Secrets 화면(값을 캡처·공유하지 않음) |
| 2 | 첫 배포 1회만: 배포 DB에 심사 스키마 생성(`DEPLOY_ALLOW_NEW_SCHEMA=true npm run deploy:migrate`, 그 뒤 플래그 제거) | `npm run deploy:check` → 학교 0, 사용자 0 |
| 3 | 심사 데이터: `npm run judge:setup`(계획만) → 승인 → `JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --apply --out <파일> --sample-drill` | 학교 2, 계정 8, 비밀번호 파일 600 |
| 4 | Replit 배포 실행(`npm run build` → `npm run deploy:start`) | 배포 주소 `/api/health` |
| 5 | 8개 계정 로그인·권한 확인(`step6-judge-guide.md`), 다른 학교 404, 모의 경보 표시 | 결과 기록(devlog) |

## 3. 롤백
- 코드: Replit 배포 기록에서 이전 배포로 되돌리거나, 이전 태그 커밋으로 다시 배포합니다.
- 심사 데이터 정리: `npm run judge:setup -- --reset-active`(진행 중 상황만 종료, 삭제 없음). 스키마 DROP·`migrate reset`은 쓰지 않습니다.
- 기존 Replit 개발 DB의 `public`·`safeschool_test`·`safeschool_browser_demo`는 배포·롤백에서 건드리지 않습니다.
