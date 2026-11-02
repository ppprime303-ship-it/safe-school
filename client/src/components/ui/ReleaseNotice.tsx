// Beta PILOT 2 시범운영 안내(모든 화면 공통). 정식 서비스가 아니며 공식 체계를 대체하지 않음을 항상 보이게 둡니다.
// 개발 버전 표기는 배포 여부·시점과 무관합니다(shared/release.ts). 데이터 구분은 서버 설정을 따릅니다.
import { RELEASE, type DataMode } from "@shared/release";
import { useDataMode } from "../../lib/dataMode";

export const RELEASE_LABEL = `${RELEASE.product} · ${RELEASE.devVersion} · ${RELEASE.stage}`;
export const OFFICIAL_SYSTEM_NOTICE = "실제 학교의 공식 재난 대응 체계, 119 신고, 기존 비상연락망을 대체하지 않습니다.";
export const DATA_MODE_NOTICE: Record<DataMode, { label: string; text: string }> = {
  virtual_test: { label: "승인된 가상 데이터 테스트", text: "실제 학교·교직원·학생 정보를 입력하지 마세요." },
  school_pilot: { label: "실제 학교 시범운영", text: "학생 개인정보는 입력하지 마세요." },
};

export function ReleaseNoticeView({ compact = false, mode }: { compact?: boolean; mode: DataMode | null }) {
  const data = mode ? DATA_MODE_NOTICE[mode] : null;
  return (
    <p role="note" data-mode={mode ?? "unknown"} className={`border-warning bg-warning-soft text-warning-strong ${compact ? "border-b px-4 py-1.5 text-xs sm:text-sm" : "rounded-control border-2 p-3 text-sm"}`}>
      <strong>{RELEASE_LABEL}</strong>
      {data && (
        <>
          {" · "}
          <strong>{data.label}</strong>
        </>
      )}{" "}
      · {OFFICIAL_SYSTEM_NOTICE} {data?.text ?? "실제 학생 개인정보는 입력하지 마세요."}
    </p>
  );
}

export function ReleaseNotice({ compact = false }: { compact?: boolean }) {
  return <ReleaseNoticeView compact={compact} mode={useDataMode()} />;
}
