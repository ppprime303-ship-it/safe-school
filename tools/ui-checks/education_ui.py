# STEP 4 안전교육 자료 화면 점검(Playwright) — 실행 중인 앱 주소를 받아 읽기·필터 조작만 합니다(외부 사이트를 열지 않음, 저장 없음).
#  1) 320·360·390·430·768·1366px: 페이지 가로 스크롤, 카드 열 수(768px 미만 1열 / 이상 2열), 카드 안 요소 겹침·영역 밖으로 나감,
#     단추·링크 글자 잘림, 터치 높이 44px 이상, 머리글(제목·교육자료·로그아웃) 겹침
#  2) 390·1366px: 학교급·영역 필터, 검색, 결과 없음 안내, 필터 초기화, 외부 링크 속성(새 탭·noopener noreferrer·공식 도메인)
# 사용: python3 tools/ui-checks/education_ui.py http://127.0.0.1:5000 <학교ID> [출력폴더] [--storage state.json]
import asyncio, json, sys
from playwright.async_api import async_playwright

WIDTHS = (320, 360, 390, 430, 768, 1366)
HOSTS = ("https://www.schoolsafe24.or.kr/", "https://kasem.safekorea.go.kr/")

LAYOUT_JS = """()=>{
 const main=document.querySelector('main'); if(!main||!document.querySelector('#edu-title')) return {missing:true};
 const cards=[...document.querySelectorAll('[data-testid=edu-card]')];
 const tops=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top)));
 const perRow=cards.length? cards.filter(c=>Math.round(c.getBoundingClientRect().top)===Math.min(...tops)).length:0;
 const issues=[];
 const ov=(A,B)=>A.left<B.right-1&&B.left<A.right-1&&A.top<B.bottom-1&&B.top<A.bottom-1;
 for(const c of cards){ const cr=c.getBoundingClientRect();
  const leaf=[...c.querySelectorAll('h3,p,li,dd,a,summary')].filter(e=>e.offsetParent!==null);
  for(const e of leaf){const r=e.getBoundingClientRect(); if(r.right>cr.right+0.5||r.left<cr.left-0.5) issues.push('영역 밖: '+e.innerText.slice(0,20));}
  const blocks=[...c.children].filter(e=>e.offsetParent!==null);
  for(let a=0;a<blocks.length;a++)for(let b=a+1;b<blocks.length;b++) if(ov(blocks[a].getBoundingClientRect(),blocks[b].getBoundingClientRect())) issues.push('겹침: '+blocks[a].tagName+'×'+blocks[b].tagName);
  const acts=[...c.querySelectorAll('a')]; for(let a=0;a<acts.length;a++)for(let b=a+1;b<acts.length;b++) if(ov(acts[a].getBoundingClientRect(),acts[b].getBoundingClientRect())) issues.push('링크 겹침');
 }
 const ctrls=[...main.querySelectorAll('button,a,input,summary')].filter(e=>e.offsetParent!==null);
 for(const e of ctrls){const r=e.getBoundingClientRect(); if(r.height<44) issues.push('터치 높이 '+Math.round(r.height)+': '+(e.innerText||e.getAttribute('aria-label')||e.tagName).slice(0,20));
  if(e.tagName!=='INPUT'&&e.scrollWidth>e.clientWidth+1) issues.push('글자 잘림: '+e.innerText.slice(0,20));
  if(r.right>main.getBoundingClientRect().right+0.5) issues.push('본문 밖: '+(e.innerText||e.tagName).slice(0,20));}
 const head=document.querySelector('header'); const hk=[...head.querySelectorAll('h1,a,button')].filter(e=>e.offsetParent!==null);
 for(let a=0;a<hk.length;a++)for(let b=a+1;b<hk.length;b++) if(ov(hk[a].getBoundingClientRect(),hk[b].getBoundingClientRect())) issues.push('머리글 겹침: '+hk[a].tagName+'×'+hk[b].tagName);
 const eduHeader=head.querySelector('a[href$="/education"]'); const eduSide=document.querySelector('nav a[href$="/education"]');
 return {sw:document.documentElement.scrollWidth, cards:cards.length, perRow, issues,
   entry:{header:!!(eduHeader&&eduHeader.offsetParent), sidebar:!!(eduSide&&eduSide.offsetParent)},
   bottomNav:[...document.querySelectorAll('nav.fixed a')].map(a=>a.innerText.trim())};
}"""

