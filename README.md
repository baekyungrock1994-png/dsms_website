# 대성중학교 수업 도구 나눔터

대성중학교 선생님들이 바이브 코딩으로 직접 만든 교육용 웹앱을 올리고, 모두가 수업에서 꺼내 쓰는 사이트입니다.

- 큰 틀: [docs/설계서.md](docs/설계서.md)
- 서버 설치: [docs/서버-설치.md](docs/서버-설치.md)

## 실행

빌드 과정이 없습니다. 폴더를 정적 서버로 열면 됩니다.

```bash
python -m http.server 5173
```

`js/config.js`가 비어 있으면 체험용(이 브라우저에만 저장)으로, 채워져 있으면 Supabase 서버에 연결되어 동작합니다.

## 폴더

```
index.html             사이트 껍데기
css/styles.css         디자인
js/config.js           서버 연결 설정 (공개 값만)
js/store.js            저장 계층 · 체험용 (브라우저 저장)
js/store-supabase.js   저장 계층 · 서버용 (Supabase)
js/app.js              화면
js/seed.js             체험용 예시 도구
supabase/setup.sql     데이터베이스 설치 스크립트
docs/                  설계서, 서버 설치 순서
```
