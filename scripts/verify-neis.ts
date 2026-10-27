// 나이스 교육정보 개방 포털 실제 응답 확인(승인 후 실행): npm run neis:verify -- --name 안전초등학교 [--office B10]
// - 공개 학교기본정보만 조회합니다. 인증키·요청 주소의 키는 출력하지 않습니다.
// - 응답 형식(감싸는 구조·필수 필드)이 어댑터 가정과 맞는지, 행 수·버린 행 수·필드 이름만 보여 줍니다(값은 학교명·교육청 코드만).
// - 맞으면 server/src/integrations/neis.ts 의 NEIS_CONTRACT.verified 를 true 로 바꾸고 docs/integrations 에 시각·결과를 기록합니다.
import { createNeisClient, NeisError } from "../server/src/integrations/neis.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apiKey = process.env.NEIS_API_KEY?.trim();
  if (!apiKey) {
    console.error("NEIS_API_KEY 를 환경변수에 넣어 주세요(값은 출력되지 않습니다). 키 없이 부르면 샘플 5건만 나와 확인할 수 없습니다.");
    process.exitCode = 1;
    return;
  }
  const name = flag("name");
  const officeCode = flag("office");
  if (!name && !officeCode) {
    console.error("--name <학교명> 또는 --office <시도교육청코드> 를 주세요.");
    process.exitCode = 1;
    return;
  }
  const client = createNeisClient({ apiKey, timeoutMs: 20_000, retries: 0 });
  const started = new Date();
  try {
    const r = await client.searchSchools({ name, officeCode });
    console.log(`[나이스 학교기본정보] ${started.toISOString()} 응답 ${r.schools.length}건, 형식이 맞지 않아 버린 행 ${r.rejected}건`);
    for (const s of r.schools.slice(0, 10)) console.log(`  - ${s.name} · 교육청 ${s.officeCode}(${s.officeName ?? "?"}) · 학교코드 ${s.schoolCode} · ${s.kindName ?? "?"}`);
    console.log("결론: 어댑터가 가정한 응답 구조로 해석되었습니다. NEIS_CONTRACT.verified 갱신 여부를 검토하세요.");
  } catch (error) {
    console.log(`[나이스 학교기본정보] 실패: ${error instanceof NeisError ? `${error.kind}${error.code ? ` ${error.code}` : ""} — ${error.message}` : "알 수 없는 오류"}`);
    process.exitCode = 1;
  }
}

void main();
