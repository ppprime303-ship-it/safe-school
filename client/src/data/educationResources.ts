// STEP 4 안전교육 자료 안내 데이터(정적 목록 — DB·서버 API 없음)
//
// 수정 규칙
// 1) 공식 기관 사이트만 등록합니다. 주소는 접속·내용을 확인한 뒤 넣고 verifiedAt 을 갱신합니다.
// 2) 직접 자료 페이지 주소는 실제로 열리는 것을 확인한 경우에만 url 에 넣고, 확인하지 못하면 기관 홈페이지를 넣습니다.
// 3) areas·levels 에는 사이트의 실제 분류·대상에 근거가 있는 것만 넣습니다(근거는 basis 에 적음). 없는 영역에 억지로 연결하지 않습니다.
// 4) 새 도메인을 쓰려면 EDUCATION_ALLOWED_HOSTS 에도 추가해야 화면에 링크가 나타납니다(허용 목록 밖 주소는 '링크 확인 필요'로 막힘).
// 확인 기록: docs/step4/step4-education-resources.md
import type { EducationResource } from "../lib/educationResources";

/** 이동을 허용하는 공식 도메인(정확히 일치) */
export const EDUCATION_ALLOWED_HOSTS = ["www.schoolsafe24.or.kr", "kasem.safekorea.go.kr"] as const;

export const EDUCATION_RESOURCES: EducationResource[] = [
  {
    id: "schoolsafe24",
    name: "학교안전지원시스템 · 안전교육 자료실",
    operator: "학교안전공제중앙회",
    materialTypes: ["학교안전교육 7대 표준안 자료", "교육과정 연계 자료", "재난대응 매뉴얼", "문서(hwp·pdf·ppt 등)·이미지·동영상"],
    description: "학교안전교육 7대 영역별 자료를 학교급(유·초·중·고)으로 골라 볼 수 있는 학교 안전교육 자료실입니다.",
    areas: ["life", "traffic", "violence", "addiction", "disaster", "occupational", "firstaid"],
    levels: ["kindergarten", "elementary", "middle", "high"],
    basis:
      "교육부 공개 데이터 '학교안전지원시스템 안전교육자료실 콘텐츠 메타정보'가 7대 영역과 학교급(유·초·중·고)으로 분류되어 있고, 자료실 화면에서 '7대안전' 탭과 학교급 필터(유·초·중·고)를 확인했습니다.",
    howTo: "자료실의 '7대안전' 탭에서 학교급(유·초·중·고)과 영역을 골라 찾습니다. 교과와 연계한 자료는 '교육과정연계' 탭, 재난 상황별 대응은 '재난대응 매뉴얼' 탭에 있습니다.",
    url: "https://www.schoolsafe24.or.kr/front/rpstr/rpstrList.do?menuSn=181&upperMenuSn=148",
    homeUrl: "https://www.schoolsafe24.or.kr/",
    keywords: ["7대 표준안", "표준안", "자료실", "교육부", "학교안전", "교수학습", "교육과정", "매뉴얼", "현장체험학습", "자전거", "유괴", "미아"],
    verifiedAt: "2026-10-23",
  },
  {
    id: "kasem",
    name: "국민안전교육플랫폼",
    operator: "행정안전부",
    materialTypes: ["안전교육 동영상", "기관별 안전교육 통합자료", "안전체험관 정보", "안전교육 전문강사·기관 정보"],
    description: "여러 기관의 안전교육 자료를 한곳에 모아 생애주기별·안전분야별로 찾을 수 있는 범정부 안전교육 누리집입니다.",
    areas: ["life", "traffic", "violence", "disaster"],
    levels: ["kindergarten", "elementary", "middle", "high"],
    basis:
      "행정안전부 발표(2023.2.)의 안전분야(생활안전·교통안전·자연재난안전·사회기반체계안전·범죄안전 등)와 생애주기 구분(영유아기 0~5세, 아동기 6~12세, 청소년기 13~18세)에 근거했습니다. 약물·사이버중독, 직업안전, 응급처치는 분야 이름을 확인하지 못해 연결하지 않았습니다.",
    howTo: "누리집에서 생애주기(영유아기·아동기·청소년기)와 안전분야를 골라 교육자료를 찾습니다. 지역 안전체험관과 전문강사 정보도 함께 볼 수 있습니다.",
    areaHowTo: {
      violence: "이 누리집의 분류 이름은 '범죄안전'입니다. 유괴·범죄 피해 예방 등 신변보호 자료를 찾을 때 활용하세요.",
      disaster: "'자연재난안전'과 '사회기반체계안전' 분야에서 찾습니다.",
    },
    url: "https://kasem.safekorea.go.kr/",
    keywords: ["생애주기", "동영상", "체험관", "안전체험", "전문강사", "행안부", "범죄안전", "자연재난", "영유아", "아동", "청소년"],
    verifiedAt: "2026-10-23",
  },
];
