# STEP 4 안전교육 자료 화면 점검(Playwright) — 실행 중인 앱 주소를 받아 읽기·필터 조작·화면 이동만 합니다
# (외부 사이트를 열지 않음, 저장 없음).
#  1) 320·360·390·430·768·1366px — 목록: 가로 스크롤, 카드 열 수(768px 미만 1열 / 이상 2열), 필터 드롭다운 배치(640px 미만 세로),
#     선택값 잘림, 카드 안 겹침·영역 밖, 배지 겹침, 터치 높이 44px 이상, 머리글 겹침
#     상세: 가로 스크롤, 겹침·잘림, '공식 사이트 방문' 단추 표시·높이
#  2) 390·1366px — 드롭다운 필터·동시 적용·초기화·결과 없음, 카드 → 내부 상세, 목록으로 돌아가기(상태 유지),
#     브라우저 뒤로 가기, 새로고침 복원, 없는 기관 ID, 외부 링크 속성
# 사용: python3 tools/ui-checks/education_ui.py http://127.0.0.1:5000 <학교ID> [출력폴더] [--storage state.json]
import asyncio, json, sys
from playwright.async_api import async_playwright

WIDTHS = (320, 360, 390, 430, 768, 1366)
HOSTS = ("https://www.schoolsafe24.or.kr/", "https://kasem.safekorea.go.kr/")

COMMON_JS = """
const ov=(A,B)=>A.left<B.right-1&&B.left<A.right-1&&A.top<B.bottom-1&&B.top<A.bottom-1;
const vis=e=>e.offsetParent!==null;
function controls(root, issues){
 for(const e of [...root.querySelectorAll('button,a,input,select,summary')].filter(vis)){const r=e.getBoundingClientRect();
  if(r.height<44 && !e.closest('li')?.matches('.text-sm')) issues.push('터치 높이 '+Math.round(r.height)+': '+(e.innerText||e.getAttribute('aria-label')||e.tagName).slice(0,20));
  if(!['INPUT','SELECT'].includes(e.tagName)&&e.scrollWidth>e.clientWidth+1) issues.push('글자 잘림: '+e.innerText.slice(0,20));
  if(r.right>root.getBoundingClientRect().right+0.5||r.left<root.getBoundingClientRect().left-0.5) issues.push('본문 밖: '+(e.innerText||e.tagName).slice(0,20));}
 const head=document.querySelector('header'); const hk=[...head.querySelectorAll('h1,a,button')].filter(vis);
 for(let a=0;a<hk.length;a++)for(let b=a+1;b<hk.length;b++) if(ov(hk[a].getBoundingClientRect(),hk[b].getBoundingClientRect())) issues.push('머리글 겹침');
}
"""

LIST_JS = "()=>{" + COMMON_JS + """
 const main=document.querySelector('main'); if(!main||!document.querySelector('#edu-title')) return {missing:true};
 const issues=[]; controls(main, issues);
 const cards=[...document.querySelectorAll('[data-testid=edu-card]')];
 const top0=Math.min(...cards.map(c=>Math.round(c.getBoundingClientRect().top)));
 const perRow=cards.filter(c=>Math.round(c.getBoundingClientRect().top)===top0).length;
 for(const c of cards){const cr=c.getBoundingClientRect();
  const parts=[...c.querySelectorAll('span,svg')].filter(e=>e.getClientRects().length&&!e.classList.contains('sr-only'));
  for(const e of parts){const r=e.getBoundingClientRect(); if(r.right>cr.right+0.5||r.left<cr.left-0.5) issues.push('카드 밖: '+(e.textContent||'').slice(0,15));}
  const badges=[...c.querySelectorAll('.rounded-full')]; for(let a=0;a<badges.length;a++)for(let b=a+1;b<badges.length;b++) if(ov(badges[a].getBoundingClientRect(),badges[b].getBoundingClientRect())) issues.push('배지 겹침');
  const name=c.querySelector('.text-lg'); const arrow=c.querySelector(':scope > svg'); if(name&&arrow&&ov(name.getBoundingClientRect(),arrow.getBoundingClientRect())) issues.push('이름·화살표 겹침');}
 const sels=[...document.querySelectorAll('main select')]; const sr=sels.map(s=>s.getBoundingClientRect());
 const stacked=sr.length===2 && sr[1].top>=sr[0].bottom-1;
 const clipSel=sels.filter(s=>{const c=document.createElement('canvas').getContext('2d'); c.font=getComputedStyle(s).font; const w=c.measureText(s.options[s.selectedIndex].text).width; return w > s.clientWidth-52;}).map(s=>s.value);
 if(clipSel.length) issues.push('선택값 잘림: '+clipSel.join(','));
 const eduHeader=document.querySelector('header a[href$="/education"]'); const eduSide=document.querySelector('nav a[href$="/education"]');
 return {sw:document.documentElement.scrollWidth, cards:cards.length, perRow, stacked, issues,
   entry:{header:!!(eduHeader&&vis(eduHeader)), sidebar:!!(eduSide&&vis(eduSide))}};
}"""

