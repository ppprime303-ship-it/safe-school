// 테스트용 가상 이미지(실제 사진 아님): EXIF·GPS·주석·덧붙인 데이터를 일부러 넣은 JPEG·PNG
export const seg = (marker: number, payload: Buffer) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), payload]);
};
export const latin = (s: string) => Buffer.from(s, "latin1");

/** 가상 JPEG: JFIF + EXIF(GPS) + COM + DQT·SOF·DHT + SOS + 스캔(FF00·RST) + (진행형) APP1 + 두 번째 SOS + EOI + 덧붙인 데이터 */
export function fakeJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.concat([latin("JFIF\0"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
    seg(0xe1, latin("Exif\0\0GPSLatitude 37.5665 GPSLongitude 126.9780 DEVICE-SERIAL-XYZ")),
    seg(0xe2, latin("ICC_PROFILE\0vendor-data")),
    seg(0xfe, Buffer.from("촬영자 홍길동 010-1234-5678", "utf8")),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xc2, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    seg(0xc4, Buffer.alloc(20, 2)),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]),
    seg(0xe1, latin("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS hidden</x:xmpmeta>")),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x9a, 0xbc]),
    Buffer.from([0xff, 0xd9]),
    latin("TRAILING-POLYGLOT-DATA"),
  ]);
}

export const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, latin(type), data, Buffer.alloc(4)]); // CRC 는 검사하지 않으므로 0
};
export function fakePng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.from([0, 0, 0, 16, 0, 0, 0, 16, 8, 2, 0, 0, 0])),
    chunk("tEXt", Buffer.from("Author\0홍길동", "utf8")),
    chunk("eXIf", latin("MM\0*GPS-DATA")),
    chunk("tIME", Buffer.from([7, 234, 10, 30, 1, 2, 3])),
    chunk("pHYs", Buffer.alloc(9, 1)),
    chunk("IDAT", Buffer.from([0x78, 0x9c, 1, 2, 3])),
    chunk("IEND", Buffer.alloc(0)),
    latin("TRAILING"),
  ]);
}

