import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// 화면(client)은 Vite로 빌드합니다. 개발 중에는 Express 서버가 Vite를 미들웨어로 띄우므로
// 화면과 API가 같은 주소·포트(기본 5000)에서 동작합니다.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "client"),
  plugins: [react(), tailwindcss()],
  server: {
    // Replit 개발 미리보기: 현재 Repl의 호스트만 허용합니다.
    // allowedHosts: true (모든 호스트 허용)는 사용하지 않습니다.
    allowedHosts: [
      ...(process.env.REPLIT_DEV_DOMAIN?.endsWith(".replit.dev") ? [process.env.REPLIT_DEV_DOMAIN] : []),
      "cf204464-72b6-4125-800a-289e679315f2-00-3dtj3it8yil83.pike.replit.dev",
    ],
  },
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "shared") },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
  },
});