DETAIL_JS = "()=>{" + COMMON_JS + """
 const main=document.querySelector('main'); const art=document.querySelector('article[aria-labelledby=edu-detail-title]'); if(!art) return {missing:true};
 const issues=[]; controls(main, issues);
 const btn=document.querySelector('[data-testid=edu-external-link]'); const b=btn&&btn.getBoundingClientRect();
 const ar=art.getBoundingClientRect();
 for(const e of [...art.querySelectorAll('h2,h3,p,li')].filter(vis)){const r=e.getBoundingClientRect(); if(r.right>ar.right+0.5) issues.push('상세 밖: '+e.innerText.slice(0,15));}
 return {sw:document.documentElement.scrollWidth, issues, button: b? {h:Math.round(b.height), w:Math.round(b.width), inside: b.left>=ar.left&&b.right<=ar.right}: null};
}"""

async def count(pg):
    return int(await pg.locator("[data-testid=edu-count]").inner_text())

async def names(pg):
    return [n.split("\n")[0] for n in await pg.locator("[data-testid=edu-card]").all_inner_texts()]

async def flows(pg, base, school, w, results):
    def check(name, ok, detail=""):
        results.append((bool(ok), f"{w}px {name}" + ("" if ok else f" — {detail}")))
    level = pg.get_by_label("학교급", exact=True)
    area = pg.get_by_label("안전교육 영역", exact=True)
    box = pg.get_by_role("searchbox", name="사이트·주제 검색")
    total = await count(pg)
    check("처음 전체 표시·외부 링크 없음", total >= 1 and await pg.locator("[data-testid=edu-external-link]").count() == 0, total)
    await level.select_option("kindergarten")
    lv = await count(pg)
    check("학교급 드롭다운(유치원)", 0 < lv <= total and "level=kindergarten" in pg.url, (lv, pg.url))
    await area.select_option("firstaid")
    check("영역 드롭다운(응급처치) 동시 적용", await names(pg) == ["학교안전지원시스템 · 안전교육 자료실"], await names(pg))
    await pg.get_by_role("button", name="필터 초기화").first.click()
    check("필터 초기화", await count(pg) == total and await level.input_value() == "all" and await area.input_value() == "all" and "?" not in pg.url, pg.url)
    await box.fill("없는검색어xyz")
    empty = await pg.locator("[data-testid=edu-empty]").inner_text() if await pg.locator("[data-testid=edu-empty]").count() else ""
    check("결과 없음 안내", "현재 확인된 자료가 없습니다" in empty, empty[:40])
    await pg.locator("[data-testid=edu-empty]").get_by_role("button", name="필터 초기화").click()
    # 검색어 + 두 필터 → 카드 → 상세
    await box.fill("체험관"); await level.select_option("elementary"); await area.select_option("traffic")
    list_url = pg.url
    check("세 조건 동시 적용", await names(pg) == ["국민안전교육플랫폼"] and "q=" in list_url and "level=elementary" in list_url and "area=traffic" in list_url, (await names(pg), list_url))
    await pg.locator("[data-testid=edu-card]").first.click()
    await pg.wait_for_timeout(300)
    title = await pg.locator("#edu-detail-title").inner_text() if await pg.locator("#edu-detail-title").count() else ""
    check("카드 → 내부 상세(외부 이동 아님)", "/education/kasem" in pg.url and title == "국민안전교육플랫폼" and len(pg.context.pages) == 1, (pg.url, title))
    a = await pg.locator("[data-testid=edu-external-link]").evaluate_all("as=>as.map(a=>({h:a.href,t:a.target,r:a.rel}))")
    check("상세 '공식 사이트 방문' 하나·새 탭·noopener noreferrer·공식 도메인", len(a) == 1 and a[0]["t"] == "_blank" and "noopener" in a[0]["r"] and "noreferrer" in a[0]["r"] and a[0]["h"].startswith(HOSTS), a)
    # 목록으로 돌아가기(단추)
    await pg.locator("[data-testid=edu-back]").click(); await pg.wait_for_timeout(300)
    check("목록으로 돌아가기 → 검색어·필터 유지", await box.input_value() == "체험관" and await level.input_value() == "elementary" and await area.input_value() == "traffic" and await names(pg) == ["국민안전교육플랫폼"], pg.url)
    # 브라우저 뒤로 가기: 상세 → 뒤로 → 목록 상태
    await pg.locator("[data-testid=edu-card]").first.click(); await pg.wait_for_timeout(300)
    await pg.go_back(); await pg.wait_for_timeout(500)
    check("브라우저 뒤로 가기 → 상태 유지", "/education/" not in pg.url and await box.input_value() == "체험관" and await area.input_value() == "traffic", pg.url)
    # 새로고침
    await pg.reload(); await pg.wait_for_timeout(800)
    check("새로고침 → 상태 복원", await box.input_value() == "체험관" and await level.input_value() == "elementary" and await area.input_value() == "traffic" and await count(pg) == 1, pg.url)
    # 상세 새로고침 후 돌아가기
    await pg.locator("[data-testid=edu-card]").first.click(); await pg.wait_for_timeout(300)
    await pg.reload(); await pg.wait_for_timeout(800)
    await pg.locator("[data-testid=edu-back]").click(); await pg.wait_for_timeout(300)
    check("상세 새로고침 후 돌아가기 → 상태 유지", await area.input_value() == "traffic" and await box.input_value() == "체험관", pg.url)
    # 없는 기관 ID
    await pg.goto(f"{base}/s/{school}/education/no-such-site"); await pg.wait_for_timeout(800)
    check("없는 기관 ID 안내", await pg.locator("[data-testid=edu-not-found]").count() == 1 and await pg.locator("[data-testid=edu-external-link]").count() == 0)

