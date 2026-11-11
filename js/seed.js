// 화면 배치를 확인하기 위한 예시 데이터입니다. 실제 도구가 올라오면 이 파일은 비웁니다.
(function () {
  const page = (title, line) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px;
font-family:"Malgun Gothic",system-ui,sans-serif;background:#eef2fb;color:#141a2b}
h1{font-size:clamp(2rem,6vw,4rem);margin:0 0 .3em}p{color:#5d6785;font-size:1.2rem;margin:.2em 0}</style></head>
<body><div><h1>${title}</h1><p>${line}</p><p>선생님이 올린 웹앱이 이 자리에서 화면 가득 실행됩니다.</p></div></body></html>`;

  const sample = (id, subject, grade, title, summary, intent, howto, createdAt, likes) => ({
    id, subject, grade, title, summary, intent, howto, createdAt, likes,
    author: '예시 선생님', kind: 'html', sample: true,
    html: page(title, '배치 확인용 예시 화면입니다.'),
  });

  window.SEED_TOOLS = [
    sample('ex-korean', '국어', '2학년', '속담 빈칸 퀴즈', '속담의 빈칸을 채우며 뜻을 익히는 퀴즈',
      '속담 단원에서 학생들이 뜻을 외우기만 하고 쓰임을 떠올리지 못해, 상황 문장 속 빈칸을 채우는 형태로 만들었습니다.',
      '화면에 띄우고 모둠별로 번갈아 답합니다. 한 판에 10문제입니다.', '2026-11-09T09:00:00', 12),
    sample('ex-math', '수학', '1학년', '일차방정식 연습기', '풀이 단계를 하나씩 보여 주는 방정식 연습',
      '이항 과정에서 부호 실수가 잦아, 한 단계씩 넘기며 확인할 수 있게 만들었습니다.',
      '난이도를 고르고 [다음 단계]를 눌러 풀이를 한 줄씩 엽니다.', '2026-11-05T13:20:00', 21),
    sample('ex-english', '영어', '전 학년', '영단어 플래시카드', '단원별 단어를 카드로 넘기며 외우기',
      '수업 시작 5분 동안 지난 시간 단어를 빠르게 복습하려고 만들었습니다.',
      '단원을 고르면 카드가 섞여 나옵니다. 카드를 누르면 뜻이 보입니다.', '2026-10-28T08:40:00', 17),
    sample('ex-science', '과학', '2학년', '원소 기호 맞히기', '원소 이름과 기호를 짝짓는 게임',
      '원소 기호 암기를 지루해해서 시간 제한이 있는 짝 맞추기 게임으로 바꿔 보았습니다.',
      '', '2026-11-02T10:10:00', 9),
    sample('ex-social', '사회', '1학년', '세계 수도 퀴즈', '대륙별 나라와 수도를 맞히는 퀴즈',
      '세계 여러 지역 단원의 도입 활동으로 흥미를 끌기 위해 만들었습니다.',
      '대륙을 고르고 시작합니다. 전자칠판에서 학생이 직접 눌러도 됩니다.', '2026-10-20T14:00:00', 6),
    sample('ex-common', '공통', '전 학년', '자리 바꾸기', '조건을 넣어 자리를 무작위로 배치',
      '학급 자리 바꾸는 날마다 제비뽑기 준비가 번거로워 만들었습니다. 시력이 안 좋은 학생은 앞줄로 고정할 수 있습니다.',
      '줄 수와 인원을 넣고 [배치]를 누릅니다.', '2026-11-10T16:30:00', 14),
  ];
})();
