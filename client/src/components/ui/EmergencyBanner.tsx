// 재난 상황 배너: 실제/훈련을 색과 '문구'로 모두 구분하고, 화면 상단에 고정합니다.
import { DISASTER_TYPES } from "@shared/constants";
import type { ActiveEvent } from "../../lib/disaster";
import { formatElapsed, formatTime } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { Icon } from "./Icon";

export function EmergencyBanner({ event }: { event: ActiveEvent }) {
  const now = useNow(1000);
  const real = event.mode === "real";
  const types = event.types.map((t) => DISASTER_TYPES[t]).join(" + ");
  return (
    <section
      role="alert"
      aria-live="assertive"
      className={`sticky top-0 z-40 text-white ${real ? "bg-danger" : "bg-warning"}`}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-md border-2 border-white px-2 py-0.5 text-base font-extrabold tracking-tight ${real ? "" : "bg-warning-strong"}`}>
          <Icon name={real ? "siren" : "info"} size={20} />
          {real ? "실제 상황" : "훈련 상황 · 실제 아님"}
        </span>
        <strong className="text-xl font-extrabold">{types}</strong>
        {event.evacPlace && (
          <span className="text-base font-semibold">
            대피 장소: <strong className="font-extrabold">{event.evacPlace}</strong>
          </span>
        )}
        <span className="tabular ml-auto text-base font-semibold">
          발령 {formatTime(event.startedAt)} · 경과 {formatElapsed(event.startedAt, now)}
        </span>
      </div>
    </section>
  );
}
