// 외부 경보 안내 창 화면 확인용 가상 자료: `scripts\preview\alert-popup-demo.cmd` 가 실행합니다. safeschool_test 전용, 외부 호출 없음.
// 실제 수집 코드에 가짜 응답을 넣어 호우경보·대설주의보·재난문자(모두 [가상])와 가상 교직원 계정을 만듭니다.
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { collectOnce } from "../server/src/alerts/collector.js";
import { KmaWarningSource } from "../server/src/alerts/kmaSource.js";
import { MoisCbsSource } from "../server/src/alerts/moisCbs.js";
import { parseKmaWarnings } from "../server/src/integrations/kmaWarnings.js";
import { hashPassword } from "../server/src/security/password.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/safeschool_test" || url.searchParams.get("schema") !== "safeschool_test") throw new Error("safeschool_test 에만 실행합니다.");

const prisma = new PrismaClient();
const H = 3600_000;
const stamp = Date.now();
const kst = (ms: number) => new Date(stamp + 9 * H + ms).toISOString().slice(0, 16).replace(/\D/g, "");
const now = new Date(stamp);

async function main() {
  const school = await prisma.school.create({ data: { slug: `popup-demo-${stamp}`, name: "가상 안내확인학교", isDemo: true, status: "active", activatedAt: now, address: "인천광역시 영종구 가상로 1" } });
  const password = randomBytes(9).toString("base64url");
  const email = `popup-demo-${stamp}@check.safeschool.invalid`;
  const user = await prisma.user.create({ data: { email, displayName: "가상 교직원", passwordHash: await hashPassword(password), emailVerifiedAt: now } });
  await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: user.id, role: "staff", status: "approved", approvalMethod: "roster", approvedAt: now } });

  const row = (o: object) => ({ tmFc: kst(-2 * H), tmSeq: String(stamp % 1000), areaCode: "L1110110", areaName: "인천영종", warnVar: "2", warnStress: "1", command: "1", startTime: kst(-H), cancel: "0", ...o });
  const body = JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: 2, items: { item: [row({}), row({ warnVar: "8", warnStress: "0" })] } } } });
  await collectOnce(prisma, new KmaWarningSource({ latest: async () => ({ rows: parseKmaWarnings(body).rows, rejected: 0, partial: false, fetchedAt: new Date(), error: null, status: null }) }), { minIntervalMs: 0, retries: 0 });
  const d = new Date(stamp + 9 * H);
  const p = (n: number) => String(n).padStart(2, "0");
  const cbs = { SN: `demo-${stamp}`, CRT_DT: `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`, MSG_CN: "[가상 시험 — 실제 재난문자 아님] 영종구 호우 대비 안내", RCPTN_RGN_NM: "인천광역시 영종구", EMRG_STEP_NM: "안전안내" };
  await collectOnce(prisma, new MoisCbsSource("not-a-real-key", (async () => ({ ok: true, status: 200, json: async () => ({ header: { resultCode: "00" }, totalCount: 1, body: [cbs] }) })) as never), { minIntervalMs: 0, retries: 0 });

  console.log(`\n[안내 창 확인] http://127.0.0.1:5002 (가상 자료, 테스트 DB)\n  로그인 주소: ${email}\n  임시 비밀번호: ${password}\n`);
}

void main().finally(() => prisma.$disconnect());
