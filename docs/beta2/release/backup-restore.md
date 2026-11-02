# Beta PILOT 2 — 백업·복구 검증 절차(초안)

작성 2026-11-02 · 상태: **실제 DB·VPS에서 실행하지 않았습니다.** `deploy/scripts/beta-backup.sh`는 가짜 `pg_dump`·`pg_restore`와 임시 폴더로 흐름과 거부 조건만 시험했습니다. 실제 덤프·복원은 미검증입니다.

## 1. 백업

| 항목 | 내용 |
|---|---|
| 도구 | `deploy/scripts/beta-backup.sh` (계정 `ss-beta`) |
| 대상 | 스키마 `safeschool_beta`, 사진 폴더 `/var/lib/safe-school-beta/uploads` |
| 결과 | `.dump`, `_photos_.tar.gz`, `.sha256` (권한 600) |
| 위치 | `/var/backups/safe-school-beta` (같은 서버) |
| 보관 | 14일 후 백업 파일 삭제 |
| 순서 | DB를 먼저 덤프한 뒤 사진을 묶습니다 |

한계
- 서버 장애에 대비한 **서버 밖 사본이 없습니다.** 필요하면 암호화 후 옮기는 절차를 따로 정해야 합니다.
- 백업 파일은 암호화되어 있지 않습니다.
- 덤프와 사진 묶음 사이에 올라온 사진은 복구 후 DB에 없는 파일로 남을 수 있습니다.
- 그 사이 삭제된 사진은 DB에 삭제 표시 전 상태로 남고 파일이 없을 수 있습니다. 복구 후 5절로 점검합니다.
- 삭제한 사진과 개인정보도 보관 기간 동안 백업에 남습니다.

## 2. 마이그레이션 전 백업

1. `npm run deploy:check`로 대상과 건수를 기록합니다.
2. `beta-backup.sh`를 실행합니다.
3. 파일 크기, `sha256sum -c`, 완료 줄의 사진 개수를 확인합니다.
4. **승인을 받은 뒤** `npm run deploy:migrate`를 실행합니다.

## 3. DB 복구 검증

기존 DB를 덮어쓰거나 DROP하지 않습니다. 항상 새 DB에 복원해 비교합니다.

```bash
sudo -u postgres createdb safeschool_beta_restore_<날짜>
sudo -u postgres pg_restore --no-owner -d safeschool_beta_restore_<날짜> <덤프>
sudo -u postgres psql -d safeschool_beta_restore_<날짜> -XAtc "select count(*) from safeschool_beta.schools; select count(*) from safeschool_beta.users; select count(*) from safeschool_beta._prisma_migrations where finished_at is not null;"
```

원본과 건수를 비교합니다. 건수만 기록하고 이름·이메일은 기록하지 않습니다.

## 4. 사진 복구 검증

사용 중인 폴더에 바로 풀지 않습니다.

```bash
mkdir -m 700 /var/backups/safe-school-beta/restore-check
tar -xzf <사진 묶음> -C /var/backups/safe-school-beta/restore-check
```

파일 수와 DB의 미삭제 첨부 수를 비교합니다.

```sql
select count(*) from safeschool_beta.incident_attachments where deleted_at is null;
```

## 5. 전환 판단

- 복구본으로 전환할지는 **사용자가 결정**합니다. 절차: 서비스 중지 → 복원 DB 소유권 정리 → DB 주소 변경 → `deploy:check` → 시작. 단, 앱은 DB 이름을 `safeschool_beta`로 강제하므로 이름을 바꾸는 단계에 별도 승인이 필요합니다.
- 복구 후 DB의 `storage_key`와 실제 파일을 대조합니다. 행은 있는데 파일이 없으면 화면에서 '사진 파일을 찾을 수 없습니다'로 표시됩니다.
- 시험에 쓴 복원 DB와 `restore-check` 폴더는 비교 후 삭제 승인을 받아 지웁니다. 개인정보가 들어 있을 수 있습니다.

## 6. 합격 기준

- [ ] 실제 덤프가 만들어지고 `pg_restore --list`가 통과합니다.
- [ ] 새 DB 복원 후 건수와 마이그레이션 수가 일치합니다.
- [ ] 사진 파일 수와 미삭제 첨부 수가 일치합니다.
- [ ] 복원 소요 시간을 기록했습니다.
- [ ] 시험 산출물 처리를 기록했습니다.
