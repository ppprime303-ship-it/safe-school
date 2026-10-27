// 로그인 / 가입 / 이메일 인증을 한 화면에서 전환합니다.
// 기기 종류(개인·공용)를 고르면 세션 유지 시간이 달라집니다(개인 30일, 공용 8시간·30분 미사용 시 만료).
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { FormField } from "../components/ui/FormField";
import { PrimaryButton } from "../components/ui/PrimaryButton";
import { Icon } from "../components/ui/Icon";

type Mode = "login" | "signup" | "verify";
type DeviceKind = "personal" | "shared";
type SendResult = { delivery?: "email" | "test_console"; devCode?: string };

export function LoginPage() {
  const { refresh, notice, clearNotice } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [deviceKind, setDeviceKind] = useState<DeviceKind>("personal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const fields = (e.details?.fields ?? {}) as Record<string, string>;
        setFieldErrors(fields);
        if (e.code === "email_not_verified") setMode("verify");
      } else setError("알 수 없는 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // 실제로 메일을 보낸 경우에만 '보냈습니다'라고 안내합니다(모의 발송은 명확히 구분).
  const applySendResult = (res: SendResult, when: "first" | "again") => {
    setDevCode(res.devCode ?? null);
    if (res.delivery === "email") {
      setInfo(`${email.trim().toLowerCase()} 으로 인증코드를 ${when === "again" ? "다시 " : ""}보냈습니다. 10분 안에 입력하세요.`);
    } else if (res.delivery === "test_console") {
      setInfo(null);
    } else {
      setInfo("인증코드 요청을 접수했습니다. 메일이 오지 않으면 이메일 주소를 확인하세요.");
    }
  };

  const afterLogin = async () => {
    clearNotice();
    await refresh();
    navigate("/", { replace: true });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      void run(async () => {
        await api("POST", "/auth/login", { email, password, deviceKind });
        await afterLogin();
      });
    } else if (mode === "signup") {
      void run(async () => {
        const res = await api<SendResult>("POST", "/auth/signup", { email, password, displayName });
        applySendResult(res, "first");
        setMode("verify");
      });
    } else {
      void run(async () => {
        await api("POST", "/auth/verify-email", { email, code, password, ...(displayName.trim() ? { displayName } : {}), deviceKind });
        await afterLogin();
      });
    }
  };

  const resend = () =>
    void run(async () => {
      const res = await api<SendResult>("POST", "/auth/resend-code", { email });
      applySendResult(res, "again");
    });

  const titles: Record<Mode, string> = { login: "로그인", signup: "교직원 가입", verify: "이메일 인증" };

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="bg-brand px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-2xl font-extrabold tracking-tight">SAFE SCHOOL</p>
          <p className="mt-1 text-base text-on-brand-muted">학교 재난안전 통합 업무지원 시스템</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <form onSubmit={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card" noValidate>
          <h1 className="text-2xl font-bold">{titles[mode]}</h1>

          {notice && !error && (
            <p role="status" className="mt-3 flex gap-2 rounded-control border-2 border-warning bg-warning-soft p-3 text-base font-semibold text-warning-strong">
              <Icon name="clock" size={22} /> {notice}
            </p>
          )}
          {info && (
            <p role="status" className="mt-3 flex gap-2 rounded-control border-2 border-success bg-success-soft p-3 text-base font-semibold text-success">
              <Icon name="check-circle" size={22} /> {info}
            </p>
          )}
          {devCode && (
            <p className="mt-2 rounded-control border-2 border-dashed border-warning bg-warning-soft p-3 text-base font-semibold text-warning-strong">
              <span className="block">테스트 환경 모의 발송 — 메일이 실제로 보내지지 않았습니다.</span>
              테스트 전용 인증코드: <strong className="tabular text-xl">{devCode}</strong>
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 flex gap-2 rounded-control border-2 border-danger bg-danger-soft p-3 text-base font-semibold text-danger">
              <Icon name="alert" size={22} /> {error}
            </p>
          )}

          <div className="mt-4 space-y-4">
            <FormField label="기관 이메일" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} placeholder="name@school.go.kr" />
            {mode === "signup" && (
              <FormField label="이름" autoComplete="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={fieldErrors.displayName} />
            )}
            {/* STEP 7-D: 비밀번호는 인증코드와 함께 확정(가입 요청만으로는 저장하지 않음) */}
            <FormField
              label={mode === "verify" ? "사용할 비밀번호" : "비밀번호"}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
              hint={mode === "signup" ? "10자 이상" : mode === "verify" ? "10자 이상 · 인증이 끝나면 이 비밀번호로 로그인합니다" : undefined}
            />
            {mode === "verify" && (
              <FormField
                label="인증코드 6자리"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                error={fieldErrors.code}
                className="[&_input]:tabular-nums [&_input]:text-2xl [&_input]:tracking-[0.4em]"
              />
            )}

            {mode !== "signup" && (
              <fieldset>
                <legend className="text-base font-bold">사용하는 기기</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["personal", "내 휴대폰·PC", "30일 로그인 유지"],
                      ["shared", "공용 기기", "30분 미사용 시 로그아웃"],
                    ] as const
                  ).map(([value, label, desc]) => (
                    <label
                      key={value}
                      className={`flex min-h-touch cursor-pointer flex-col justify-center rounded-control border-2 px-3 py-2 ${deviceKind === value ? "border-brand bg-brand-soft" : "border-line-strong bg-card"}`}
                    >
                      <input type="radio" name="deviceKind" value={value} checked={deviceKind === value} onChange={() => setDeviceKind(value)} className="sr-only" />
                      <span className="flex items-center gap-1 text-base font-bold">
                        {deviceKind === value && <Icon name="check" size={18} />}
                        {label}
                      </span>
                      <span className="text-sm text-ink-muted">{desc}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          <PrimaryButton type="submit" size="lg" fullWidth className="mt-6" loading={busy}>
            {mode === "login" ? "로그인" : mode === "signup" ? "인증코드 받기" : "인증하고 시작하기"}
          </PrimaryButton>

          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-base">
            {mode === "login" && (
              <button type="button" className="min-h-touch font-bold text-accent underline underline-offset-4" onClick={() => { setMode("signup"); setError(null); }}>
                처음이신가요? 교직원 가입
              </button>
            )}
            {mode === "signup" && (
              <button type="button" className="min-h-touch font-bold text-accent underline underline-offset-4" onClick={() => { setMode("login"); setError(null); }}>
                이미 가입했어요 · 로그인
              </button>
            )}
            {mode === "verify" && (
              <>
                <button type="button" className="min-h-touch font-bold text-accent underline underline-offset-4" onClick={resend} disabled={busy || !email}>
                  인증코드 다시 받기
                </button>
                <button type="button" className="min-h-touch font-bold text-ink-muted underline underline-offset-4" onClick={() => setMode("login")}>
                  로그인으로
                </button>
              </>
            )}
          </div>
        </form>
        <p className="mt-4 text-center text-sm text-ink-muted">재난 중 앱에 접속할 수 없으면 학교의 기존 비상대응 절차(방송·비상연락망)를 따르세요.</p>
        <p className="mt-1 text-center text-sm">
          <a href="/status" className="inline-flex min-h-touch items-center font-semibold text-accent underline underline-offset-4">
            시스템 상태 확인
          </a>
        </p>
      </main>
    </div>
  );
}
