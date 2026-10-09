# 스크린샷 OCR 수집 설계

이미지 입력 → 원본 저장 → 브라우저 OCR → 기존 수집 분석 → 후보 검토로 연결합니다.
무료 오픈소스 Tesseract.js 7을 Web Worker에서 실행하며 한국어·영어를 함께 읽습니다.
유료 OCR 서비스와 API 키는 사용하지 않습니다. 원본은 앱 서버에 보관하지만 판독을 위해
외부 OCR 서버로 보내지 않습니다. 기존 파서·규칙·공간 권한·Item 저장을 재사용합니다.

## 구성과 모델 배포

- 웹: `features/automation/ocr-client.ts`, `screenshots.tsx`, `source-image.tsx`
- API: `api/screenshots.py`, `automation/screenshots.py`, `automation/images.py`
- DB: `0006_screenshot_ocr`, `app.screenshot_inputs`
- 모델 준비: `scripts/prepare-ocr-assets.mjs`, `scripts/ocr-assets.json`

pnpm 잠금 파일의 Tesseract.js·WASM 코어를 `apps/web/public/ocr`에 복사합니다.
공식 tessdata_fast 저장소의 고정 커밋에서 kor·eng 모델과 Apache 라이선스를 받고
SHA-256을 검사합니다. `pnpm dev`, `pnpm build`, `pnpm test:e2e`가 준비를 실행합니다.
최초 준비에는 인터넷이 필요하며 파일이 있고 해시가 일치하면 모델을 다시 받지 않습니다.
판독 시 Worker·코어·언어 모델 경로는 모두 앱의 `/ocr`를 사용합니다.
생성된 외부 라이브러리 파일은 Git·앱 린트에서 제외합니다.
Tesseract.js의 postinstall은 후원 안내 출력이므로 실행하지 않습니다.

## 원본과 권한

원본은 비공개 `app.screenshot_inputs.image_bytes BYTEA`에 저장합니다.
기존 제한 DB 역할과 소유자 RLS를 사용하며 Storage 관리자 키를 요구하지 않습니다.
PNG/JPEG/WebP만 허용하고 Pillow로 실제 형식과 손상 여부를 검사합니다.
한 파일은 5 MiB·25백만 픽셀 이하이며 움직이는 이미지는 거부합니다.
사용자별 SHA-256 고유 키로 중복 업로드를 같은 이벤트에 연결합니다.
사용자당 최대 50개 원본을 보관하며 삭제한 이미지는 한도에 포함하지 않습니다.

`0006`은 새 테이블·소유자 RLS·사용자/이벤트 복합 FK·조회 인덱스만 추가합니다.
기존 데이터와 기존 테이블 정책은 변경하지 않습니다. 한 이미지에 한 InboundEvent가 연결됩니다.
이미지 삭제는 바이트와 진행 중 claim만 제거합니다. OCR 텍스트·후보·기존 Item은 보존합니다.
같은 이미지를 다시 올리면 같은 기록을 복원하고 분석이 끝났으면 후보를 재생성하지 않습니다.

## 판독과 실패 처리

브라우저가 짧은 API 요청으로 claim을 받고 이미지 판독은 DB 트랜잭션 밖에서 실행합니다.
상태는 `pending`, `processing`, `completed`, `failed`, `deleted`입니다.
5분 이상 중단된 claim은 사용자가 재시도할 수 있으며 새로운 UUID token을 발급합니다.
브라우저 판독은 2분 제한을 두며 모델 파일 누락·화면 종료를 오류로 처리합니다.
늦은 결과의 token이 다르면 409로 거부합니다. 완료 결과의 재전송은 중복 처리하지 않습니다.
이미지 삭제 후 도착한 결과도 거부합니다. 알림 Worker는 기존 역할을 유지합니다.

