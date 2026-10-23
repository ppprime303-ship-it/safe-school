# STEP 3-E 업무 담당자 화면 배치 점검(Playwright) — 실행 중인 앱 주소를 받아 320·360·390·430·1366px에서
# 같은 행 안 요소 겹침, 단추 글자 잘림(scrollWidth > clientWidth), 영역 밖으로 나감, 페이지 가로 스크롤을 측정합니다.
# 화면을 바꾸지 않고(단추를 누르지 않음) 읽기만 합니다. 로그인된 브라우저 상태가 필요하면 --storage 로 저장 상태 파일을 주세요.
# 사용: python3 tools/ui-checks/duties_layout.py http://127.0.0.1:5000 <학교ID> [출력폴더] [--storage state.json]
import asyncio, json, sys
from playwright.async_api import async_playwright

JS = """()=>{const sec=document.querySelector('section[aria-labelledby=duties-title]'); if(!sec) return {missing:true};
 const sr=sec.getBoundingClientRect(); const items=[];
 sec.querySelectorAll('[data-testid=duty-member]').forEach((li)=>{
  const btn=[...li.querySelectorAll('button')].map(b=>({t:b.innerText.trim(),r:b.getBoundingClientRect(),clip:b.scrollWidth>b.clientWidth+1}));
  const txt=[...li.querySelectorAll('p,span')].filter(s=>s.children.length===0&&s.innerText.trim()&&!s.closest('button')).map(s=>({t:s.innerText.trim(),r:s.getBoundingClientRect()}));
  const all=[...btn,...txt]; const ov=[];
  for(let a=0;a<all.length;a++)for(let b=a+1;b<all.length;b++){const A=all[a].r,B=all[b].r; if(A.left<B.right-1&&B.left<A.right-1&&A.top<B.bottom-1&&B.top<A.bottom-1) ov.push(all[a].t+' × '+all[b].t);}
  items.push({buttons:btn.map(x=>({t:x.t,w:Math.round(x.r.width),h:Math.round(x.r.height),clip:x.clip})),overlap:ov,outside:all.filter(x=>x.r.right>sr.right+0.5||x.r.left<sr.left-0.5).map(x=>x.t)});});
 return {sw:document.documentElement.scrollWidth,items}}"""

async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base, school = args[0], args[1]
    out = args[2] if len(args) > 2 else "."
    storage = sys.argv[sys.argv.index("--storage") + 1] if "--storage" in sys.argv else None
    failed = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in (320, 360, 390, 430, 1366):
            ctx = await b.new_context(viewport={"width": w, "height": 900}, storage_state=storage)
            pg = await ctx.new_page()
            await pg.goto(f"{base}/s/{school}/members")
            await pg.wait_for_timeout(1200)
            m = await pg.evaluate(JS)
            if m.get("missing"):
                print(f"{w}px: 업무 담당자 영역 없음(로그인·권한 확인)"); failed += 1; await ctx.close(); continue
            await pg.locator("section[aria-labelledby=duties-title]").screenshot(path=f"{out}/duties_{w}.png")
            bad = [it for it in m["items"] if it["overlap"] or it["outside"] or any(x["clip"] for x in it["buttons"]) or any(x["h"] < 44 for x in it["buttons"])]
            ok = not bad and m["sw"] <= w
            failed += 0 if ok else 1
            print(f"{'통과' if ok else '실패'} {w}px: 행 {len(m['items'])}개, 페이지 폭 {m['sw']}" + ("" if ok else f" — {json.dumps(bad, ensure_ascii=False)[:400]}"))
            await ctx.close()
        await b.close()
    print(f"결과: {5 - failed}/5 통과")
    sys.exit(1 if failed else 0)

asyncio.run(main())
