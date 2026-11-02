#!/usr/bin/env node
// 긴급재난문자 일회성 응답 확인. 등록된 서버 IP에서 사용자 승인 후 직접 실행합니다(Node 18 이상, 의존성 없음).
//   node mois-verify-once.mjs --dry-run   호출·키 입력 없이 계획만 표시
//   node mois-verify-once.mjs             숨김 입력으로 키를 받아 공식 API를 정확히 1회 호출
// - 재시도 없음. 파일·DB에 저장하지 않고 앱·서비스 설정을 읽거나 바꾸지 않습니다.
// - 키는 명령행 인자·환경변수·셸 기록을 쓰지 않습니다. 문자 본문은 출력하지 않고 길이만 표시합니다.
import { pathToFileURL } from "node:url";

const ENDPOINT = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247";
const REQUIRED = ["SN", "CRT_DT", "MSG_CN", "RCPTN_RGN_NM", "EMRG_STEP_NM"];

export function kstYmd(now, daysAgo = 0) {
  return new Date(now.getTime() + 9 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildUrl(key, now) {
  const k = key.includes("%") ? key : encodeURIComponent(key);
  return `${ENDPOINT}?serviceKey=${k}&returnType=json&pageNo=1&numOfRows=100&crtDt=${kstYmd(now, 1)}`;
}

/** 응답 요약(순수 함수). 문자 본문은 넣지 않습니다. */
export function summarize(httpStatus, text) {
  const out = [`HTTP ${httpStatus}`];
  if (text.trimStart().startsWith("<")) {
    const code = /<returnReasonCode>\s*(\d{1,3})/.exec(text)?.[1] ?? "-";
    const name = /<returnAuthMsg>\s*([A-Z_ ]{1,80})/.exec(text)?.[1]?.trim() ?? "-";
    return [...out, `XML 게이트웨이 응답: 코드 ${code} ${name}`, "판정: 정상 응답 아님"];
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [...out, "판정: JSON 아님"];
  }
  const code = String(data?.header?.resultCode ?? "-").slice(0, 10);
  out.push(`최상위 필드: ${Object.keys(data ?? {}).join(", ")}`);
  out.push(`결과 코드: ${code} ${String(data?.header?.resultMsg ?? "").replace(/[^\w .-]/g, "").slice(0, 80)}`);
  out.push(`전체 건수: ${String(data?.totalCount ?? "?").slice(0, 12)}`);
  if (!["00", "0"].includes(code)) return [...out, "판정: 정상 응답 아님"];
  const rows = Array.isArray(data.body) ? data.body : null;
  if (!rows) return [...out, `body 형태: ${typeof data.body}`, "판정: body 배열 아님(형식 확인 필요)"];
  out.push(`받은 건수: ${rows.length}`);
  const first = rows[0] ?? {};
  out.push(`항목 필드: ${Object.keys(first).join(", ") || "(항목 없음)"}`);
  const missing = rows.length ? REQUIRED.filter((f) => rows.some((r) => r?.[f] === undefined || r?.[f] === null || r?.[f] === "")) : [];
  out.push(`필수 항목 빠진 필드: ${missing.join(", ") || "없음"}`);
  out.push(`SN 고유: ${new Set(rows.map((r) => String(r?.SN))).size}/${rows.length}`);
  const times = rows.map((r) => String(r?.CRT_DT ?? "").replace(/\D/g, ""));
  const desc = times.every((t, i) => i === 0 || times[i - 1] >= t);
  const asc = times.every((t, i) => i === 0 || times[i - 1] <= t);
  out.push(`정렬: ${rows.length < 2 ? "판단 불가" : desc ? "최신순" : asc ? "오래된순" : "일정하지 않음"}`);
  out.push(`CRT_DT 예: ${String(first.CRT_DT ?? "-").slice(0, 30)}`);
  const steps = {};
  for (const r of rows) steps[String(r?.EMRG_STEP_NM ?? "-").slice(0, 20)] = (steps[String(r?.EMRG_STEP_NM ?? "-").slice(0, 20)] ?? 0) + 1;
  out.push(`긴급단계: ${Object.entries(steps).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}`);
  const incheon = [...new Set(rows.map((r) => String(r?.RCPTN_RGN_NM ?? "")).filter((a) => a.includes("인천")).map((a) => a.slice(0, 60)))];
  out.push(`인천 관련 지역 표기 ${incheon.length}종: ${incheon.slice(0, 8).join(" / ") || "없음"}`);
  out.push(`전국 표기 건수: ${rows.filter((r) => String(r?.RCPTN_RGN_NM ?? "").includes("전국")).length}`);
  const lengths = rows.map((r) => String(r?.MSG_CN ?? "").length);
  out.push(`MSG_CN: 내용 있는 건수 ${lengths.filter(Boolean).length}, 최대 길이 ${lengths.length ? Math.max(...lengths) : 0}(본문 출력 안 함)`);
  out.push("판정: 정상 응답");
  return out;
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("터미널에서 직접 실행해야 합니다(키를 파이프로 받지 않습니다)."));
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          return reject(new Error("취소했습니다. 호출하지 않았습니다."));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const now = new Date();
  console.log(`[계획] GET ${ENDPOINT} 1회, 재시도 없음, 저장 없음, 조회시작일 ${kstYmd(now, 1)}, Node ${process.version}`);
  if (process.argv.includes("--dry-run")) return;
  if (typeof fetch !== "function") throw new Error("Node 18 이상이 필요합니다. 호출하지 않았습니다.");
  const key = await readHidden("MOIS_CBS_SERVICE_KEY(표시되지 않음): ");
  if (!key) throw new Error("키가 비어 있어 호출하지 않았습니다.");
  const mask = (s) => s.split(key).join("***").split(encodeURIComponent(key)).join("***");
  let res;
  try {
    res = await fetch(buildUrl(key, now), { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
  } catch (error) {
    throw new Error(error?.name === "TimeoutError" ? "응답 시간 초과(재시도하지 않음)" : "연결 실패(재시도하지 않음)");
  }
  for (const line of summarize(res.status, await res.text())) console.log(mask(line));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[중단] ${error.message}`);
    process.exitCode = 1;
  });
}
