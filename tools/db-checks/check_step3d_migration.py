# STEP 3-D 마이그레이션 안전성 점검(빈 검증용 DB 전용 — 운영·시연·테스트 스키마에 실행 금지)
# 사용: 빈 DB(예: m3d)에 prisma/migrations/*/migration.sql을 순서대로 적용한 뒤 python3 tools/db-checks/check_step3d_migration.py
import subprocess
DB="m3d"
def psql(sql):
    r=subprocess.run(["psql","-h","localhost","-U","postgres","-d",DB,"-v","ON_ERROR_STOP=1","-q","-c",sql],capture_output=True,text=True)
    err=[l for l in r.stderr.splitlines() if l.startswith("ERROR:")]
    return r.returncode==0,(err[0] if err else (r.stderr.strip().splitlines() or [""])[-1]).replace("ERROR:  ","")
u=lambda n: f"00000000-0000-0000-0000-{n:012x}"
A,B=u(0xa),u(0xb)
U={k:u(0x100+i) for i,k in enumerate(["p","v1","v2","v3","s1","s2","op","t","pend","b"])}
M={k:u(0x200+i) for i,k in enumerate(U)}
EVD,EVA,EVR,EVB=u(0x301),u(0x302),u(0x303),u(0x304)
LOG=u(0x401)
setup=["insert into schools(id,name,slug,status,activated_at) values ('%s','A','test-a','active',now()),('%s','B','test-b','active',now());"%(A,B)]
for k in U: setup.append(f"insert into users(id,email,display_name) values ('{U[k]}','{k}@x.kr','{k}');")
for k in U:
    sch=B if k=="b" else A; st="pending" if k=="pend" else "approved"
    extra=", approval_method, approved_at" if st=="approved" else ""; vals=", 'manual', now()" if st=="approved" else ""
    setup.append(f"insert into school_memberships(id,school_id,user_id,role,status{extra}) values ('{M[k]}','{sch}','{U[k]}','staff','{st}'{vals});")
setup.append(f"""insert into disaster_events(id,school_id,primary_type,mode,status,started_at,closed_at) values
 ('{EVD}','{A}','earthquake','drill','closed',now()-interval '1 hour',now()),
 ('{EVA}','{A}','earthquake','drill','active',now(),null),
 ('{EVR}','{A}','fire','real','closed',now()-interval '2 hour',now()-interval '1 hour'),
 ('{EVB}','{B}','earthquake','drill','closed',now()-interval '1 hour',now());""")
