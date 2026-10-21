// STEP 3-C 학교 안내문 데이터 형태(서버 server/src/services/notices.ts 와 같음)
export type NoticeStatus = "draft" | "completed" | "cancelled";

export const NOTICE_STATUS_META: Record<NoticeStatus, { label: string; badge: string }> = {
  draft: { label: "작성 중", badge: "bg-warning-soft text-warning-strong border border-warning" },
  completed: { label: "작성 완료", badge: "bg-success-soft text-success border border-success" },
  cancelled: { label: "취소됨", badge: "bg-neutral-soft text-neutral border border-line-strong" },
};

export const CHANNEL_LABEL = { sms: "문자", school_app: "학교 알림 앱", kakao: "카카오톡", other: "기타" } as const;
export type ChannelKey = keyof typeof CHANNEL_LABEL;

export interface NoticeSummary {
  id: string;
  alertId: string;
  title: string;
  status: NoticeStatus;
  version: number;
  exampleKey: string | null;
  sourceNoticeId: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  createdById: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  alert: { title: string; issuedAt: string; isMock: boolean };
}

export interface NoticeAlertState {
  id: string;
  title: string | null;
  body: string;
  issuer: string;
  areasRaw: string;
  msgType: string;
  isMock: boolean;
  issuedAt: string;
  expiresAt: string | null;
  cancelled: boolean;
  expired: boolean;
}

export interface NoticeDetail {
  notice: {
    id: string;
    alertId: string;
    title: string;
    body: string;
    status: NoticeStatus;
    version: number;
    exampleKey: string | null;
    exampleVersion: number | null;
    sourceNoticeId: string | null;
    createdById: string | null;
    createdByName: string | null;
    updatedByName: string | null;
    createdAt: string;
    updatedAt: string;
    cancelledAt: string | null;
    cancelReason: string | null;
  };
  schoolName: string;
  canEdit: boolean;
  alert: NoticeAlertState;
  source: { id: string; title: string; cancelledAt: string | null; cancelReason: string | null; sameAlert: boolean } | null;
  reusedBy: { id: string; title: string; status: NoticeStatus; createdAt: string }[];
  revisions: { version: number; title: string; body: string; status: NoticeStatus; exampleKey: string | null; changedAt: string; changedByName: string | null }[];
  records: {
    id: string;
    channel: ChannelKey | null;
    channelNote: string | null;
    audienceCategory: string | null;
    sentByTeacher: boolean;
    sentAt: string | null;
    memo: string | null;
    recordedById: string | null;
    recordedByName: string | null;
    recordedAt: string;
    voidedAt: string | null;
    voidReason: string | null;
  }[];
}

export interface ReuseResult {
  id: string;
  created: boolean;
  alertId: string;
  warnings: { code: "alert_cancelled" | "alert_expired" | "alert_changed" | "past_content"; message: string }[];
}

/** 클립보드 복사: 지원하지 않거나 거부되면 false(화면에서 직접 선택하도록 안내) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 방법으로 다시 시도 */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
