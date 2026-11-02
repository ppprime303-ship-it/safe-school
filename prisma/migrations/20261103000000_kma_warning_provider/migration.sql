-- 기상청 기상특보를 공통 경보 구조(official_alerts)에 저장하기 위한 공급자 값 추가. 기존 행은 바뀌지 않습니다.
ALTER TYPE "AlertProvider" ADD VALUE IF NOT EXISTS 'kma_warning';
