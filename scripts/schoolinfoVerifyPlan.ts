// 학교알리미 확인 도구의 호출 계획(네트워크 없음). 실제 호출 수를 실행 전에 확정하고 테스트로 고정합니다.
// 2026-11-02 실제 응답: 시군구 없는 요청은 "시군구 코드(sggCode)는 필수 정보입니다", apiType 09 는 "pbanYr은 필수 정보입니다".
import { API_TYPE_BASIC_INFO, API_TYPE_GRADE_CLASS_STUDENTS } from "../server/src/integrations/schoolinfo.js";
import { sggOf } from "../shared/schoolinfoRegions.js";

export interface SchoolinfoVerifyPlan {
  calls: { label: string; apiType: string; pbanYr?: number }[];
  kind: string;
  sgg: string;
  error: string | null;
}

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
};

export function planSchoolinfoVerify(argv: string[]): SchoolinfoVerifyPlan {
  const kind = flag(argv, "kind") ?? "02";
  const sgg = flag(argv, "sgg") ?? "";
  const pbanYr = Number(flag(argv, "pban-yr") ?? "");
  const known = /^\d{5}$/.test(sgg) && sggOf(sgg.slice(0, 2)).some(([code]) => code === sgg);
  if (!known) return { calls: [], kind, sgg, error: "--sgg 에 공식 코드표의 시군구 코드(5자리)를 지정해야 합니다. 호출하지 않았습니다." };
  const calls: SchoolinfoVerifyPlan["calls"] = [{ label: "학교기본정보", apiType: API_TYPE_BASIC_INFO }];
  if (!argv.includes("--basic-only") && Number.isInteger(pbanYr) && pbanYr > 2000) calls.push({ label: "학년별·학급별 학생수", apiType: API_TYPE_GRADE_CLASS_STUDENTS, pbanYr });
  return { calls, kind, sgg, error: null };
}