async def count(pg):
    return int(await pg.locator("[data-testid=edu-count]").inner_text())

async def flows(pg, w, results):
    def check(name, ok, detail=""):
        results.append((ok, f"{w}px {name}" + ("" if ok else f" — {detail}")))
    total = await count(pg)
    check("처음 전체 표시", total >= 1 and await pg.locator("[data-testid=edu-card]").count() == total, total)
    # 외부 링크 속성
    links = await pg.locator("[data-testid=edu-external-link]").evaluate_all("as=>as.map(a=>({h:a.href,t:a.target,r:a.rel}))")
    bad = [l for l in links if l["t"] != "_blank" or "noopener" not in l["r"] or "noreferrer" not in l["r"] or not l["h"].startswith(HOSTS)]
    check("외부 링크 새 탭·noopener noreferrer·공식 도메인", links and not bad, bad)
    # 학교급
    await pg.get_by_role("group", name="학교급 선택").get_by_role("button", name="유치원").click()
    lv = await count(pg)
    pressed = await pg.get_by_role("group", name="학교급 선택").get_by_role("button", name="유치원").get_attribute("aria-pressed")
    check("학교급 필터(유치원)", pressed == "true" and 0 < lv <= total, (pressed, lv))
    # 영역(응급처치 → 학교안전지원시스템만)
    await pg.get_by_role("group", name="안전교육 영역 선택").get_by_role("button", name="응급처치").click()
    names = await pg.locator("[data-testid=edu-card] h3").all_inner_texts()
    check("영역 필터(응급처치)", names == ["학교안전지원시스템 · 안전교육 자료실"], names)
    # 초기화
    await pg.get_by_role("button", name="필터 초기화").first.click()
    check("필터 초기화", await count(pg) == total and await pg.get_by_role("button", name="필터 초기화").count() == 0)
    # 영역별 찾는 방법
    await pg.get_by_role("group", name="안전교육 영역 선택").get_by_role("button", name="폭력예방 및 신변보호").click()
    guide = await pg.locator("[data-testid=edu-area-guide]").all_inner_texts()
    check("영역별 찾는 방법(범죄안전)", any("범죄안전" in g for g in guide), guide)
    await pg.get_by_role("button", name="필터 초기화").first.click()
    # 검색
    box = pg.get_by_role("searchbox", name="사이트명·주제 검색")
    await box.fill("체험관")
    names = await pg.locator("[data-testid=edu-card] h3").all_inner_texts()
    check("검색(체험관)", names == ["국민안전교육플랫폼"], names)
    await box.fill("없는검색어xyz")
    empty = await pg.locator("[data-testid=edu-empty]").inner_text() if await pg.locator("[data-testid=edu-empty]").count() else ""
    check("검색 결과 없음 안내", "현재 확인된 자료가 없습니다" in empty and await count(pg) == 0, empty[:60])
    await pg.locator("[data-testid=edu-empty]").get_by_role("button", name="필터 초기화").click()
    check("결과 없음에서 초기화", await count(pg) == total and await box.input_value() == "")

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
            await pg.goto(f"{base}/s/{school}/education")
            await pg.wait_for_timeout(1000)
            m = await pg.evaluate(LAYOUT_JS)
            if m.get("missing"):
                results.append((False, f"{w}px 화면 없음(로그인·승인 상태 확인)")); await ctx.close(); continue
            await pg.screenshot(path=f"{out}/education_{w}.png", full_page=True)
            want_cols = 1 if w < 768 else 2
            entry_ok = m["entry"]["header"] if w < 1024 else m["entry"]["sidebar"]
            ok = m["sw"] <= w and not m["issues"] and m["perRow"] == min(want_cols, m["cards"]) and entry_ok
            results.append((ok, f"{w}px 배치: 페이지 폭 {m['sw']}, 카드 {m['cards']}개·한 줄 {m['perRow']}개, 메뉴 진입({'머리글' if w < 1024 else '좌측 메뉴'}) {entry_ok}, 하단 메뉴 {m['bottomNav']}"
                            + ("" if ok else f" — {json.dumps(m['issues'][:8], ensure_ascii=False)}")))
            if w in (390, 1366):
                await flows(pg, w, results)
            await ctx.close()
        await b.close()
    for ok, msg in results:
        print(("통과 " if ok else "실패 ") + msg)
    passed = sum(1 for ok, _ in results if ok)
    print(f"결과: {passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
