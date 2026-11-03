// Beta PILOT 2 시범운영 안내 배너(모든 화면 상단 공통). 짧은 두 줄: 시범운영 중 · 개인정보 입력 금지.
// 공식 재난 대응 체계를 대체하지 않는다는 안전 안내는 OfficialSystemNotice 로 화면마다 따로 둡니다(로그인 화면·앱 본문 하단).
// 개발 버전 표기는 배포 여부·시점과 무관합니다(shared/release.ts). 데이터 구분은 서버 설정을 따릅니다(data-mode 속성).
import { RELEASE, type DataMode } from "@shared/release";
import { useDataMode } from "../../lib/dataMode";
import { Icon } from "./Icon";

export const RELEASE_LABEL = `${RELEASE.product} · ${RELEASE.devVersion} · ${RELEASE.stage}`;
export const PILOT_NOTICE_TITLE = "제한적 시범운영 중";
export const PILOT_NOTICE_TEXT = "교직원 및 학생의 개인정보는 입력하지 마세요.";
export const OFFICIAL_SYSTEM_NOTICE = "실제 학교의 공식 재난 대응 체계, 119 신고, 기존 비상연락망을 대체하지 않습니다.";

export function ReleaseNoticeView({ compact = false, mode }: { compact?: boolean; mode: DataMode | null }) {
  return (
    <div
      role="note"
      aria-label={`${PILOT_NOTICE_TITLE}. ${PILOT_NOTICE_TEXT}`}
      data-mode={mode ?? "unknown"}
      className={`flex items-start gap-2.5 border-warning bg-warning-soft text-warning-strong ${compact ? "border-b px-4 py-2" : "rounded-control border-2 p-3"}`}
    >
      <Icon name="alert" size={compact ? 20 : 24} className="mt-0.5 shrink-0" />
      <p className={`min-w-0 leading-snug ${compact ? "text-sm sm:text-base" : "text-base"}`}>
        <strong className="block font-extrabold">{PILOT_NOTICE_TITLE}</strong>
        <span className="block break-keep">{PILOT_NOTICE_TEXT}</span>
      </p>
    </div>
  );
}

export function ReleaseNotice({ compact = false }: { compact?: boolean }) {
  return <ReleaseNoticeView compact={compact} mode={useDataMode()} />;
}

/** 공식 체계 비대체 안전 안내(배너와 분리된 상세 안내 영역). 버전 표기를 함께 보여 줍니다 */
export function OfficialSystemNotice({ className = "" }: { className?: string }) {
  return (
    <p role="note" className={`text-center text-sm text-ink-muted ${className}`}>
      <span className="font-semibold">{RELEASE_LABEL}</span> · {OFFICIAL_SYSTEM_NOTICE}
    </p>
  );
}
