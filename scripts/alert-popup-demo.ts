// 외부 경보 안내 창 화면 확인용 가상 자료: `scripts\preview\alert-popup-demo.cmd` 가 실행합니다. safeschool_test 전용, 외부 호출 없음.
// 모의 공급자(is_mock)로 저장해 화면에 '모의(가상)'로 표시됩니다. 공식 재난문자·기상특보로 오인되지 않게 실제 공급자 경로를 쓰지 않습니다.
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { collectOnce } from "../server/src/alerts/collector.js";
import { MockAlertSource, type MockAlertInput } from "../server/src/alerts/providers.js";
import { hashPassword } from "../server/src/security/password.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/safeschool_test" || url.searchParams.get("schema") !== "safeschool_test") throw new Error("safeschool_test 에만 실행합니다.");

const prisma = new PrismaClient();
const stamp = Date.now();
const now = new Date(stamp);
const ago = (min: number) => new Date(stamp - min * 60_000).toISOString();
const ISSUER = "모의 공급자(시연용)";
const NOTE = "[모의 시험 — 실제 경보 아님]";

const alerts: MockAlertInput[] = [
  { id: `demo-${stamp}-rain`, kind: "weather", severity: "warning", issuer: ISSUER, title: "[모의] 호우경보 발표", body: `${NOTE} 영종구 호우경보 가상 자료입니다.`, areas: "인천광역시 영종구", issuedAt: ago(30) },
  { id: `demo-${stamp}-snow`, kind: "weather", severity: "advisory", issuer: ISSUER, title: "[모의] 대설주의보 발표", body: `${NOTE} 영종구 대설주의보 가상 자료입니다.`, areas: "인천광역시 영종구", issuedAt: ago(20) },
  { id: `demo-${stamp}-text`, kind: "disaster_text", severity: "advisory", issuer: ISSUER, title: "[모의] 재난문자", body: `${NOTE} 영종구 호우 대비 안내 가상 문자입니다.`, areas: "인천광역시 영종구", issuedAt: ago(10) },
  // 안내되지 않아야 하는 자료: 다른 지역, 이미 해제된 특보
  { id: `demo-${stamp}-busan`, kind: "disaster_text", severity: "warning", issuer: ISSUER, title: "[모의] 다른 지역 문자", body: `${NOTE} 부산 가상 문자입니다.`, areas: "부산광역시 해운대구", issuedAt: ago(10) },
  { id: `demo-${stamp}-wind`, kind: "weather", severity: "advisory", issuer: ISSUER, title: "[모의] 강풍주의보 발표", body: `${NOTE} 강풍주의보 가상 자료입니다.`, areas: "인천광역시 영종구", issuedAt: ago(90) },
  { id: `demo-${stamp}-wind-off`, kind: "weather", severity: "advisory", msgType: "cancel", refId: `demo-${stamp}-wind`, issuer: ISSUER, title: "[모의] 강풍주의보 해제", body: `${NOTE} 강풍주의보 해제 가상 자료입니다.`, areas: "인천광역시 영종구", issuedAt: ago(60) },
];

async function main() {
  const school = await prisma.school.create({ data: { slug: `popup-demo-${stamp}`, name: "가상 안내확인학교", isDemo: true, status: "active", activatedAt: now, address: "인천광역시 영종구 가상로 1" } });
  const password = randomBytes(12).toString("base64url");
  const email = `popup-demo-${stamp}@check.safeschool.invalid`;
  const user = await prisma.user.create({ data: { email, displayName: "가상 교직원", passwordHash: await hashPassword(password), emailVerifiedAt: now } });
  await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: user.id, role: "staff", status: "approved", approvalMethod: "roster", approvedAt: now } });
  await collectOnce(prisma, new MockAlertSource(() => alerts), { minIntervalMs: 0, retries: 0 });
  console.log(`\n[안내 창 확인] http://127.0.0.1:5002 (가상 자료, 테스트 DB)\n  로그인 주소: ${email}\n  임시 비밀번호: ${password}\n`);
}

void main().finally(() => prisma.$disconnect());
