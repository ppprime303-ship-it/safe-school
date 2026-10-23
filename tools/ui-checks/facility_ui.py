# STEP 5 시설 안전점검 자료 화면 점검(Playwright) — 실행 중인 앱에서 읽기·필터 조작·화면 이동만(외부 사이트를 열지 않음, 저장 없음)
#  1) 320·360·390·430·768·1366px
#     목록: 가로 스크롤, 카드 열 수(768 미만 1열/이상 2열), 드롭다운 배치(640 미만 세로), 선택값 잘림, 카드·배지 겹침/밖, 44px 터치,
#           머리글 겹침, 하단 메뉴와 마지막 내용 겹침, 관할 교육청·최근 개정 영역 표시, 진입 경로(모바일 머리글/PC 좌측 메뉴)
#     상세: 가로 스크롤, 제목 여백, 원문 단추 높이·위치
#  2) 390·1366px 흐름: 지역·분야 드롭다운, 복합 필터, 초기화, 결과 없음, '국가 공통 법령 보기', '전체 보기', 카드 → 내부 상세,
#     원문 단추 보안 속성, 목록으로 돌아가기·브라우저 뒤로·새로고침(상태 유지), 없는 ID, 키보드(Tab → Enter)로 카드 열기
# 사용: python3 tools/ui-checks/facility_ui.py http://127.0.0.1:5000 <학교ID> [출력폴더] [--storage state.json] [--expect-office 인천광역시교육청]
import asyncio, json, sys
from playwright.async_api import async_playwright

WIDTHS = (320, 360, 390, 430, 768, 1366)
HOSTS = ("https://www.law.go.kr/", "https://www.goe.go.kr/", "https://www.ice.go.kr/", "https://www.jbe.go.kr/", "https://www.koies.or.kr/", "https://www.cpf.go.kr/")

COMMON = """
const ov=(A,B)=>A.left<B.right-1&&B.left<A.right-1&&A.top<B.bottom-1&&B.top<A.bottom-1;
const vis=e=>e.offsetParent!==null;
function controls(root, issues){
 for(const e of [...root.querySelectorAll('button,a,input,select,summary')].filter(vis)){const r=e.getBoundingClientRect();
  if(r.height<44) issues.push('터치 높이 '+Math.round(r.height)+': '+(e.innerText||e.getAttribute('aria-label')||e.tagName).slice(0,20));
  if(!['INPUT','SELECT'].includes(e.tagName)&&e.scrollWidth>e.clientWidth+1) issues.push('글자 잘림: '+e.innerText.slice(0,20));
  const rr=root.getBoundingClientRect(); if(r.right>rr.right+0.5||r.left<rr.left-0.5) issues.push('본문 밖: '+(e.innerText||e.tagName).slice(0,20));}
 const head=document.querySelector('header'); const hk=[...head.querySelectorAll('h1,a,button')].filter(vis);
 for(let a=0;a<hk.length;a++)for(let b=a+1;b<hk.length;b++) if(ov(hk[a].getBoundingClientRect(),hk[b].getBoundingClientRect())) issues.push('머리글 겹침');
}
"""

LIST_JS = "async ()=>{" + COMMON + """
 const main=document.querySelector('main'); if(!main||!document.querySelector('#fac-title')) return {missing:true};
 const issues=[]; controls(main, issues);
 const cards=[...document.querySelectorAll('[data-testid=fac-card]')];
 const firstGrid=cards[0]?.closest('ul'); const inGrid=cards.filter(c=>c.closest('ul')===firstGrid);
 const top0=Math.min(...inGrid.map(c=>Math.round(c.getBoundingClientRect().top)));
 const perRow=inGrid.filter(c=>Math.round(c.getBoundingClientRect().top)===top0).length;
 for(const c of cards){const cr=c.getBoundingClientRect();
  for(const e of [...c.querySelectorAll('span,svg')].filter(e=>e.getClientRects().length&&!e.classList.contains('sr-only'))){const r=e.getBoundingClientRect(); if(r.right>cr.right+0.5||r.left<cr.left-0.5) issues.push('카드 밖: '+(e.textContent||'').slice(0,15));}
  const b=[...c.querySelectorAll('.rounded-full')]; for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++) if(ov(b[i].getBoundingClientRect(),b[j].getBoundingClientRect())) issues.push('배지 겹침');}
 const sels=[...main.querySelectorAll('section[aria-label] select')]; const sr=sels.map(s=>s.getBoundingClientRect());
 const stacked=sr.length===2 && sr[1].top>=sr[0].bottom-1;
 const ctx=document.createElement('canvas').getContext('2d');
 for(const s of main.querySelectorAll('select')){ctx.font=getComputedStyle(s).font; if(ctx.measureText(s.options[s.selectedIndex].text).width > s.clientWidth-24) issues.push('선택값 잘림: '+s.value);}
 // 하단 메뉴(모바일 고정)와 마지막 내용 겹침: 맨 아래로 스크롤 후 비교
 window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(r=>setTimeout(r,80));
 const nav=document.querySelector('nav.fixed'); const last=main.lastElementChild?.lastElementChild;
 if(nav&&vis(nav)&&last){ if(last.getBoundingClientRect().bottom>nav.getBoundingClientRect().top+0.5) issues.push('하단 메뉴와 내용 겹침'); }
 window.scrollTo(0,0);
 const homeTxt=document.querySelector('[data-testid=fac-home]')?.innerText.split('\\n')[0]||'';
 const eduHeader=document.querySelector('header a[href$="/education"]'); const side=document.querySelector('nav a[href$="/facility-resources"]');
 return {sw:document.documentElement.scrollWidth, cards:cards.length, perRow, stacked, issues, homeTxt,
   recent:!!document.querySelector('[data-testid=fac-section-fac-recent]'),
   entry:{header:!!(eduHeader&&vis(eduHeader)&&eduHeader.getAttribute('aria-current')==='page'), sidebar:!!(side&&vis(side))}};
}"""

