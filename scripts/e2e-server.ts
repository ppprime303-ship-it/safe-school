// E2E용 테스트 서버 시작·종료 도우미
// - 시작 전에 포트가 비어 있는지 확인합니다. 이전 실행의 서버가 남아 있으면 그 서버(옛 코드)로 검사하게 되므로 중단합니다.
// - 서버를 별도 프로세스 그룹으로 띄우고 종료 시 그룹 전체를 끝내 tsx 하위 프로세스가 남지 않게 합니다.
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export interface TestServer {
  stop(): Promise<void>;
  exited(): boolean;
}

export async function startTestServer(port: number, env: NodeJS.ProcessEnv): Promise<TestServer> {
  if (await portInUse(port)) {
    throw new Error(
      `포트 ${port}를 이미 다른 프로세스가 쓰고 있습니다(이전 E2E 서버가 남았을 수 있음). ` +
        `옛 서버로 검사하지 않도록 중단합니다. 'ps -ef | grep "server/src/index.ts"'로 확인 후 해당 PID만 종료하세요.`,
    );
  }
  const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  const child: ChildProcess = spawn(tsx, ["server/src/index.ts"], {
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true, // 새 프로세스 그룹(종료 시 -pid로 그룹 전체 종료)
  });
  let done = false;
  const exitedPromise = new Promise<void>((resolve) => child.once("exit", () => ((done = true), resolve())));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (done) throw new Error("테스트 서버가 시작 중에 종료되었습니다(위 오류 출력 확인).");
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {
      /* 아직 시작 중 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (Date.now() >= deadline) throw new Error("테스트 서버가 30초 안에 시작되지 않았습니다.");

  return {
    exited: () => done,
    async stop() {
      if (done || child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* 이미 종료 */
      }
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* 이미 종료 */
        }
      }, 5000);
      await exitedPromise;
      clearTimeout(timer);
    },
  };
}
