import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "shared") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // DB 테스트는 같은 테스트 스키마를 쓰므로 순서대로 실행합니다.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
