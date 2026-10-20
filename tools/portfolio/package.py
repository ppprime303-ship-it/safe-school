# 하루치 증거 패키지(원본) 만들기 — 도구별 폴더 · 원문 1건 = 파일 1개 · 시각이 앞에 붙은 파일명 · 눌러서 찾는 색인
#
# 사용법: python3 tools/portfolio/package.py tools/portfolio/days/<날짜>/manifest.json <출력폴더>
#   manifest.json 항목은 tools/portfolio/README.md 참고. 결과: <출력폴더>/SAFE_SCHOOL_증거패키지_원본_<날짜>.zip
#   주의: Claude 세션 기록(JSONL)에는 계정 정보가 있으므로 결과 ZIP은 외부 공유·GitHub 업로드 금지.
import datetime, glob, hashlib, html, json, os, re, shutil, subprocess, sys, zipfile

MANIFEST = sys.argv[1]
OUTDIR = sys.argv[2]
BASE = os.path.dirname(os.path.abspath(MANIFEST))
M = json.load(open(MANIFEST, encoding="utf-8"))
DATE = M["date"]
REPO = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, cwd=BASE).stdout.strip()
KST = datetime.timezone(datetime.timedelta(hours=9))
NAME = f"SAFE_SCHOOL_증거패키지_원본_{DATE}"
ROOT = os.path.join(OUTDIR, NAME)
shutil.rmtree(ROOT, ignore_errors=True)

def newest(pattern):
    c = [p for p in glob.glob(os.path.expanduser(pattern))]
    return max(c, key=os.path.getmtime) if c else None
JSONL = os.path.expanduser(M.get("session_jsonl") or newest("~/.claude/projects/*/*.jsonl") or "")
UP = os.path.expanduser(M.get("uploads_dir") or newest("~/.claude/uploads/*") or "")
def res(p): return p if os.path.isabs(p) else os.path.join(BASE, p)

def at(hhmm, sec=0):
    h, m = map(int, hhmm.split(":"))
    y, mo, d = map(int, DATE.split("-"))
    return datetime.datetime(y, mo, d, h, m, sec, tzinfo=KST)

INDEX = []
def rel(p): return os.path.relpath(p, ROOT)
def add(time, sort, tool, kind, title, path, note=""):
    INDEX.append(dict(time=time, sort=sort, tool=tool, kind=kind, title=title, path=rel(path), note=note))
def safe(s, n=40):
    s = re.sub(r"[\\/:*?\"<>|\n\r\t]+", " ", s).strip()
    return re.sub(r"\s+", "_", s)[:n].rstrip("_.")
def write_text(path, header, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(header.rstrip() + "\n\n========== 원문 시작 ==========\n" + body.rstrip() + "\n========== 원문 끝 ==========\n")
def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
def kst(ts): return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST)
def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()

# ───────────── Claude 세션 기록 ─────────────
rows = [json.loads(l) for l in open(JSONL, encoding="utf-8")] if JSONL and os.path.exists(JSONL) else []
SR = re.compile(r"<system-reminder>.*?</system-reminder>\s*", re.S)
results, events, summaries = {}, [], []
for r in rows:
    if r.get("type") == "user" and isinstance(r["message"]["content"], list):
        for b in r["message"]["content"]:
            if b.get("type") == "tool_result":
                c = b.get("content")
                if isinstance(c, list): c = "\n".join(x.get("text", "") for x in c if x.get("type") == "text")
                results[b["tool_use_id"]] = c or ""
for r in rows:
    t, ts = r.get("type"), r.get("timestamp")
    if not ts or kst(ts).strftime("%Y-%m-%d") != DATE: continue
    if t == "user":
        ct = r["message"]["content"]
        if r.get("isCompactSummary"):
            summaries.append((ts, ct if isinstance(ct, str) else "\n".join(b.get("text", "") for b in ct if b.get("type") == "text"))); continue
        if isinstance(ct, list) and any(b.get("type") == "tool_result" for b in ct): continue
        text = SR.sub("", ct if isinstance(ct, str) else "\n".join(b.get("text", "") for b in ct if b.get("type") == "text")).strip()
        if text and text != "[Request interrupted by user]" and not text.startswith("[Image"):
            events.append(("user", ts, text))
    elif t == "queue-operation" and r.get("operation") == "remove" and r.get("content"):
        events.append(("user", ts, SR.sub("", r["content"]).strip()))
    elif t == "assistant":
        for b in r["message"]["content"]:
            if b.get("type") == "text" and b["text"].strip(): events.append(("claude", ts, b["text"].strip()))
            elif b.get("type") == "tool_use": events.append(("tool", ts, b))