DETAIL_JS = "()=>{" + COMMON + """
 const main=document.querySelector('main'); const art=document.querySelector('article[aria-labelledby=fac-detail-title]'); if(!art) return {missing:true};
 const issues=[]; controls(main, issues); const ar=art.getBoundingClientRect();
 for(const e of [...art.querySelectorAll('h2,h3,p,li')].filter(vis)){const r=e.getBoundingClientRect(); if(r.right>ar.right+0.5) issues.push('상세 밖: '+e.innerText.slice(0,15));}
 const h=document.querySelector('#fac-detail-title').getBoundingClientRect(); if(h.right>ar.right-8) issues.push('제목 여백 침범');
 const btn=document.querySelector('[data-testid=fac-external-link]'); const b=btn&&btn.getBoundingClientRect();
 return {sw:document.documentElement.scrollWidth, issues, button:b?{h:Math.round(b.height),inside:b.left>=ar.left&&b.right<=ar.right}:null};
}"""

async def count(pg):
    return int(await pg.locator("[data-testid=fac-count]").inner_text())

async def titles(pg):
    return [t.split("\n")[0] for t in await pg.locator("[data-testid=fac-card]").all_inner_texts()]

async def flows(pg, base, school, w, results):
    def check(name, ok, detail=""):
        results.append((bool(ok), f"{w}px {name}" + ("" if ok else f" — {detail}")))
    region = pg.get_by_label("제공 기관·지역", exact=True)
    area = pg.get_by_label("시설 점검 분야", exact=True)
    box = pg.get_by_role("searchbox", name="법령명·매뉴얼명·기관명 검색")
    total = await count(pg)
    check("처음: 외부 링크 없음·카드 일부만(전체 보기)", await pg.locator("[data-testid=fac-external-link]").count() == 0 and await pg.locator("[data-testid=fac-card]").count() < total, total)
    await pg.get_by_role("button", name="법령 전체 보기(6)").click()
    check("법령 전체 보기", await pg.locator("[data-testid=fac-section-fac-national] [data-testid=fac-card]").count() == 6)
    await region.select_option("gyeonggi")
    check("지역 드롭다운(경기) → 경기 자료만·탐색 중 표시", await count(pg) == 2 and "region=gyeonggi" in pg.url and await pg.locator("[data-testid=fac-browsing]").count() == 1, (await count(pg), pg.url))
    await area.select_option("fire")
    check("분야 드롭다운 동시 적용", await titles(pg) == ["교육시설 안전관리 매뉴얼"], await titles(pg))
    await pg.get_by_role("button", name="국가 공통 법령 보기").click()
    check("국가 공통 법령 보기", await region.input_value() == "national" and await count(pg) == 6, (await region.input_value(), await count(pg)))
    await pg.get_by_role("button", name="필터 초기화").first.click()
    check("필터 초기화", await count(pg) == total and "?" not in pg.url, pg.url)
    await box.fill("없는검색어xyz")
    check("결과 없음 안내", await pg.locator("[data-testid=fac-empty]").count() == 1)
    await pg.locator("[data-testid=fac-empty]").get_by_role("button", name="필터 초기화").click()
    # 복합 → 상세
    await box.fill("매뉴얼"); await region.select_option("gyeonggi"); await area.select_option("fire")
    await pg.locator("[data-testid=fac-card]").first.click(); await pg.wait_for_timeout(300)
    t = await pg.locator("#fac-detail-title").inner_text() if await pg.locator("#fac-detail-title").count() else ""
    check("카드 → 내부 상세", "/facility-resources/gyeonggi-safety-manual" in pg.url and t == "교육시설 안전관리 매뉴얼" and len(pg.context.pages) == 1, (pg.url, t))
    a = await pg.locator("[data-testid=fac-external-link]").evaluate_all("as=>as.map(a=>({h:a.href,t:a.target,r:a.rel}))")
    check("원문 단추 하나·새 탭·noopener noreferrer·공식 도메인", len(a) == 1 and a[0]["t"] == "_blank" and "noopener" in a[0]["r"] and "noreferrer" in a[0]["r"] and a[0]["h"].startswith(HOSTS), a)
    await pg.locator("[data-testid=fac-back]").click(); await pg.wait_for_timeout(300)
    check("목록으로 돌아가기 → 상태 유지", await box.input_value() == "매뉴얼" and await region.input_value() == "gyeonggi" and await area.input_value() == "fire", pg.url)
    await pg.locator("[data-testid=fac-card]").first.click(); await pg.wait_for_timeout(300)
    await pg.go_back(); await pg.wait_for_timeout(500)
    check("브라우저 뒤로 가기 → 상태 유지", "/facility-resources/" not in pg.url and await region.input_value() == "gyeonggi" and await box.input_value() == "매뉴얼", pg.url)
    await pg.reload(); await pg.wait_for_timeout(800)
    check("새로고침 → 상태 복원", await area.input_value() == "fire" and await count(pg) == 1, pg.url)
    # 키보드: Tab 으로 카드에 초점 → Enter
    await pg.get_by_role("button", name="필터 초기화").first.click()
    card = pg.locator("[data-testid=fac-card]").first
    await card.focus(); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(300)
    check("키보드(초점 → Enter)로 카드 열기", "/facility-resources/" in pg.url, pg.url)
    await pg.goto(f"{base}/s/{school}/facility-resources/no-such"); await pg.wait_for_timeout(800)
    check("없는 자료 ID 안내", await pg.locator("[data-testid=fac-not-found]").count() == 1 and await pg.locator("[data-testid=fac-external-link]").count() == 0)