ok,msg=psql("".join(setup)); assert ok,msg
D=lambda k,duty,via="school_app",extra="": f"insert into member_duties(school_id,membership_id,duty,granted_via{',verification_method' if 'method' in extra else ''}) values ('{B if k=='b' else A}','{M[k]}','{duty}','{via}'{extra.replace('method','')})"
cases=[
 # ── 직책·업무
 ("교장을 앱 경로(school_app)로 등록", False, D("p","principal")),
 ("교장을 플랫폼 운영자 경로·확인 방법 없이 등록", False, D("p","principal","platform_operator")),
 ("정상: 교장(플랫폼 운영자 확인·공문)", True, D("p","principal","platform_operator",",method'공문 확인'")),
 ("두 번째 교장 등록(1명 제한)", False, D("v1","principal","platform_operator",",method'공문 확인'")),
 ("정상: 교감 1", True, D("v1","vice_principal","platform_operator",",method'공문 확인'")),
 ("정상: 교감 2", True, D("v2","vice_principal","platform_operator",",method'공문 확인'")),
 ("세 번째 교감 등록(최대 2명)", False, D("v3","vice_principal","platform_operator",",method'공문 확인'")),
 ("정상: 안전담당 1", True, D("s1","safety_officer")),
 ("정상: 안전담당 2(여러 명)", True, D("s2","safety_officer")),
 ("정상: 앱 운영담당", True, D("op","app_operator")),
 ("정상: 겸임 — 안전담당 1이 앱 운영담당도", True, D("s1","app_operator")),
 ("정상: 겸임 — 담임(교직원)이 안전담당", True, D("t","safety_officer")),
 ("같은 사람에게 같은 업무 중복", False, D("s2","safety_officer")),
 ("다른 학교 교직원에게 A학교 업무", False, f"insert into member_duties(school_id,membership_id,duty,granted_via) values ('{A}','{M['b']}','safety_officer','school_app')"),
 ("승인 대기 교직원에게 업무", False, D("pend","safety_officer")),
 ("직무대리 표시는 교장·교감만", False, f"insert into member_duties(school_id,membership_id,duty,granted_via,is_acting) values ('{A}','{M['op']}','safety_officer','school_app',true)"),
 ("사유 없이 업무 종료", False, f"update member_duties set ended_at=now() where membership_id='{M['s2']}'"),
 ("정상: 사유 있는 업무 종료(업무 변경)", True, f"update member_duties set ended_at=now(), end_reason='업무분장 변경' where membership_id='{M['s2']}'"),
 ("종료된 업무 되살리기", False, f"update member_duties set ended_at=null, end_reason=null where membership_id='{M['s2']}'"),
 ("업무 종류 바꾸기", False, f"update member_duties set duty='app_operator' where membership_id='{M['t']}'"),
 ("업무 기록 삭제", False, "delete from member_duties"),
 ("정상: 교감 1 전보 종료 후 교감 3 등록", True, f"update member_duties set ended_at=now(), end_reason='전보' where membership_id='{M['v1']}'; "+D("v3","vice_principal","platform_operator",",method'공문 확인'")),
 ("정상: 종료 후 같은 업무 재지정(기록은 새 행)", True, D("s2","safety_officer")),
 # ── 훈련일지
 ("정상: 종료된 모의훈련에 훈련일지", True, f"insert into drill_logs(id,school_id,event_id,auto_snapshot,manual,created_by_id,updated_by_id) values ('{LOG}','{A}','{EVD}','{{\"classes\":[]}}','{{}}','{U['s1']}','{U['s1']}')"),
 ("수정 이력 판 1 자동 기록", True, f"do $$ begin if (select count(*) from drill_log_revisions where drill_log_id='{LOG}' and version=1)<>1 then raise exception 'x'; end if; end $$"),
 ("같은 이벤트에 두 번째 훈련일지", False, f"insert into drill_logs(school_id,event_id,auto_snapshot,manual) values ('{A}','{EVD}','{{}}','{{}}')"),
 ("진행 중인 훈련에 훈련일지", False, f"insert into drill_logs(school_id,event_id,auto_snapshot,manual) values ('{A}','{EVA}','{{}}','{{}}')"),
 ("실제 재난 기록에 훈련일지", False, f"insert into drill_logs(school_id,event_id,auto_snapshot,manual) values ('{A}','{EVR}','{{}}','{{}}')"),
 ("다른 학교 이벤트에 A학교 훈련일지", False, f"insert into drill_logs(school_id,event_id,auto_snapshot,manual) values ('{A}','{EVB}','{{}}','{{}}')"),
 ("작성 완료·판 2로 시작", False, f"insert into drill_logs(school_id,event_id,auto_snapshot,manual,status,version) values ('{B}','{EVB}','{{}}','{{}}','completed',2)"),
 ("배열 JSON(객체 아님)", False, f"insert into drill_logs(school_id,event_id,auto_snapshot,manual) values ('{B}','{EVB}','[]','{{}}')"),
 ("정상: 저장 판 1→2(담당자 입력)", True, f"update drill_logs set manual='{{\"durationText\":\"6분 51초\"}}', version=2, updated_by_id='{U['s2']}' where id='{LOG}'"),
 ("오래된 판으로 저장(판 2→2)", False, f"update drill_logs set manual='{{\"durationText\":\"덮어쓰기\"}}', version=2 where id='{LOG}'"),
 ("판 번호 건너뛰기(2→5)", False, f"update drill_logs set manual='{{}}', version=5 where id='{LOG}'"),
 ("내용 변경 없이 판 번호만", False, f"update drill_logs set version=3 where id='{LOG}'"),
 ("이벤트 바꾸기", False, f"update drill_logs set event_id='{EVA}' where id='{LOG}'"),
 ("훈련일지 삭제", False, f"delete from drill_logs where id='{LOG}'"),
 ("수정 이력 직접 추가", False, f"insert into drill_log_revisions(drill_log_id,version,status,auto_snapshot,manual) values ('{LOG}',9,'draft','{{}}','{{}}')"),
 ("수정 이력 수정·삭제", False, "update drill_log_revisions set manual='{}'"),
 ("수정 이력 2판(수정자 기록) 확인", True, f"do $$ begin if (select changed_by_id from drill_log_revisions where drill_log_id='{LOG}' and version=2)<>'{U['s2']}' then raise exception 'x'; end if; end $$"),
 ("이벤트 삭제(훈련일지가 참조 중)", False, f"delete from disaster_events where id='{EVD}'"),
 # ── 기존 기능 영향
 ("기존: 교직원 승인 상태 변경은 그대로 가능", True, f"update school_memberships set status='revoked', revoked_at=now() where id='{M['pend']}'"),
 ("기존: 진행 중 이벤트 종료는 그대로 가능", True, f"update disaster_events set status='closed', closed_at=now() where id='{EVA}'"),
 ("테스트 초기화 TRUNCATE와 충돌 없음", True, "truncate drill_log_revisions, drill_logs, member_duties cascade"),
]
n=0
for name,expect,sql in cases:
    ok,msg=psql(sql); good=ok==expect; n+=good
    print(f"{'✓' if good else '✗'} {name} — {'허용' if ok else '거부: '+msg}")
print(f"결과: {n}/{len(cases)} 예상대로 동작")