events.sort(key=lambda e: e[1])

REPLIT_HINT = re.compile(r"(> safe-school@|Test Files |\[e2e[^\]]*\] 결과)")
def user_title(text):
    t = re.sub(r'@"[^"]+"\s*', "", text).strip()
    if REPLIT_HINT.search(t): return "Replit 실행 결과 붙여넣기"
    return t.split("\n")[0][:40] or "(첨부만)"

C_IN, C_OUT = f"{ROOT}/03_Claude/1_사용자입력_원문", f"{ROOT}/03_Claude/2_Claude응답_원문"
for kind, ts, payload in events:
    d = kst(ts); hm, hh = d.strftime("%H%M"), d.strftime("%H:%M")
    if kind == "user":
        title = user_title(payload)
        p = f"{C_IN}/{hm}_{safe(title)}.txt"
        if os.path.exists(p): p = p.replace(".txt", f"_{d:%S}.txt")
        write_text(p, f"출처: Claude 대화(세션 기록)\n구분: 사용자 직접 입력 원문\n시각: {d:%Y-%m-%d %H:%M:%S} KST\n비고: 시스템이 덧붙인 시각 안내 문구만 제외하고 글자 그대로 옮김", payload)
        add(hh, d, "Claude", "사용자 입력 원문", title, p)
        if title == "Replit 실행 결과 붙여넣기":
            p2 = f"{ROOT}/05_Replit/{hm}_콘솔출력_원문(Claude대화에_붙여넣음).txt"
            write_text(p2, f"출처: Replit(사용자가 Replit Shell에서 실행해 Claude 대화에 붙여넣음)\n시각: {d:%Y-%m-%d %H:%M:%S} KST", payload)
            add(hh, d, "Replit", "콘솔 출력 원문", "Replit 실행 결과(Claude에 전달)", p2)
    elif kind == "claude" and len(payload) >= 120:
        first = payload.split("\n")[0]
        p = f"{C_OUT}/{hm}_{safe(first, 36)}.md"
        if os.path.exists(p): p = p.replace(".md", f"_{d:%S}.md")
        write_text(p, f"출처: Claude 대화(세션 기록)\n구분: Claude 응답 원문\n시각: {d:%Y-%m-%d %H:%M:%S} KST", payload)
        add(hh, d, "Claude", "Claude 응답 원문", first[:60], p)
if events:
    os.makedirs(C_OUT, exist_ok=True)
    full = f"{C_OUT}/전체_대화와_작업기록_시간순.md"
    with open(full, "w", encoding="utf-8") as f:
        f.write("# Claude 대화·작업 기록 전체(시간순, 원문)\n\n사용자 입력, Claude 응답, Claude가 실행한 명령과 결과(3,000자 넘으면 자름)를 시간순으로 모았습니다.\n\n")
        for kind, ts, payload in events:
            d = kst(ts)
            if kind == "tool":
                inp, name = payload.get("input", {}), payload["name"]
                desc = (f"Bash — {inp.get('description','')}\n```bash\n{inp.get('command','')}\n```" if name == "Bash"
                        else f"{name} — {inp.get('file_path') or json.dumps(inp, ensure_ascii=False)[:300]}")
                r_ = str(results.get(payload["id"], ""))
                if name in ("Write", "Read", "Edit") or "bytes_b64" in r_: r_ = "(파일 본문 생략)" if r_ else ""
                elif len(r_) > 3000: r_ = r_[:3000] + f"\n…(이하 {len(r_)-3000}자 생략)"
                f.write(f"### {d:%H:%M:%S} · Claude 명령 실행\n\n{desc}\n" + (f"\n결과:\n```text\n{r_.strip()}\n```\n" if r_.strip() else "") + "\n")
            else:
                f.write(f"### {d:%H:%M:%S} · {'사용자' if kind=='user' else 'Claude'}\n\n````text\n{payload}\n````\n\n")
    first_d = kst(events[0][1])
    add(first_d.strftime("%H:%M") + "~", first_d, "Claude", "전체 기록", "Claude 대화·명령 실행 전체 기록(시간순)", full)
for ts, text in summaries:
    d = kst(ts)
    p = f"{ROOT}/03_Claude/4_정리글_원문아님/{d:%H%M}_대화압축요약_Claude작성.md"
    write_text(p, f"출처: Claude가 대화 압축 때 자동 작성한 요약\n구분: 정리글(사용자 원문 아님 — 사용자 발화로 인용하지 마세요)\n시각: {d:%Y-%m-%d %H:%M} KST", text)
    add(d.strftime("%H:%M"), d, "Claude", "정리글(원문 아님)", "대화 압축 요약(Claude 작성)", p)

