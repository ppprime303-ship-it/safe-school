// Beta PILOT 2 Phase 3-C: 현장 사진 정리(EXIF·GPS·주석·덧붙인 데이터 제거, 형식 판별) — DB 없이 실행
import { describe, expect, it } from "vitest";
import { sanitizeImage } from "../server/src/images/sanitize";
import { chunk, fakeJpeg, fakePng, latin, seg } from "./fixtures/images";

const hasText = (b: Buffer, t: string) => b.includes(Buffer.from(t, "utf8")) || b.includes(latin(t));

describe("JPEG 정리", () => {
  const out = sanitizeImage(fakeJpeg());
  it("형식 JPEG, JFIF·화질 표·프레임·스캔 데이터 유지, EOI 로 끝남", () => {
    expect(out).toMatchObject({ mimeType: "image/jpeg", ext: "jpg" });
    expect(hasText(out.data, "JFIF")).toBe(true);
    expect(out.data.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]))).toBe(true);
    expect(out.data.includes(Buffer.from([0x9a, 0xbc]))).toBe(true);
    expect(out.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });
  it("EXIF·GPS·ICC·XMP(스캔 사이 포함)·주석·덧붙인 데이터 제거", () => {
    for (const t of ["Exif", "GPS", "DEVICE-SERIAL", "ICC_PROFILE", "xmpmeta", "홍길동", "010-1234", "TRAILING"]) expect(hasText(out.data, t)).toBe(false);
  });
  it("두 번 정리해도 같음", () => {
    expect(sanitizeImage(out.data).data.equals(out.data)).toBe(true);
  });
});

describe("PNG 정리", () => {
  const out = sanitizeImage(fakePng());
  it("필수 청크 유지, 텍스트·EXIF·시각·덧붙인 데이터 제거", () => {
    expect(out).toMatchObject({ mimeType: "image/png", ext: "png" });
    for (const t of ["IHDR", "pHYs", "IDAT", "IEND"]) expect(hasText(out.data, t)).toBe(true);
    for (const t of ["tEXt", "eXIf", "tIME", "홍길동", "GPS-DATA", "TRAILING"]) expect(hasText(out.data, t)).toBe(false);
  });
});

describe("거부", () => {
  it.each([
    ["GIF", latin("GIF89a\x01\x00\x01\x00")],
    ["SVG", latin('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", latin("<!doctype html><title>x</title>")],
    ["WebP", latin("RIFF\x10\x00\x00\x00WEBPVP8 ")],
    ["빈 파일", Buffer.alloc(0)],
  ])("지원하지 않는 형식 415: %s", (_n, b) => {
    expect(() => sanitizeImage(b)).toThrow(expect.objectContaining({ status: 415 }));
  });
  it("잘린 JPEG(EOI 없음)·SOS 없는 JPEG·IHDR 로 시작하지 않는 PNG·길이 오류 400", () => {
    const j = fakeJpeg();
    expect(() => sanitizeImage(j.subarray(0, j.indexOf(Buffer.from([0x9a, 0xbc]))))).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => sanitizeImage(Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), Buffer.from([0xff, 0xd9])]))).toThrow(expect.objectContaining({ status: 400 }));
    const p = fakePng();
    expect(() => sanitizeImage(Buffer.concat([p.subarray(0, 8), chunk("IDAT", Buffer.from([1])), chunk("IEND", Buffer.alloc(0))]))).toThrow(expect.objectContaining({ status: 400 }));
    const broken = Buffer.from(p);
    broken.writeUInt32BE(0x7fffffff, 8);
    expect(() => sanitizeImage(broken)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