async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base, school = args[0], args[1]
    out = args[2] if len(args) > 2 else "."
    storage = sys.argv[sys.argv.index("--storage") + 1] if "--storage" in sys.argv else None
    results = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in WIDTHS:
            ctx = await b.new_context(viewport={"width": w, "height": 900}, storage_state=storage)
            pg = await ctx.new_page()
            await pg.goto(f"{base}/s/{school}/education"); await pg.wait_for_timeout(1000)
            m = await pg.evaluate(LIST_JS)
            if m.get("missing"):
                results.append((False, f"{w}px 화면 없음(로그인·승인 상태 확인)")); await ctx.close(); continue
            # 긴 선택값(약물 및 사이버중독 예방)도 잘리지 않는지
            await pg.get_by_label("안전교육 영역", exact=True).select_option("addiction")
            await pg.get_by_label("학교급", exact=True).select_option("kindergarten")
            m2 = await pg.evaluate(LIST_JS)
            await pg.screenshot(path=f"{out}/edu_list_filtered_{w}.png", full_page=True)
            await pg.goto(f"{base}/s/{school}/education"); await pg.wait_for_timeout(600)
            await pg.screenshot(path=f"{out}/edu_list_{w}.png", full_page=True)
            # 기관 이름이 아주 길어도 카드가 깨지지 않는지(화면 글자만 임시로 바꿔 측정, 데이터 변경 없음)
            long_issue = await pg.evaluate("""()=>{const c=document.querySelector('[data-testid=edu-card]'); const n=c.querySelector('.text-lg');
              n.textContent='가상기관이름이아주길어서한줄에들어가지않는경우를확인하는시험용긴이름입니다 · 안전교육 자료실 바로가기';
              const cr=c.getBoundingClientRect(); const bad=[...c.querySelectorAll('span,svg')].filter(e=>e.getClientRects().length&&!e.classList.contains('sr-only')).some(e=>{const r=e.getBoundingClientRect(); return r.right>cr.right+0.5||r.left<cr.left-0.5;});
              return bad || document.documentElement.scrollWidth>innerWidth;}""")
            if long_issue: m["issues"].append("긴 기관 이름에서 카드 깨짐")
            await pg.reload(); await pg.wait_for_timeout(600)
            want_cols = 1 if w < 768 else 2
            entry_ok = m["entry"]["header"] if w < 1024 else m["entry"]["sidebar"]
            issues = m["issues"] + m2["issues"]
            ok = m["sw"] <= w and not issues and m["perRow"] == min(want_cols, m["cards"]) and entry_ok and m["stacked"] == (w < 640)
            results.append((ok, f"{w}px 목록: 페이지 폭 {m['sw']}, 카드 {m['cards']}개·한 줄 {m['perRow']}개, 드롭다운 {'세로' if m['stacked'] else '나란히'}, 메뉴 진입 {entry_ok}"
                            + ("" if ok else f" — {json.dumps(issues[:8], ensure_ascii=False)}")))
            await pg.goto(f"{base}/s/{school}/education/schoolsafe24"); await pg.wait_for_timeout(800)
            d = await pg.evaluate(DETAIL_JS)
            if not d.get("missing"):
                # 상세 제목이 카드 안에 들어가는지(긴 낱말 포함)
                t = await pg.evaluate("()=>{const h=document.querySelector('#edu-detail-title').getBoundingClientRect(); const a=document.querySelector('article[aria-labelledby=edu-detail-title]').getBoundingClientRect(); return h.right<=a.right-8}")
                if not t: d["issues"].append("상세 제목이 카드 여백 침범")
            await pg.screenshot(path=f"{out}/edu_detail_{w}.png", full_page=True)
            dok = not d.get("missing") and d["sw"] <= w and not d["issues"] and d["button"] and d["button"]["h"] >= 48 and d["button"]["inside"]
            results.append((dok, f"{w}px 상세: 페이지 폭 {d.get('sw')}, 방문 단추 {d.get('button')}" + ("" if dok else f" — {json.dumps(d.get('issues', [])[:8], ensure_ascii=False)}")))
            if w in (390, 1366):
                await pg.goto(f"{base}/s/{school}/education"); await pg.wait_for_timeout(800)
                await flows(pg, base, school, w, results)
            await ctx.close()
        await b.close()
    for ok, msg in results:
        print(("통과 " if ok else "실패 ") + msg)
    passed = sum(1 for ok, _ in results if ok)
    print(f"결과: {passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