# 첨부 원본(바이트 그대로) — 업로드 시각은 파일 수정 시각
hash_rows = []
for a in M.get("attachments", []):
    found = sorted(glob.glob(os.path.join(UP, a["glob"])))
    if not found:
        print("[첨부 없음]", a["glob"]); continue
    src = found[0]
    d = datetime.datetime.fromtimestamp(os.path.getmtime(src), KST)
    ext = os.path.splitext(src)[1]
    dst = f"{C_IN}/첨부파일_원본/{d:%H%M}_{a['title']}{ext}"
    copy(src, dst)
    hash_rows.append((rel(dst), d.strftime("%H:%M:%S"), sha(src)))
    add(d.strftime("%H:%M"), d, "Claude", a["kind"], a["title"].replace("_", " ") + f" ({ext[1:]})", dst, "업로드 시각 · 파일 그대로")

for c in M.get("claude_docs", []):
    dst = f"{ROOT}/03_Claude/3_Claude작성_문서/{os.path.basename(c['path'])}"
    copy(res(c["path"]), dst)
    if c.get("title"):
        add(c["time"], at(c["sort"]), "Claude", "Claude 작성 문서", c["title"], dst, c.get("note", ""))

# ───────────── ChatGPT ─────────────
G = f"{ROOT}/02_ChatGPT"
for i, m in enumerate(M.get("chatgpt_messages", []), 1):
    p = f"{G}/1_사용자입력_원문/{i:02d}_{safe(m['group'], 20)}_{safe(m['text'].split(chr(10))[0], 30)}.txt"
    write_text(p, f"출처: ChatGPT 대화({m.get('source', 'ChatGPT 대화 기록')})\n구분: 사용자 입력 원문\n위치: {m['group']} · {m['time']}"
               + ("" if m.get("exact") else "(ChatGPT 대화는 시각 기록 없음 — 커밋·서버 시각으로 추정한 구간)"), m["text"])
    add(m["time"], at(m["sort"], min(i, 59)), "ChatGPT", "사용자 입력 원문", m["text"].split("\n")[0][:60], p)
for i, m in enumerate(M.get("chatgpt_replies", []), 1):
    p = f"{G}/1b_ChatGPT응답_원문/{i:02d}_{safe(m['text'].split(chr(10))[0], 30)}.txt"
    write_text(p, f"출처: ChatGPT 응답\n구분: ChatGPT 응답 원문\n위치: {m['time']}", m["text"])
    add(m["time"], at(m["sort"], min(i, 59)), "ChatGPT", "ChatGPT 응답 원문", m["text"].split("\n")[0][:60], p)
for m in M.get("chatgpt_prompts", []):
    p = f"{G}/2_ChatGPT작성_프롬프트_원문/{safe(m['title'], 40)}.txt"
    write_text(p, f"출처: ChatGPT가 작성한 Claude 전달용 프롬프트\n구분: ChatGPT 작성 원문\nClaude 입력 여부: {m['used']}", m["text"])
    add(m["time"], at(m["sort"]), "ChatGPT", "ChatGPT 작성 프롬프트", m["title"], p, m["used"])
for f_ in M.get("chatgpt_files", []):
    src = res(f_["path"])
    if os.path.isdir(src):
        for x in glob.glob(f"{src}/**/*", recursive=True):
            if os.path.isfile(x): copy(x, f"{G}/3_ChatGPT_받은자료_원본/{f_['name']}/" + os.path.relpath(x, src))
    else:
        found = sorted(glob.glob(os.path.join(UP, f_["path"]))) or [src]
        copy(found[0], f"{G}/3_ChatGPT_받은자료_원본/{f_['name']}")

# ───────────── Replit(대화에 붙여넣은 콘솔 출력 중 Claude 대화 밖의 것) ─────────────
for m in M.get("replit_outputs", []):
    p = f"{ROOT}/05_Replit/{m['prefix']}_{safe(m['label'])}_콘솔출력원문({m['via']}).txt"
    write_text(p, f"출처: Replit 콘솔 출력(사용자가 {m['via']}에 붙여넣음)\n위치: {m['label']} · {m['time']}", m["text"])
    add(m["time"], at(m["sort"]), "Replit", "콘솔 출력 원문", m["label"] + f"({m['via']})", p)

