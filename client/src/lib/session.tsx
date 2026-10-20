// 로그인 사용자와 선택한 학교. 로그인 후 소속이 하나면 자동으로 그 학교를 선택합니다(재선택 불필요).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, SESSION_EXPIRED_EVENT, storage } from "./api";

export type MemberRole = "admin" | "homeroom" | "staff";
export type MembershipStatus = "pending" | "approved" | "rejected" | "revoked";

export interface Membership {
  id: string;
  role: MemberRole;
  status: MembershipStatus;
  school: { id: string; name: string; status: "pending_verification" | "active" | "suspended"; isDemo: boolean; schoolKindCode: string | null };
  assignments: { duty: "homeroom" | "assist" | "inspection"; class: { id: string; label: string; schoolYear: number } }[];
}

export interface Me {
  user: { id: string; email: string; displayName: string; emailVerified: boolean };
  deviceKind: "personal" | "shared";
  memberships: Membership[];
  registrations: { id: string; schoolId: string; status: string; createdAt: string }[];
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** 승인되고 활성화된 학교 중 선택된 소속 */
  current: Membership | null;
  selectSchool: (schoolId: string) => void;
  usableMemberships: Membership[];
  /** 로그인 화면에 보여 줄 안내(세션 만료 등) */
  notice: string | null;
  clearNotice: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const SCHOOL_KEY = "ss.schoolId";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(() => storage.get(SCHOOL_KEY));
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/auth/me"));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setError(null);
      } else {
        setError(e instanceof ApiError ? e : new ApiError(0, "unknown", "알 수 없는 오류"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 업무 중 세션이 만료되거나 권한이 회수되면 로그인 화면으로(입력 중이던 화면 대신 이유를 알려 줌)
  useEffect(() => {
    const onExpired = () => {
      setMe((prev) => {
        if (prev) setNotice("로그인이 만료되었거나 권한이 바뀌었습니다. 다시 로그인하세요.");
        return null;
      });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const logout = useCallback(async () => {
    await api("POST", "/auth/logout").catch(() => undefined);
    storage.remove(SCHOOL_KEY);
    setSchoolId(null);
    setMe(null);
  }, []);

  const usableMemberships = useMemo(
    () => (me?.memberships ?? []).filter((m) => m.status === "approved" && m.school.status === "active"),
    [me],
  );

  const current = useMemo(() => {
    if (usableMemberships.length === 0) return null;
    return usableMemberships.find((m) => m.school.id === schoolId) ?? (usableMemberships.length === 1 ? usableMemberships[0]! : null);
  }, [usableMemberships, schoolId]);

  const selectSchool = useCallback((id: string) => {
    storage.set(SCHOOL_KEY, id);
    setSchoolId(id);
  }, []);

  const value = useMemo(
    () => ({ me, loading, error, refresh, logout, current, selectSchool, usableMemberships, notice, clearNotice }),
    [me, loading, error, refresh, logout, current, selectSchool, usableMemberships, notice, clearNotice],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionProvider 안에서만 사용할 수 있습니다.");
  return ctx;
}
