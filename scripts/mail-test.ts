// Gmail 등 설정한 메일 방식으로 시험 메일 1통 보내기(DB를 쓰지 않음): `npm run mail:test -- 받는주소`
// 받는 주소는 본인이 확인할 수 있는 시험용 주소만 씁니다. 설정 절차: docs/beta2/release/gmail-setup.md
import { mailMode, sendMail } from "../server/src/mail/mailer.js";

const to = process.argv[2];
if (!to) {
  console.error("사용법: npm run mail:test -- 받는주소");
  process.exit(1);
}
const mode = mailMode();
console.log(`[mail:test] 메일 방식: ${mode}`);
if (mode !== "gmail" && mode !== "resend") {
  console.error("[mail:test] 실제 발송 설정이 없습니다. 보내지 않았습니다.");
  process.exit(1);
}
sendMail({ to, subject: "[SAFE SCHOOL] 메일 발송 시험", text: "SAFE SCHOOL 메일 발송 시험입니다. 인증코드가 아니며 회신할 필요가 없습니다." })
  .then(() => console.log("[mail:test] 메일 서버가 접수했습니다. 받은 편지함(스팸함 포함)에서 실제 수신을 확인하세요."))
  .catch((e) => {
    console.error(`[mail:test] 실패: ${e.code ?? "오류"}`);
    process.exit(1);
  });