# ───────────── GitHub ─────────────
GH = f"{ROOT}/04_GitHub"
os.makedirs(GH, exist_ok=True)
rng = ["--since", f"{DATE} 00:00", "--until", f"{DATE} 23:59:59"]
log = subprocess.run(["git", "-C", REPO, "log", "--all", "--date=iso-local", "--format=%h|%ad|%an|%s", *rng], capture_output=True, text=True).stdout.strip().splitlines()
commits = sorted((l.split("|", 3) for l in log if l), key=lambda x: x[1])
with open(f"{GH}/커밋목록_시간순.md", "w", encoding="utf-8") as f:
    f.write(f"# GitHub 커밋 목록({DATE}, 전 브랜치, 시간순)\n\n| 시각(KST) | 커밋 | 작성자 | 내용 |\n| --- | --- | --- | --- |\n")
    for h, ad, an, s in commits:
        f.write(f"| {ad[11:16]} | `{h}` | {'Claude' if an=='Claude' else '사용자 계정'} | {s} |\n")
subprocess.run(["bash", "-c", f"git -C '{REPO}' log --all --date=iso-local --stat --since='{DATE} 00:00' --until='{DATE} 23:59:59' > '{GH}/커밋별_변경파일_전체.txt'"], check=True)
subprocess.run(["bash", "-c", f"git -C '{REPO}' for-each-ref --format='%(refname:short) %(objectname:short)' refs/heads refs/remotes > '{GH}/브랜치.txt'"], check=True)
for h, ad, an, s in commits:
    dt = datetime.datetime.strptime(ad[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST)
    add(ad[11:16], dt, "GitHub", "커밋", f"{h} {s}", f"{GH}/커밋목록_시간순.md", "Claude 작성" if an == "Claude" else "사용자 계정")

# ───────────── 요약본·기계기록 ─────────────
for pat in M.get("report_files", []):
    for f_ in glob.glob(res(pat)):
        copy(f_, f"{ROOT}/01_한눈에보기_요약본/{os.path.basename(f_)}")
if JSONL and os.path.exists(JSONL):
    copy(JSONL, f"{ROOT}/90_기계기록_원본/Claude_세션기록.jsonl")
os.makedirs(f"{ROOT}/90_기계기록_원본", exist_ok=True)
with open(f"{ROOT}/90_기계기록_원본/첨부파일_SHA256.txt", "w", encoding="utf-8") as f:
    f.write("파일 | 업로드 시각(KST) | SHA-256\n")
    for r in hash_rows: f.write(" | ".join(r) + "\n")

# ───────────── 색인(HTML + MD) ─────────────
INDEX.sort(key=lambda x: x["sort"])
COL = {"ChatGPT": "#EAF4E4", "Claude": "#E6F2F5", "GitHub": "#ECECF3", "Replit": "#FEF3E2"}
DOT = {"ChatGPT": "#2F6B2F", "Claude": "#176A80", "GitHub": "#4B4B6B", "Replit": "#B45309"}
quick = []
for q in M.get("quick", []):
    x = next((x for x in INDEX if q["match"] in x["path"] and (not q.get("tool") or x["tool"] == q["tool"])), None)
    if x: quick.append((q["label"], x))
for f_ in sorted(glob.glob(f"{ROOT}/01_한눈에보기_요약본/*.hwpx")):
    quick.append(("한눈에 보기 요약본(한글)", {"path": rel(f_), "tool": "Claude"}))
css = """body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#172B4D;margin:24px;max-width:1100px}h1{color:#183153;margin:0}p.s{color:#4A5B78}
table{border-collapse:collapse;width:100%;margin:8px 0 20px}td,th{border:1px solid #B8C2D0;padding:6px 8px;font-size:14px;vertical-align:top}th{background:#183153;color:#fff;text-align:left}
a{color:#176A80;font-weight:600}.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:700;font-size:12px}
.quick{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin:10px 0 24px}.quick a{display:block;border:1px solid #B8C2D0;border-radius:8px;padding:8px 10px;text-decoration:none;background:#F6F8FB}
.legend span{margin-right:12px}"""
tag = lambda t: f"<span class='tag' style='background:{COL[t]};color:{DOT[t]}'>{t}</span>"
h = [f"<!doctype html><html lang='ko'><head><meta charset='utf-8'><title>SAFE SCHOOL 증거 원문 찾기 {DATE}</title><style>{css}</style></head><body>",
     f"<h1>SAFE SCHOOL 증거 원문 찾기 · {DATE}</h1>",
     "<p class='s'>파일 이름을 누르면 원문이 열립니다(압축을 푼 뒤 이 파일을 브라우저로 여세요). 원문 파일은 맨 위에 출처·시각이 있고 <b>'원문 시작/끝'</b> 표시 사이가 원문입니다. 첨부파일 원본은 받은 그대로입니다.</p>",
     "<p class='legend'>" + "".join(f"<span>{tag(k)}</span>" for k in COL) + "</p>", "<h2>자주 찾는 원문</h2><div class='quick'>"]
md = [f"# SAFE SCHOOL 증거 원문 찾기 · {DATE}", "", "원문 파일은 맨 위에 출처·시각, '원문 시작/끝' 사이가 원문입니다. `00_원문찾기.html`(브라우저)에서 눌러 열 수 있습니다.", "", "## 자주 찾는 원문", ""]
for label, x in quick:
    h.append(f"<a href='{html.escape(x['path'])}'>{tag(x['tool'])} {html.escape(label)}</a>"); md.append(f"- **{label}** — `{x['path']}`")
FOLD = [("01_한눈에보기_요약본", "한글(hwpx)·PDF 요약 기록"), ("02_ChatGPT/1_사용자입력_원문", "ChatGPT에 입력한 문장(1건 = 파일 1개)"),
        ("02_ChatGPT/1b_ChatGPT응답_원문", "ChatGPT 응답 원문(있는 경우)"), ("02_ChatGPT/2_ChatGPT작성_프롬프트_원문", "ChatGPT가 쓴 Claude용 프롬프트(Claude 입력 여부 표시)"),
        ("02_ChatGPT/3_ChatGPT_받은자료_원본", "ChatGPT에서 받은 자료 원본"), ("03_Claude/1_사용자입력_원문", "Claude에 입력한 문장(파일명 앞 4자리 = 시각) + 첨부파일_원본"),
        ("03_Claude/2_Claude응답_원문", "Claude 응답(1건 = 파일 1개) + 전체 대화·명령 기록"), ("03_Claude/3_Claude작성_문서", "Claude가 만든 문서"),
        ("03_Claude/4_정리글_원문아님", "Claude 자동 요약(원문 아님)"), ("04_GitHub", "그날 커밋 목록·변경 파일·브랜치"),
        ("05_Replit", "Replit 콘솔 출력 원문"), ("90_기계기록_원본", "Claude 세션 기록 원본(JSONL)·첨부파일 SHA-256")]
h.append("</div><h2>폴더 구성</h2><table><tr><th>폴더</th><th>들어 있는 것</th></tr>")
md += ["", "## 폴더 구성", "", "| 폴더 | 들어 있는 것 |", "| --- | --- |"]
for a_, b_ in FOLD:
    if os.path.exists(os.path.join(ROOT, a_)):
        h.append(f"<tr><td>{a_}</td><td>{b_}</td></tr>"); md.append(f"| `{a_}` | {b_} |")
h.append("</table><h2>시간순 전체 목록</h2><table><tr><th style='width:90px'>시각</th><th style='width:80px'>도구</th><th style='width:150px'>구분</th><th>내용 · 파일</th></tr>")
md += ["", "## 시간순 전체 목록", "", "| 시각 | 도구 | 구분 | 내용 | 파일 |", "| --- | --- | --- | --- | --- |"]
for x in INDEX:
    note = f" <i>({html.escape(x['note'])})</i>" if x["note"] else ""
    h.append(f"<tr style='background:{COL[x['tool']]}'><td>{x['time']}</td><td><b style='color:{DOT[x['tool']]}'>{x['tool']}</b></td><td>{html.escape(x['kind'])}</td>"
             f"<td>{html.escape(x['title'])}{note}<br><a href='{html.escape(x['path'])}'>{html.escape(x['path'])}</a></td></tr>")
    md.append(f"| {x['time']} | {x['tool']} | {x['kind']} | {x['title'].replace('|','/')}{(' (' + x['note'] + ')') if x['note'] else ''} | `{x['path']}` |")
footer = M.get("footer_note", "")
h.append(f"</table><p class='s'>{html.escape(footer)} <b>이 패키지에는 계정 정보가 든 기계 기록이 있으니 외부에 공유하지 마세요.</b> 공개용은 GitHub docs/portfolio/를 쓰세요.</p></body></html>")
md += ["", f"> {footer}", "> **외부 공유 금지**(계정 정보가 든 기계 기록 포함)."]
open(f"{ROOT}/00_원문찾기.html", "w", encoding="utf-8").write("".join(h))
open(f"{ROOT}/00_원문찾기.md", "w", encoding="utf-8").write("\n".join(md))

zp = os.path.join(OUTDIR, f"{NAME}.zip")
if os.path.exists(zp): os.remove(zp)
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for r_, _, files in os.walk(ROOT):
        for f_ in sorted(files):
            p = os.path.join(r_, f_); z.write(p, os.path.join(NAME, os.path.relpath(p, ROOT)))
from collections import Counter
print(zp, len(INDEX), dict(Counter(x["tool"] for x in INDEX)))