async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base, school = args[0], args[1]
    out = args[2] if len(args) > 2 else "."
    opt = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
    storage, expect_office = opt("--storage"), opt("--expect-office")
    results = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in WIDTHS:
            ctx = await b.new_context(viewport={"width": w, "height": 900}, storage_state=storage)
            pg = await ctx.new_page()
            await pg.goto(f"{base}/s/{school}/facility-resources"); await pg.wait_for_timeout(1000)
            m = await pg.evaluate(LIST_JS)
            if m.get("missing"):
                results.append((False, f"{w}px 화면 없음(로그인·승인 상태 확인)")); await ctx.close(); continue
            await pg.screenshot(path=f"{out}/fac_list_{w}.png", full_page=True)
            await pg.get_by_label("제공 기관·지역", exact=True).select_option("jeonnam-gwangju")
            await pg.get_by_label("시설 점검 분야", exact=True).select_option("playground")
            m2 = await pg.evaluate(LIST_JS)
            await pg.goto(f"{base}/s/{school}/facility-resources"); await pg.wait_for_timeout(600)
            want_cols = 1 if w < 768 else 2
            entry_ok = m["entry"]["header"] if w < 1024 else m["entry"]["sidebar"]
            home_ok = (expect_office in m["homeTxt"]) if expect_office else True
            issues = m["issues"] + m2["issues"]
            ok = m["sw"] <= w and not issues and m["perRow"] == min(want_cols, m["cards"]) and entry_ok and m["stacked"] == (w < 640) and m["recent"] and home_ok
            results.append((ok, f"{w}px 목록: 폭 {m['sw']}, 카드 {m['cards']}개·한 줄 {m['perRow']}개, 드롭다운 {'세로' if m['stacked'] else '나란히'}, 진입 {entry_ok}, 관할 '{m['homeTxt']}'"
                            + ("" if ok else f" — {json.dumps(issues[:8], ensure_ascii=False)}")))
            for rid in ("act", "gyeonggi-safety-manual"):
                await pg.goto(f"{base}/s/{school}/facility-resources/{rid}"); await pg.wait_for_timeout(700)
                d = await pg.evaluate(DETAIL_JS)
                await pg.screenshot(path=f"{out}/fac_detail_{rid}_{w}.png", full_page=True)
                dok = not d.get("missing") and d["sw"] <= w and not d["issues"] and d["button"] and d["button"]["h"] >= 48 and d["button"]["inside"]
                results.append((dok, f"{w}px 상세({rid}): 폭 {d.get('sw')}, 단추 {d.get('button')}" + ("" if dok else f" — {json.dumps(d.get('issues', [])[:6], ensure_ascii=False)}")))
            if w in (390, 1366):
                await pg.goto(f"{base}/s/{school}/facility-resources"); await pg.wait_for_timeout(800)
                await flows(pg, base, school, w, results)
            await ctx.close()
        await b.close()
    for ok, msg in results:
        print(("통과 " if ok else "실패 ") + msg)
    passed = sum(1 for ok, _ in results if ok)
    print(f"결과: {passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
