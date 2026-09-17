# 전국 골프장 검색 — 500+ 자동 업데이트 버전

## 이번 버전에서 바뀐 점

이번 버전은 골프장을 **데이터 상태별로 명확히 구분**합니다.

- `detail` : 상세정보 확인
- `partial` : 일부 정보 확인
- `list_only` : 골프장 목록/기본정보만 확인

원본에 없는 값은 `null`로 저장하며 임의로 가격이나 노캐디 여부 등을 채우지 않습니다.

화면에서도 `상세정보 확인 / 일부 정보 확인 / 목록만 확인` 필터로 구분해서 볼 수 있습니다.

## 사용자가 Python을 설치할 필요가 없는 이유

이 프로젝트의 데이터 수집은 **GitHub Actions에서 자동 실행**됩니다.

사용자는 PC에서 Python을 실행하지 않습니다.

GitHub가 서버에서 Node.js를 실행해서 공개 데이터셋을 가져오고 `data/courses.json`을 갱신합니다.

## 설치 순서

1. GitHub에서 새 Repository 생성
2. 이 ZIP의 파일을 Repository에 업로드
3. Settings → Pages에서 GitHub Pages 활성화
4. Actions → Update Golf Data → Run workflow를 한 번 실행
5. 이후 매일 자동 실행

## 자동 업데이트

`.github/workflows/update-golf-data.yml`이 매일 실행됩니다.

수집 원본:
https://raw.githubusercontent.com/myphj01/my_golf_courses/main/index.html

원본에는 500개 이상의 골프장 레코드가 포함되어 있어야 하며, 500개 미만이면 업데이트를 실패시켜 잘못된 데이터 배포를 막습니다.

## 주의

이 원본은 공개된 제3자 데이터셋입니다. 골프장별 그린피·캐디피·카트비 등의 실제 최신 조건을 공식 홈페이지/예약 시스템과 대조해야 합니다.

따라서 이 버전에서는 제3자 원본에 없는 값을 공식 정보인 것처럼 만들지 않습니다.

향후 단계에서는 공식 공공데이터와 골프장 공식 홈페이지/예약 데이터 등을 추가 소스로 연결해 필드별 출처와 확인시각을 더 정밀하게 관리할 수 있습니다.
