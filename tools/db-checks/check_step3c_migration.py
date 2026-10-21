# STEP 3-C 마이그레이션 안전성 점검(빈 검증용 DB 전용 — 운영·시연·테스트 스키마에 실행 금지)
# 사용: 빈 DB(예: m3c)에 prisma/migrations/*/migration.sql을 순서대로 적용한 뒤 python3 tools/db-checks/check_step3c_migration.py
import subprocess, sys
DB="m3c"
def psql(sql):
    r=subprocess.run(["psql","-h","localhost","-U","postgres","-d",DB,"-v","ON_ERROR_STOP=1","-q","-c",sql],capture_output=True,text=True)
    err=[l for l in r.stderr.splitlines() if l.startswith("ERROR:")]
    return r.returncode==0, (err[0] if err else (r.stderr.strip().splitlines() or [""])[-1]).replace("ERROR:  ","")
A="00000000-0000-0000-0000-00000000000a"; B="00000000-0000-0000-0000-00000000000b"
AL1="00000000-0000-0000-0000-0000000000a1"; AL2="00000000-0000-0000-0000-0000000000a2"; ALB="00000000-0000-0000-0000-0000000000a3"; ALU="00000000-0000-0000-0000-0000000000a4"
N="00000000-0000-0000-0000-0000000000b1"; NB="00000000-0000-0000-0000-0000000000b2"; NC="00000000-0000-0000-0000-0000000000b3"
U="00000000-0000-0000-0000-0000000000e1"
# 최종(재사용) 점검용
AL5="00000000-0000-0000-0000-0000000000a5"; R1="00000000-0000-0000-0000-0000000000c1"; R2="00000000-0000-0000-0000-0000000000c2"; R3="00000000-0000-0000-0000-0000000000c3"
setup=f"""
insert into users(id,email,display_name) values ('{U}','t@x.kr','교사');
insert into schools(id,name,slug,status,activated_at) values ('{A}','A','test-a','active',now()),('{B}','B','test-b','active',now());
insert into official_alerts(id,provider,external_id,is_mock,kind,severity,issuer,body,areas_raw,areas,issued_at,content_hash,raw) values
 ('{AL1}','mock','m1',true,'weather','warning','기상청','폭염','인천광역시','[]',now()-interval '30 min','h','{{}}'),
 ('{AL2}','mock','m2',true,'weather','warning','기상청','폭염','인천광역시','[]',now()-interval '20 min','h','{{}}'),
 ('{ALB}','mock','m3',true,'weather','warning','부산시','너울','부산광역시','[]',now(),'h2','{{}}'),
 ('{ALU}','mock','m4',true,'other','advisory','가상','불명','어딘가','[]',now(),'h3','{{}}'),
 ('{AL5}','mock','m5',true,'weather','warning','기상청','호우','인천광역시','[]',now(),'h5','{{}}');
insert into school_alert_matches(school_id,alert_id,result,reason,duplicate_of_alert_id) values
 ('{A}','{AL1}','target','r',null),('{A}','{AL2}','target','r','{AL1}'),('{A}','{ALB}','non_target','r',null),('{A}','{ALU}','undetermined','r',null),
 ('{B}','{ALB}','target','r',null),('{A}','{AL5}','target','r',null);
"""
ok,msg=psql(setup); assert ok,msg
cases=[
 ("정상: A학교 대상 대표 경보에 안내문 작성", True, f"insert into school_notices(id,school_id,alert_id,example_key,example_version,title,body,created_by_id,updated_by_id) values ('{N}','{A}','{AL1}','heatwave.parent.issued',1,'폭염 안내','본문','{U}','{U}')"),
 ("자동 수정 이력: 판 1 기록됨", True, f"do $$ begin if (select count(*) from school_notice_revisions where notice_id='{N}' and version=1 and title='폭염 안내')<>1 then raise exception '이력 없음'; end if; end $$"),
 ("① 다른 학교 경보(B학교 대상, A학교 판정은 비대상)에 연결", False, f"insert into school_notices(school_id,alert_id,title,body) values ('{A}','{ALB}','t','b')"),
 ("① 판정 행이 없는 학교-경보 조합", False, f"insert into school_notices(school_id,alert_id,title,body) values ('{B}','{AL1}','t','b')"),
 ("① 미판정 경보에 연결", False, f"insert into school_notices(school_id,alert_id,title,body) values ('{A}','{ALU}','t','b')"),
 ("① 재송출 경보(대표 아님)에 연결", False, f"insert into school_notices(school_id,alert_id,title,body) values ('{A}','{AL2}','t','b')"),
 ("새 안내문을 작성 완료·판 2로 시작", False, f"insert into school_notices(school_id,alert_id,title,body,status,version) values ('{A}','{AL1}','t','b','completed',2)"),
 ("정상: B학교 대상 경보에 B학교 안내문", True, f"insert into school_notices(id,school_id,alert_id,title,body) values ('{NB}','{B}','{ALB}','부산','본문')"),
 ("④ 저장: 판 1→2, 본문 수정", True, f"update school_notices set body='본문 수정', version=2, updated_by_id='{U}' where id='{N}'"),
 ("④ 이력 판 2 자동 기록", True, f"do $$ begin if (select body from school_notice_revisions where notice_id='{N}' and version=2)<>'본문 수정' then raise exception 'x'; end if; end $$"),
 ("④ 오래된 판 기준 저장(판 1→2 재시도)", False, f"update school_notices set body='덮어쓰기', version=2 where id='{N}'"),
 ("④ 판 번호 건너뛰기(2→4)", False, f"update school_notices set body='x', version=4 where id='{N}'"),
 ("④ 내용 변경 없이 판 번호만 변경", False, f"update school_notices set version=3 where id='{N}'"),
 ("④ 이력 직접 추가(현재 판과 다른 내용)", False, f"insert into school_notice_revisions(notice_id,version,title,body,status) values ('{N}',9,'가짜','가짜','draft')"),
 ("④ 이력 수정", False, f"update school_notice_revisions set body='x'"),
 ("④ 이력 삭제", False, f"delete from school_notice_revisions"),
 ("학교·경보·작성자 바꾸기", False, f"update school_notices set alert_id='{AL2}' where id='{N}'"),
 ("안내문 삭제", False, f"delete from school_notices where id='{N}'"),
 ("사유 없는 취소", False, f"update school_notices set status='cancelled', cancelled_at=now(), version=3 where id='{N}'"),
 ("정상: 사유 있는 취소(판 3)", True, f"update school_notices set status='cancelled', cancelled_at=now(), cancel_reason='중복 작성', version=3 where id='{N}'"),
 ("③ 취소 후 본문 수정", False, f"update school_notices set body='되살리기', version=4 where id='{N}'"),
 ("③ 취소 후 상태 복구", False, f"update school_notices set status='draft', cancelled_at=null, cancel_reason=null, version=4 where id='{N}'"),
 ("정상: 처리 이력 입력(같은 학교)", True, f"insert into school_notices(id,school_id,alert_id,title,body) values ('{NC}','{A}','{AL1}','두번째','본문'); insert into notice_handling_records(notice_id,school_id,channel,sent_by_teacher,sent_at) values ('{NC}','{A}','sms',true,now())"),
 ("② 처리 이력의 학교가 안내문 학교와 다름", False, f"insert into notice_handling_records(notice_id,school_id,channel) values ('{NC}','{B}','sms')"),
 ("미발송인데 발송 일시", False, f"insert into notice_handling_records(notice_id,school_id,sent_by_teacher,sent_at) values ('{NC}','{A}',false,now())"),
 ("목록에 없는 채널 값", False, f"insert into notice_handling_records(notice_id,school_id,channel) values ('{NC}','{A}','real_api')"),
 ("처리 이력 내용 수정", False, f"update notice_handling_records set memo='바꿈'"),
 ("사유 없는 무효 처리", False, f"update notice_handling_records set voided_at=now()"),
 ("정상: 사유 있는 무효 처리", True, f"update notice_handling_records set voided_at=now(), void_reason='잘못 입력'"),
 ("무효 후 재수정", False, f"update notice_handling_records set void_reason='다시'"),
 ("처리 이력 삭제", False, f"delete from notice_handling_records"),
 ("⑥ 공식 경보 원문 수정(기존 보호 유지)", False, f"update official_alerts set body='x'"),
 ("경보 판정 행 삭제(안내문이 참조 중)", False, f"delete from school_alert_matches where school_id='{A}' and alert_id='{AL1}'"),
 ("기존 재판정 동작 유지: 판정 결과·사유 갱신", True, f"update school_alert_matches set reason='재판정' where school_id='{A}' and alert_id='{AL1}'"),
 # ───── 최종(10:55): 취소된 안내문으로 새 초안 만들기 ─────
 ("[재사용] 정상: 취소된 안내문 N으로 새 초안(새 ID·판 1·작성 중·같은 경보)", True, f"insert into school_notices(id,school_id,alert_id,example_key,example_version,title,body,source_notice_id,created_by_id,updated_by_id) select '{R1}',school_id,alert_id,example_key,example_version,title,body,id,'{U}','{U}' from school_notices where id='{N}'"),
 ("[재사용] 새 초안은 별도 수정 이력(판 1)으로 시작", True, f"do $$ begin if (select count(*) from school_notice_revisions where notice_id='{R1}')<>1 or (select version from school_notice_revisions where notice_id='{R1}')<>1 then raise exception 'x'; end if; end $$"),
 ("[재사용] 원본 내용·취소 정보·이력 3판 그대로", True, f"do $$ begin if not exists (select 1 from school_notices where id='{N}' and status='cancelled' and version=3 and body='본문 수정' and cancel_reason='중복 작성') or (select count(*) from school_notice_revisions where notice_id='{N}')<>3 then raise exception '원본 변경됨'; end if; end $$"),
 ("[재사용] 원본-새 초안 연결 확인(서로 다른 ID)", True, f"do $$ begin if (select source_notice_id from school_notices where id='{R1}')<>'{N}' or '{R1}'='{N}' then raise exception 'x'; end if; end $$"),
 ("[재사용] 같은 원본으로 작성 중 초안 또 만들기(중복 요청)", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{AL1}','t','b','{N}')"),
 ("[재사용] 정상: 새 초안 수정·저장(판 1→2)", True, f"update school_notices set body='재사용 후 수정', version=2, updated_by_id='{U}' where id='{R1}'"),
 ("[재사용] 원본 연결 바꾸기", False, f"update school_notices set source_notice_id=null, body='x', version=3 where id='{R1}'"),
 ("[재사용] 취소되지 않은 안내문(작성 중)을 원본으로", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{AL1}','t','b','{NC}')"),
 ("[재사용] 다른 학교(B) 안내문으로 A학교 초안", False, f"update school_notices set status='cancelled', cancelled_at=now(), cancel_reason='점검', version=2 where id='{NB}'; insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{AL1}','t','b','{NB}')"),
 ("[재사용] 다른 학교(B)로 A학교 원본 재사용", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{B}','{ALB}','t','b','{N}')"),
 ("[재사용] 없는 안내문 ID를 원본으로", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{AL1}','t','b','00000000-0000-0000-0000-0000000000ff')"),
 ("[재사용] 자기 자신을 원본으로", False, f"insert into school_notices(id,school_id,alert_id,title,body,source_notice_id) values ('{R3}','{A}','{AL1}','t','b','{R3}')"),
 ("[재사용] 정상: 새 초안 작성 완료(판 2→3)", True, f"update school_notices set status='completed', version=3 where id='{R1}'"),
 ("[재사용] 새 초안을 비대상 경보에 연결", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{ALB}','t','b','{N}')"),
 ("[재사용] 새 초안을 재송출 경보(대표 아님)에 연결", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{AL2}','t','b','{N}')"),
 ("[재사용] 새 초안을 미판정 경보에 연결", False, f"insert into school_notices(school_id,alert_id,title,body,source_notice_id) values ('{A}','{ALU}','t','b','{N}')"),
 ("[재사용] 정상: 앞 초안이 작성 완료된 뒤 같은 원본으로 다른 대상 경보(AL5)에 새 초안", True, f"insert into school_notices(id,school_id,alert_id,title,body,source_notice_id) values ('{R2}','{A}','{AL5}','t','b','{N}')"),
 ("[재사용] 원본 취소 안내문은 여전히 수정 불가", False, f"update school_notices set body='재사용 뒤 원본 수정', version=4 where id='{N}'"),
 ("[재사용] 원본 삭제(새 초안이 참조 중)", False, f"delete from school_notices where id='{N}'"),
 ("[재사용] 공식 경보 원문 불변(재사용 후에도)", True, f"do $$ begin if (select body from official_alerts where id='{AL1}')<>'폭염' then raise exception 'x'; end if; end $$"),
 ("테스트 초기화 TRUNCATE와 충돌 없음", True, "truncate notice_handling_records, school_notice_revisions, school_notices cascade"),
]
ok_n=0
for name, expect, sql in cases:
    ok,msg=psql(sql)
    good = ok==expect
    ok_n+=good
    print(f"{'✓' if good else '✗'} {name} — {'허용' if ok else '거부: '+msg}")
print(f"결과: {ok_n}/{len(cases)} 예상대로 동작")
old=[c for c in cases if not c[0].startswith("[재사용]")]; new=[c for c in cases if c[0].startswith("[재사용]")]
print(f"  - 기존(2차) 점검 항목 {len(old)}개, 최종 재사용 점검 항목 {len(new)}개")
