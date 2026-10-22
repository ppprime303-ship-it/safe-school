// 훈련일지 A4 미리보기: 서버 HWPX와 같은 배치(shared/drillLog.ts buildDrillDoc)를 HTML 표로 그립니다.
// 인쇄(PDF로 저장)는 이 미리보기만 출력합니다. 한글(HWPX)과 글꼴·줄바꿈이 조금 다를 수 있습니다.
import type { DrillDoc, LTable } from "@shared/drillLog";
import { TABLE_W } from "@shared/drillLog";

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
  return (
    <div className="drill-print space-y-4 overflow-x-auto">
      {doc.pages.map((p, i) => (
        <section
          key={i}
          aria-label={`${i + 1}쪽 미리보기`}
          className="drill-page mx-auto bg-white shadow-card"
          style={{ width: "210mm", minHeight: "297mm", padding: "12mm 15mm", color: "#000", fontFamily: '"맑은 고딕","Malgun Gothic","Noto Sans KR",sans-serif' }}
        >
          {p.titleKind === "main" ? (
            <>
              <h2 style={{ textAlign: "center", fontSize: "20pt", fontWeight: 700, margin: "0 0 4mm" }}>{p.title}</h2>
              <p style={{ textAlign: "right", fontSize: "11pt", fontWeight: 700, margin: "0 0 1.5mm" }}>{p.subtitle}</p>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "13pt", fontWeight: 700, margin: "0 0 1.5mm" }}>{p.title}</h2>
              <p style={{ fontSize: "10pt", margin: "0 0 1.5mm" }}>{p.subtitle}</p>
            </>
          )}
          <Table t={p.table} />
          {p.footnote && <p style={{ fontSize: "9pt", marginTop: "1.5mm" }}>{p.footnote}</p>}
        </section>
      ))}
    </div>
  );
}
