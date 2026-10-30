// Beta PILOT 2 Phase 3-C 현장 사진 정리(새 의존성 없음)
// - 파일 앞부분(매직 바이트)으로 형식을 판별: JPEG·PNG만 허용(이름·Content-Type 은 믿지 않음). GIF·SVG·HEIC·WebP 등은 거부
// - JPEG: APP1~APP15(EXIF·GPS·XMP·ICC 등)와 주석(COM)을 버리고 JFIF APP0 만 남김. 스캔 사이 구간도 같은 규칙, 끝(EOI) 뒤 데이터는 버림
// - PNG: 화면 표시에 필요한 청크만 남김(텍스트·EXIF·시각 청크 제거), IEND 뒤 데이터는 버림
// - 구조가 맞지 않으면(잘림·길이 오류) 거부. 다시 그리기(재인코딩)는 하지 않으므로 화면(브라우저)에서도 다시 그려 보냄(이중 방어)
import { AppError } from "../errors.js";

export type SanitizedImage = { mimeType: "image/jpeg" | "image/png"; ext: "jpg" | "png"; data: Buffer };

const bad = (msg = "사진 파일이 손상되었거나 지원하지 않는 형식입니다.") => new AppError(400, "invalid_image", msg);
const unsupported = () => new AppError(415, "unsupported_image_type", "JPEG·PNG 사진만 올릴 수 있습니다.");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs"]);
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function sanitizeImage(input: Buffer): SanitizedImage {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return { mimeType: "image/jpeg", ext: "jpg", data: stripJpeg(input) };
  if (input.length >= 8 && input.subarray(0, 8).equals(PNG_SIG)) return { mimeType: "image/png", ext: "png", data: stripPng(input) };
  throw unsupported();
}

function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  let sawSof = false;
  let sawSos = false;
  const keepSegment = (marker: number, payload: Buffer) => {
    if (marker === 0xfe) return false; // COM
    if (marker >= 0xe1 && marker <= 0xef) return false; // APP1~15: EXIF·GPS·XMP·ICC·제조사 정보
    if (marker === 0xe0) return payload.length >= 7 && payload.subarray(2, 7).toString("latin1") === "JFIF\0";
    return true;
  };
  for (;;) {
    if (i >= b.length) throw bad();
    if (b[i] !== 0xff) throw bad();
    while (i < b.length && b[i] === 0xff) i++; // 채움 바이트
    if (i >= b.length) throw bad();
    const marker = b[i]!;
    i++;
    if (marker === 0xd9) {
      if (!sawSof || !sawSos) throw bad();
      out.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(out); // EOI 뒤 데이터는 버림
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(Buffer.from([0xff, marker]));
      continue;
    }
    if (i + 2 > b.length) throw bad();
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > b.length) throw bad();
    const payload = b.subarray(i, i + len); // 길이 2바이트 포함
    i += len;
    if (SOF.has(marker)) sawSof = true;
    if (keepSegment(marker, payload)) out.push(Buffer.from([0xff, marker]), payload);
    if (marker === 0xda) {
      sawSos = true;
      // 스캔 데이터: 다음 마커(FF 뒤 00·RST 아님)까지 그대로 복사
      const start = i;
      while (i < b.length) {
        if (b[i] === 0xff && i + 1 < b.length) {
          const n = b[i + 1]!;
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        i++;
      }
      if (i >= b.length) throw bad(); // EOI 없이 끝남(잘림)
      out.push(b.subarray(start, i));
    }
  }
}

function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [PNG_SIG];
  let i = 8;
  let first = true;
  for (;;) {
    if (i + 12 > b.length) throw bad();
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type) || len > b.length || i + 12 + len > b.length) throw bad();
    if (first && type !== "IHDR") throw bad();
    first = false;
    const chunk = b.subarray(i, i + 12 + len);
    i += 12 + len;
    if (PNG_KEEP.has(type)) out.push(chunk);
    if (type === "IEND") return Buffer.concat(out); // IEND 뒤 데이터는 버림
  }
}
