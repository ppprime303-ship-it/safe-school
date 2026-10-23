// 훈련일지 A4 미리보기: 서버 HWPX와 같은 배치(shared/drillLog.ts buildDrillDoc)를 HTML 표로 그립니다.
// 인쇄(PDF로 저장)는 이 미리보기만 출력합니다. 한글(HWPX)과 글꼴·줄바꿈이 조금 다를 수 있습니다.
// STEP 3-E: 화면 폭이 A4(210mm)보다 좁으면(모바일) 쪽 전체를 화면 폭에 맞게 축소해 가로 스크롤 없이 봅니다. 인쇄할 때는 원래 크기.
import { useEffect, useRef, useState } from "react";
import type { DrillDoc, LTable } from "@shared/drillLog";
import { TABLE_W } from "@shared/drillLog";

const A4_PX = (210 / 25.4) * 96; // 약 794px

function useFitScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? A4_PX;
      const s = Math.min(1, Math.max(0.3, w / A4_PX));
      el.style.setProperty("--fit", String(s)); // 자식 쪽(.drill-page)이 zoom에 사용
      setScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

const FILL = { label: "#F2F2F2", head: "#F2F2F2", band: "#E4E4E4", value: "#FFFFFF" } as const;

function Table({ t }: { t: LTable }) {
  const nrow = t.rowsMm.length;
  const ncol = t.colPct.length;
  return (
    <table className="drill-table" style={{ width: `${TABLE_W}mm`, borderCollapse: "collapse", tableLayout: "fixed", fontSize: "10pt", lineHeight: 1.3 }}>
      <colgroup>
        {t.colPct.map((p, i) => (
          <col key={i} style={{ width: `${p}%` }} />
        ))}
      </colgroup>
      <tbody>
        {t.rowsMm.map((h, r) => (
          <tr key={r} style={{ height: `${h}mm` }}>
            {t.cells
              .filter((c) => c.r === r)
              .sort((a, b) => a.c - b.c)
              .map((c) => (
                <td
                  key={c.c}
                  colSpan={c.cs}
                  rowSpan={c.rs}
                  style={{
                    background: FILL[c.kind],
                    textAlign: c.align === "L" ? "left" : c.align === "R" ? "right" : "center",
                    verticalAlign: c.valign === "T" ? "top" : "middle",
                    fontWeight: c.bold ? 700 : 400,
                    padding: "0.6mm 1.6mm",
                    whiteSpace: "pre-wrap",
                    overflow: "hidden",
                    borderLeft: `${c.c === 0 ? "0.4mm" : "0.12mm"} solid #000`,
                    borderRight: `${c.c + c.cs === ncol ? "0.4mm" : "0.12mm"} solid #000`,
                    borderTop: `${c.r === 0 ? "0.4mm" : "0.12mm"} solid #000`,
                    borderBottom: `${c.r + c.rs === nrow ? "0.4mm" : "0.12mm"} solid #000`,
                    color: "#000",
                  }}
                >
                  {c.text}
                </td>
              ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DrillDocPreview({ doc }: { doc: DrillDoc }) {
  const { ref, scale } = useFitScale();
  return (
    <div ref={ref} className="drill-print space-y-4 overflow-x-auto">
      {scale < 1 && <p className="text-sm text-ink-muted print:hidden">화면 폭에 맞춰 {Math.round(scale * 100)}%로 줄여 보여 줍니다(인쇄·한글 파일은 원래 크기).</p>}
      {doc.pages.map((p, i) => (
        <section
          key={i}
          aria-label={`${i + 1}쪽 미리보기`}
          className="drill-page mx-auto bg-white shadow-card [zoom:var(--fit)] print:[zoom:1]"
          style={{ width: "210mm", minHeight: "297mm", padding: "12mm 15mm", color: "#000", fontFamily: '"맑은 고딕","Malgun Gothic","Noto Sans KR",sans-serif'}}
        >
          {p.titleKind === "main" ? (
            <>
              <h2 style={{ textAlign: "center", fontSize: "20pt", fontWeight: 700, margin: "0 0 4mm" }}>{p.title}</h2>
              <p style={{ textAlign: "right", fontSize: "11pt", fontWeight: 700, margin: "0 0 1.5mm" }}>{p.subtitle}</p>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "13pt", fontWeight: 700, margin: "0 0 1.5mm" }}>{p.title}</h2>
              <p style={{ fontSize: "10pt", margin: "0 0 2mm" }}>{p.subtitle}</p>
            </>
          )}
          <Table t={p.table} />
          {p.footnote && <p style={{ fontSize: "9pt", marginTop: "1.5mm", lineHeight: 1.3, whiteSpace: "pre-wrap" }}>{p.footnote}</p>}
        </section>
      ))}
    </div>
  );
}
