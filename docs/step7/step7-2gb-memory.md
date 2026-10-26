# 2GB 서버(iwinv vgna_2_n) 메모리 검토 — 앱 1개 + PostgreSQL 16

작성 2026-10-26 · **아래 수치는 일반적인 범위의 예상입니다. 이 작업공간에서는 의존성 설치가 막혀 앱·빌드 메모리를 실측하지 못했습니다.** 서버 구축 후 4절 방법으로 실측해 고칩니다.

## 1. 결론
- **운영(앱 1개 + DB + Caddy)은 2GB로 가능합니다.** 평상시 예상 사용량은 약 0.9~1.2GB입니다.
- **위험은 빌드 순간입니다.** `npm ci` + `vite build`가 순간적으로 0.7~1.2GB를 더 쓸 수 있어, 스왑 없이 빌드하면 리눅스가 메모리 부족으로 PostgreSQL이나 앱을 강제 종료(OOM)할 수 있습니다.
- 대응: 스왑 2GB + 서비스별 메모리 상한 + 빌드를 상한이 있는 별도 범위에서 실행. 시범운영 사용자가 늘거나 스왑을 평소에도 쓰면 4GB로 올립니다.

## 2. 예상 사용량과 설정
| 구성 | 예상 | 설정(파일) |
| --- | --- | --- |
| Ubuntu·SSH·journald·cron | 250~350MB | journald 300MB·30일(`deploy/system/journald-safe-school.conf`) |
| Caddy | 30~60MB | — |
| PostgreSQL 16 | 350~500MB | `shared_buffers=256MB`, `max_connections=30`, `work_mem=4MB`(`deploy/postgres/90-safeschool.conf`) |
| 앱(Node.js + Prisma 엔진) | 150~300MB | V8 힙 상한 320MB, systemd `MemoryHigh=450M`·`MemoryMax=600M`, DB 연결 5개(`connection_limit=5`) |
| 시작 전 점검(ExecStartPre) | 순간 80~120MB | 점검 후 종료(기존 `deploy:start`처럼 부모 프로세스가 남지 않음) |
| 합계(평상시) | **약 0.8~1.2GB** | 남는 메모리는 파일 캐시(DB 읽기 속도) |
| 빌드(`npm ci` + `npm run build`) | 순간 +0.7~1.2GB | 스왑 2GB, `systemd-run --scope -p MemoryMax=1200M`, `nice`(`step7-vps-operations.md` 1-1) |

- 앱이 메모리 상한을 넘으면 **앱만** 재시작됩니다(systemd `Restart=on-failure`). DB·Caddy는 영향 없습니다.
- 기존 서버 시작 방식(`deploy:start`)은 부모 프로세스가 Prisma를 불러온 채 남아 메모리를 더 썼고, 재시작할 때마다 마이그레이션을 자동 적용했습니다. 시범운영 서버는 `--check` 후 서버만 실행하도록 바꿨습니다.

## 3. 빌드 방식 대안
| 방식 | 내용 | 장점 | 단점 |
| --- | --- | --- | --- |
| **A. 서버에서 빌드(기본)** | 서비스는 계속 실행, 빌드만 메모리 상한 범위에서 | 절차 단순, 도구 추가 없음 | 빌드 중 1~3분 스왑 사용으로 응답이 느려질 수 있음 → 수업·업무 시간 외(저녁)에 배포 |
| B. Replit 빌드 결과 전송 | Replit에서 테스트 통과 후 `npm run build` → `dist/`를 압축해 내려받아 서버로 `scp`, 서버는 `npm ci`만 | 검증한 바로 그 결과물, 서버 메모리 부담 작음 | 사람이 파일을 옮기는 단계 추가, 서버에도 같은 버전 의존성 필요(lock 파일 필수) |
| C. 4GB로 변경 | iwinv 상위 사양 | 여유 확보, 절차 단순 | 비용 증가 |
| (참고) GitHub Actions 빌드 | 저장소에서 자동 빌드 후 내려받기 | 자동화 | 새 외부 서비스 설정 — 이번 범위 밖, 별도 승인 필요 |
- 권장: **A로 시작하고, 첫 배포에서 빌드 최대 메모리를 측정**합니다. 빌드가 상한에 걸려 실패하거나 평상시 스왑 사용이 200MB를 넘으면 C(4GB)를 검토합니다.

## 4. 실측 방법(서버 구축 후)
```bash
free -m                                                    # 사용·사용 가능·스왑
systemctl show safe-school -p MemoryCurrent -p MemoryPeak  # 앱 현재·최대(바이트)
ps -o rss,cmd -C postgres | awk '{s+=$1} END {print s/1024 " MB(공유 메모리 중복 포함)"}'
/usr/bin/time -v npm run build 2>&1 | grep "Maximum resident"   # 빌드 최대 메모리
```
- 시범운영 첫 주에는 하루 2번(오전·오후) 위 값을 기록하고(`docs/devlog`), 2주 뒤 설정값(힙 상한·shared_buffers)을 조정합니다.

## 5. 메모리 부족 신호와 대응
| 신호 | 확인 | 대응 |
| --- | --- | --- |
| 앱이 반복 재시작 | `journalctl -u safe-school | grep -i "memory\|heap"` | 힙 상한·MemoryMax를 50~100MB 올리고 원인(큰 요청·누수) 확인 |
| 커널 OOM 기록 | `journalctl -k | grep -i oom` | 어떤 프로세스가 종료됐는지 확인. 빌드 중이었다면 방식 B·C 검토 |
| 스왑이 평소에도 증가 | `free -m` | 4GB 변경 검토 |
| 디스크 부족 | `df -h /` | 오래된 릴리스 폴더·백업 정리(보관 기간 규칙 안에서) |