판독 실패·화면 종료 시 원본은 남습니다. 저장 결과 전송에 실패한 경우 원본으로 다시 판독합니다.
판독 뒤 파서만 실패하면 최대 50,000자의 OCR 결과를 보존하고 다시 읽지 않고 분석을 재시도합니다.
기존 파서의 10,000자 제한 또는 입력 오류로 실패한 경우 필요한 텍스트만 남겨 다시 분석할 수 있습니다.
수정한 분석 입력과 별도로 원래 OCR 텍스트를 보존합니다.
업로드 시각은 상대 날짜 분석 기준으로 유지합니다.

OCR 줄바꿈은 화면 배치로 생길 수 있으므로 한 이미지는 전체 내용을 하나의 문서로 분석합니다.
수동 텍스트 수집의 여러 후보 분리 정책은 유지합니다.
OCR 신뢰도는 Tesseract가 반환한 값이며 파서의 필드별 신뢰도와 별도로 기록합니다.
모든 스크린샷 후보에 `ocr.needs_review=true`를 적용하여 자동 저장을 막습니다.
규칙으로 공간·종류를 제안하고, 원본·날짜·금액을 확인한 사용자가 추가합니다.
규칙의 무시 동작과 수집 경로 기본 공간 설정도 기존 정책으로 적용합니다.

## API와 화면

- POST `/api/v1/automation/screenshots`: 인증된 이미지 바이트 업로드, 202
- GET `/api/v1/automation/screenshots`: 페이지별 20개 작업 목록
- GET `/api/v1/automation/screenshots/{id}/image`: 본인 전용 이미지, private/no-store
- POST `.../{id}/claim`: 판독 작업 token 발급
- POST `.../{id}/result`: token·텍스트·신뢰도 저장 및 분석
- POST `.../{id}/failure`: 해당 token 작업의 실패 기록
- POST `.../{id}/retry`: 파서 실패의 OCR 텍스트 재사용
- PATCH `.../{id}/text`: 분석 실패 시 필요한 텍스트로 복구
- DELETE `.../{id}`: 확인 후 원본 이미지 바이트 삭제, 204

Next.js 중계는 로그인과 Origin 검사를 유지합니다. 이미지 경로만 5 MiB의 바이너리를
허용하며 결과 JSON은 200 KiB, 일반 JSON은 기존 64 KiB로 제한합니다.
스트림 읽기 중에도 크기를 제한합니다. 이미지 응답은 바이너리·nosniff·private/no-store입니다.
후보의 `source_image_id`와 원본 목록에서 인증된 이미지 미리보기를 제공합니다.
Ctrl+V, 파일 선택, 끌어놓기, 진행 상태, 실패·재시도, 원본 삭제 확인을 제공합니다.
스크린샷을 한 번 올리면 설정에서 해당 수집 경로의 기본 공간을 지정할 수 있습니다.

## 검증과 한계

단위 검사는 형식·크기·차원·손상·움직이는 이미지·빈 판독 결과를 확인합니다.
PGlite로 기존 데이터 유지, 새 마이그레이션, RLS·복합 FK·원본 삭제를 확인합니다.
`scripts/verify_live_ocr.py`는 실제 제한 DB 역할과 SAVEPOINT를 사용하여 API 흐름을 확인하고
최상위 트랜잭션을 롤백합니다. 실행 API의 JWT 검증을 우회하지 않습니다.
브라우저 테스트에서는 API fixture와 별도로 실제 Web Worker·kor/eng 모델을 실행합니다.
외부 HTTP 요청 없이 한글 날짜·금액을 읽는지, 원본 검토·후보 추가·실패 후 새로고침 재시도를 확인합니다.

검증 샘플은 맑은 고딕으로 만든 선명한 한국어 이미지입니다. 이 결과만으로 복잡한 레이아웃,
작은 글자, 사진·손글씨의 정확도를 보장하지 않습니다. OCR 점수는 정확도 확률이 아닙니다.
대형 이미지는 브라우저 성능에 따라 시간이 걸리고 페이지를 닫으면 판독이 멈춥니다.
자동 촬영·연속 감시·PDF 판독·서버 무인 OCR은 이번 범위에 포함하지 않습니다.
