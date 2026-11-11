(function () {
  'use strict';

  const SUBJECTS = ['공통', '국어', '수학', '영어', '과학', '사회', '역사', '도덕', '기술·가정', '정보', '체육', '음악', '미술', '진로', '기타'];
  const HUE = { 공통: 222, 국어: 350, 수학: 205, 영어: 268, 과학: 160, 사회: 35, 역사: 18, 도덕: 300, '기술·가정': 188, 정보: 240, 체육: 8, 음악: 325, 미술: 48, 진로: 130, 기타: 215 };
  const GRADES = ['전 학년', '1학년', '2학년', '3학년'];
  const MAX_HTML_BYTES = 900 * 1024;
  const PROPS = new Set(['value', 'checked', 'hidden', 'disabled', 'required', 'selected']);

  const app = document.getElementById('app');
  const state = { subject: '전체', q: '', sort: 'new' };

  /* ---------- 공통 도우미 ---------- */
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...kids.flat(Infinity).filter((x) => x != null && x !== false && x !== ''));
    return node;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
  const subjectTag = (s) => h('span', { class: 'tag', style: `--h:${HUE[s] ?? 215}` }, s);

  let toastTimer;
  function toast(msg) {
    const box = document.getElementById('toast');
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
  }

  // 저장 동작을 기다린 뒤 화면을 다시 그립니다. 실패하면 알림만 띄웁니다.
  const act = (promise) => promise.then(() => route(), (err) => { console.error(err); toast('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); });

  /* ---------- 로그인: 등록된 성함 + 개인 비밀번호 ---------- */
  const nameDialog = document.getElementById('name-dialog');
  const nameInput = document.getElementById('name-input');
  const pwInput = document.getElementById('pw-input');
  const loginError = document.getElementById('login-error');
  function paintUser() {
    const name = Store.getUser();
    document.getElementById('user-btn').textContent = name ? `${name} 선생님 · 로그아웃` : '로그인';
  }
  // 로그인 단계: name(성함 입력) → password(비밀번호) 또는 setup(첫 로그인: 비밀번호 정하기)
  const byId = (id) => document.getElementById(id);
  const HELP = {
    name: '관리자가 등록한 성함을 입력하세요.',
    password: '비밀번호를 입력하세요. 잊으셨다면 관리자에게 초기화를 요청하세요.',
    setup: '처음 오셨네요. 학교에서 안내한 가입 코드를 넣고, 앞으로 쓸 내 비밀번호를 정하세요.',
  };
  const LOCKED = '여러 번 틀려서 잠시 잠겼습니다. 5분 뒤에 다시 시도해 주세요.';
  let loginStep = 'name';
  function setStep(step) {
    loginStep = step;
    byId('step-password').hidden = step !== 'password';
    byId('step-setup').hidden = step !== 'setup';
    nameInput.readOnly = step !== 'name';
    byId('login-help').textContent = HELP[step];
    byId('login-submit').textContent = step === 'name' ? '다음' : step === 'setup' ? '비밀번호 정하고 로그인' : '로그인';
    loginError.hidden = true;
    (step === 'name' ? nameInput : step === 'password' ? pwInput : byId('code-input')).focus();
  }
  const loginFail = (msg) => { loginError.textContent = msg; loginError.hidden = false; };
  byId('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    try {
      if (loginStep === 'name') {
        const st = await Store.accountState(name);
        if (st === 'unknown') return loginFail('등록되지 않은 성함입니다. 관리자에게 등록을 요청해 주세요.');
        return setStep(st === 'new' ? 'setup' : 'password');
      }
      if (loginStep === 'password') {
        const result = await Store.login(name, pwInput.value);
        if (result === 'ok') return endLogin();
        return loginFail(result === 'locked' ? LOCKED : '비밀번호가 맞지 않습니다.');
      }
      const pw1 = byId('new-pw-input').value;
      if (pw1 !== byId('new-pw2-input').value) return loginFail('새 비밀번호 두 칸이 서로 다릅니다.');
      const result = await Store.register(name, byId('code-input').value, pw1);
      if (result === 'ok') return endLogin();
      loginFail(result === 'locked' ? LOCKED
        : result === 'code' ? '가입 코드가 맞지 않습니다.'
        : result === 'short' ? '비밀번호는 6자 이상으로 정해 주세요.'
        : '이미 비밀번호를 정한 성함입니다. 처음부터 다시 시도해 주세요.');
    } catch (err) {
      console.error(err);
      loginFail('확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    }
  });
  // 로그인 창을 닫고 결과를 알립니다. 성공·취소 때 직접 부르고, Esc로 닫힌 경우는 close 이벤트로 받습니다.
  let loginResolve = null;
  function endLogin() {
    if (nameDialog.open) nameDialog.close();
    paintUser();
    const resolve = loginResolve;
    loginResolve = null;
    if (resolve) resolve(Store.getUser() || null);
  }
  nameDialog.addEventListener('close', endLogin);
  byId('login-cancel').addEventListener('click', endLogin);
  // 로그인에 성공하면 이름, 취소하면 null
  function askName() {
    return new Promise((resolve) => {
      loginResolve = resolve;
      byId('login-form').reset();
      nameDialog.showModal();
      setStep('name');
    });
  }
  const requireName = async () => Store.getUser() || askName();
  document.getElementById('user-btn').addEventListener('click', async () => {
    if (Store.getUser()) {
      if (!confirm('로그아웃할까요?')) return;
      await Store.logout();
      paintUser();
      route();
    } else if (await askName()) route();
  });

  /* ---------- 썸네일과 기본 그림 ---------- */
  // 썸네일이 없는 도구에는 과목 색의 캐릭터를 그려 줍니다. 도구마다 생김새가 조금씩 다릅니다.
  const GLYPH = { 공통: '공', 국어: '국', 수학: '수', 영어: '영', 과학: '과', 사회: '사', 역사: '역', 도덕: '도', '기술·가정': '기', 정보: '정', 체육: '체', 음악: '음', 미술: '미', 진로: '진', 기타: '+' };
  const BODIES = [
    '<circle cx="160" cy="112" r="58"/>',
    '<rect x="100" y="54" width="120" height="116" rx="38"/>',
    '<path d="M160 50c40 0 66 34 66 70 0 34-28 52-66 52s-66-18-66-52c0-36 26-70 66-70z"/>',
    '<path d="M100 112a60 60 0 0 1 120 0v58l-20-12-20 12-20-12-20 12-20-12-20 12z"/>',
  ];
  const EYE_OPEN = (x) => `<circle cx="${x}" cy="106" r="6.5"/><circle cx="${x + 2}" cy="104" r="2" fill="#fff"/>`;
  const EYE_SMILE = (x) => `<path d="M${x - 7} 108q7-9 14 0" fill="none" stroke-width="4" stroke-linecap="round"/>`;
  const EYES = [EYE_OPEN(141) + EYE_OPEN(179), EYE_SMILE(141) + EYE_SMILE(179), EYE_OPEN(141) + EYE_SMILE(179)];
  function defaultArt(t) {
    const hue = HUE[t.subject] ?? 215;
    let n = 7;
    for (const ch of String(t.id || t.title || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    const ink = `hsl(${hue} 40% 24%)`;
    const tilt = ((n >> 5) % 3 - 1) * 5;
    const box = h('div', { class: 'thumb art', 'aria-hidden': 'true' });
    box.innerHTML = `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="200" fill="hsl(${hue} 50% 94%)"/>
      <circle cx="50" cy="38" r="28" fill="hsl(${hue} 50% 89%)"/>
      <circle cx="286" cy="176" r="44" fill="hsl(${hue} 50% 89%)"/>
      <circle cx="84" cy="168" r="7" fill="hsl(${hue} 45% 80%)"/>
      <g transform="rotate(${tilt} 160 112)">
        <g fill="hsl(${hue} 45% 68%)">${BODIES[n % 4]}</g>
        <g fill="${ink}" stroke="${ink}" stroke-width="0">${EYES[(n >> 2) % 3]}</g>
        <ellipse cx="127" cy="123" rx="9" ry="5.5" fill="#ff8fa3" opacity=".55"/>
        <ellipse cx="193" cy="123" rx="9" ry="5.5" fill="#ff8fa3" opacity=".55"/>
        <path d="M152 121q8 9 16 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
      </g>
      <circle cx="244" cy="58" r="25" fill="#fff"/>
      <text x="244" y="67" text-anchor="middle" font-size="25" font-weight="800" fill="${ink}" font-family="inherit">${GLYPH[t.subject] || '+'}</text>
    </svg>`;
    return box;
  }
  const thumbNode = (t) => t.thumb ? h('img', { class: 'thumb', src: t.thumb, alt: '', loading: 'lazy' }) : defaultArt(t);

  /* ---------- 도구 카드 ---------- */
  function openButton(t, cls = 'btn btn-primary btn-sm') {
    return t.kind === 'link'
      ? h('a', { class: cls, href: t.url, target: '_blank', rel: 'noopener noreferrer' }, '열기 ↗')
      : h('a', { class: cls, href: '#/run/' + t.id }, '열기');
  }
  function toolCard(t) {
    return h('article', { class: 'card', style: `--h:${HUE[t.subject] ?? 215}` },
      h('a', { class: 'card-main', href: '#/tool/' + t.id },
        thumbNode(t),
        h('div', { class: 'card-body' },
          h('div', { class: 'card-top' }, subjectTag(t.subject),
            t.grade && t.grade !== '전 학년' && h('span', { class: 'chip' }, t.grade),
            t.sample && h('span', { class: 'chip chip-sample' }, '예시')),
          h('h3', {}, t.title),
          h('p', {}, t.summary))),
      h('div', { class: 'card-foot' },
        h('div', { class: 'card-meta' },
          h('span', { class: 'by' }, t.author),
          h('span', {}, `${fmtDate(t.createdAt)} · ♥ ${t.likes}`)),
        openButton(t)));
  }

  /* ---------- 둘러보기 ---------- */
  async function viewHome() {
    // 목록은 화면에 들어올 때 한 번만 받아 오고, 검색·과목·정렬은 받아 둔 목록에서 고릅니다.
    const [all, favIds] = await Promise.all([Store.listTools(), Store.listFavs()]);
    const favSet = new Set(favIds);
    const rail = h('nav', { class: 'rail', 'aria-label': '과목' });
    const results = h('div', { class: 'results' });
    const sortSelect = h('select', { 'aria-label': '정렬', onchange: (e) => { state.sort = e.target.value; update(); } },
      h('option', { value: 'new', selected: state.sort === 'new' }, '최신순'),
      h('option', { value: 'likes', selected: state.sort === 'likes' }, '좋아요순'));

    function update() {
      const q = state.q.trim().toLowerCase();
      const pool = all.filter((t) => !q || [t.title, t.summary, t.intent, t.author, t.subject].join(' ').toLowerCase().includes(q));
      const counts = {};
      pool.forEach((t) => { counts[t.subject] = (counts[t.subject] || 0) + 1; });

      rail.replaceChildren(...['전체', ...SUBJECTS].map((s) => {
        const n = s === '전체' ? pool.length : (counts[s] || 0);
        const active = state.subject === s;
        return h('button', {
          type: 'button', class: 'rail-item' + (active ? ' active' : '') + (n ? '' : ' empty'),
          'aria-pressed': String(active), onclick: () => { state.subject = s; update(); },
        }, h('span', {}, s), h('span', { class: 'count' }, String(n)));
      }));

      const list = pool.filter((t) => state.subject === '전체' || t.subject === state.subject);
      const byNew = (a, b) => b.createdAt.localeCompare(a.createdAt);
      list.sort(state.sort === 'likes' ? (a, b) => b.likes - a.likes || byNew(a, b) : byNew);
      const favs = !q && state.subject === '전체' ? all.filter((t) => favSet.has(t.id)) : [];

      results.replaceChildren(...[
        favs.length && h('section', { class: 'favs' },
          h('h2', {}, '★ 내 즐겨찾기'),
          h('div', { class: 'grid' }, favs.map(toolCard))),
        h('div', { class: 'list-head' },
          h('h2', {}, state.subject === '전체' ? '모든 도구' : state.subject, ' ', h('span', { class: 'count' }, `${list.length}개`)),
          sortSelect),
        list.length
          ? h('div', { class: 'grid' }, list.map(toolCard))
          : h('div', { class: 'empty-state' },
              h('p', {}, q ? '찾는 도구가 없습니다. 다른 낱말로 찾아보세요.' : '아직 이 과목에 올라온 도구가 없습니다.'),
              h('a', { class: 'btn btn-primary', href: '#/upload' }, '첫 도구 올리기')),
      ].filter(Boolean));
    }

    update();
    return h('div', { class: 'home' },
      h('section', { class: 'hero' },
        h('h1', {}, '선생님이 만든 수업 도구, 함께 써요'),
        h('p', {}, '대성중 선생님들이 직접 만든 웹앱을 과목별로 찾아 수업에서 바로 여세요.'),
        h('input', {
          type: 'search', class: 'search', value: state.q, 'aria-label': '도구 검색',
          placeholder: '도구 이름, 내용, 만든 사람으로 찾기',
          oninput: (e) => { state.q = e.target.value; update(); },
        })),
      h('div', { class: 'browse' }, rail, results));
  }

  /* ---------- 도구 상세 ---------- */
  function notFound() {
    return h('div', { class: 'empty-state' },
      h('p', {}, '도구를 찾을 수 없습니다. 삭제되었을 수 있습니다.'),
      h('a', { class: 'btn btn-primary', href: '#/' }, '둘러보기로'));
  }
  async function viewTool(id) {
    const t = await Store.getTool(id);
    if (!t) return notFound();
    let [liked, fav] = await Promise.all([Store.isLiked(id), Store.isFav(id)]);
    let likes = t.likes;
    const failed = (err) => { console.error(err); toast('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'); };

    const likeBtn = h('button', { type: 'button', class: 'btn toggle' });
    const favBtn = h('button', { type: 'button', class: 'btn toggle' });
    const paint = () => {
      likeBtn.textContent = `${liked ? '♥' : '♡'} 좋아요 ${likes}`;
      likeBtn.classList.toggle('on', liked);
      likeBtn.setAttribute('aria-pressed', String(liked));
      favBtn.textContent = `${fav ? '★' : '☆'} 즐겨찾기`;
      favBtn.classList.toggle('on', fav);
      favBtn.setAttribute('aria-pressed', String(fav));
    };
    likeBtn.addEventListener('click', async () => {
      try {
        const on = await Store.toggleLike(id);
        if (on !== liked) likes = Math.max(0, likes + (on ? 1 : -1));
        liked = on;
        paint();
      } catch (err) { failed(err); }
    });
    favBtn.addEventListener('click', async () => {
      try {
        fav = await Store.toggleFav(id);
        toast(fav ? '즐겨찾기에 담았습니다. 첫 화면 맨 위에 보입니다.' : '즐겨찾기에서 뺐습니다.');
        paint();
      } catch (err) { failed(err); }
    });
    paint();
    const isMine = !t.sample && (Store.getUser() === t.author || adminUnlocked);

    const fbText = h('textarea', { rows: 4, required: true, maxlength: 1000, placeholder: '예: 문제 글씨가 조금 더 컸으면 좋겠어요. / 3학년 단원도 추가되면 좋겠어요.' });
    const fbForm = h('form', {
      class: 'panel feedback',
      onsubmit: async (e) => {
        e.preventDefault();
        const text = fbText.value.trim();
        if (!text) return;
        const from = await requireName();
        if (!from) return;
        const ok = await Store.addFeedback(id, text, from).catch((err) => { console.error(err); return false; });
        if (ok) { fbText.value = ''; toast(`${t.author}님에게 의견을 전달했습니다.`); }
        else toast('의견을 저장하지 못했습니다.');
      },
    },
      h('h2', {}, '고쳤으면 하는 점 보내기'),
      h('p', { class: 'muted' }, `공개 댓글이 아니라 만든 사람(${t.author})에게만 전달됩니다.`),
      fbText,
      h('div', { class: 'row end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '제작자에게 보내기')));

    const fact = (label, value) => value && h('div', { class: 'fact' }, h('dt', {}, label), h('dd', {}, value));
    return h('div', { class: 'detail' },
      h('a', { class: 'back', href: '#/' }, '← 둘러보기'),
      h('div', { class: 'detail-grid' },
        h('div', { class: 'detail-main' },
          h('div', { class: 'card-top' }, subjectTag(t.subject), t.sample && h('span', { class: 'chip chip-sample' }, '예시')),
          h('h1', {}, t.title),
          h('p', { class: 'lead' }, t.summary),
          h('div', { class: 'row' }, openButton(t, 'btn btn-primary btn-lg'), likeBtn, favBtn,
            isMine && h('a', { class: 'btn', href: '#/edit/' + id }, '고치기')),
          h('section', { class: 'panel' }, h('h2', {}, '만든 의도'), h('p', { class: 'prose' }, t.intent)),
          t.howto && h('section', { class: 'panel' }, h('h2', {}, '사용 방법'), h('p', { class: 'prose' }, t.howto)),
          fbForm),
        h('aside', { class: 'panel facts' },
          thumbNode(t),
          h('h2', {}, '도구 정보'),
          h('dl', {},
            fact('만든 사람', t.author),
            fact('올린 날', fmtDate(t.createdAt)),
            fact('고친 날', t.updatedAt && fmtDate(t.updatedAt)),
            fact('과목', t.subject),
            fact('대상 학년', t.grade),
            fact('형식', t.kind === 'link' ? '링크 (새 탭에서 열림)' : 'HTML 파일 (사이트 안에서 실행)')),
          h('button', {
            class: 'btn btn-ghost btn-sm report', type: 'button',
            onclick: async () => {
              const from = await requireName();
              if (!from) return;
              const text = (prompt('어떤 문제가 있나요? (예: 학생 개인정보가 들어 있음, 실행되지 않음)') || '').trim();
              if (!text) return;
              const ok = await Store.addReport(id, text, from).catch((err) => { console.error(err); return false; });
              toast(ok ? '관리자에게 신고했습니다.' : '신고를 저장하지 못했습니다.');
            },
          }, '문제 신고'))));
  }

  /* ---------- 실행 ---------- */
  async function viewRun(id) {
    const t = await Store.getTool(id);
    if (!t) return notFound();
    if (t.kind === 'link') { location.replace('#/tool/' + id); return h('div'); }
    // 올린 프로그램이 사이트의 저장 내용에 손대지 못하도록 격리해서 실행합니다.
    const frame = h('iframe', { class: 'run-frame', title: t.title, sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-downloads', allow: 'fullscreen' });
    frame.srcdoc = t.html;
    return h('div', { class: 'run' },
      h('div', { class: 'run-bar' },
        h('a', { class: 'btn btn-sm', href: '#/' }, '← 목록'),
        h('a', { class: 'run-title', href: '#/tool/' + id }, h('strong', {}, t.title), h('span', {}, `${t.author} 제작`)),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => frame.requestFullscreen?.().catch(() => {}) }, '전체 화면')),
      frame);
  }

  /* ---------- 도구 올리기 · 고치기 ---------- */
  // editId가 있으면 이미 올린 도구를 고치는 화면입니다(내가 올린 도구, 또는 관리자).
  async function viewUpload(editId) {
    let editing = null;
    let byAdmin = false; // 관리자 권한으로 남의 도구를 고치는 중
    if (editId) {
      editing = await Store.getTool(editId);
      if (!editing) return notFound();
      byAdmin = adminUnlocked && editing.author !== Store.getUser();
      if (editing.sample || (editing.author !== Store.getUser() && !adminUnlocked)) {
        return h('div', { class: 'empty-state' },
          h('p', {}, '내가 올린 도구만 고칠 수 있습니다. 올린 분의 성함으로 로그인해 주세요.'),
          h('a', { class: 'btn btn-primary', href: '#/tool/' + editId }, '도구로 돌아가기'));
      }
    }
    const startKind = editing?.kind || 'html';
    let html = editing?.html || '';
    const fileInfo = html
      ? h('p', { class: 'drop-info' }, h('strong', {}, '지금 올라가 있는 파일을 그대로 씁니다'), h('br'), h('small', {}, '고친 파일로 바꾸려면 여기에 끌어다 놓거나 눌러서 고르세요'))
      : h('p', { class: 'drop-info' }, 'HTML 파일을 여기에 끌어다 놓거나 눌러서 고르세요', h('br'), h('small', {}, '.html 파일 한 개 · 900KB 이하'));
    const fileInput = h('input', { type: 'file', accept: '.html,.htm,text/html', class: 'sr-only', onchange: (e) => takeFile(e.target.files[0]) });
    const drop = h('label', { class: 'drop' + (html ? ' has-file' : ''), hidden: startKind !== 'html' }, fileInput, fileInfo);
    function takeFile(file) {
      if (!file) return;
      if (!/\.html?$/i.test(file.name)) return toast('HTML 파일(.html)만 올릴 수 있습니다.');
      if (file.size > MAX_HTML_BYTES) return toast('파일이 900KB를 넘습니다. 링크로 등록해 주세요.');
      const reader = new FileReader();
      reader.onload = () => {
        html = String(reader.result);
        drop.classList.add('has-file');
        fileInfo.replaceChildren(h('strong', {}, file.name), h('br'), h('small', {}, `${Math.ceil(file.size / 1024)}KB · 다른 파일로 바꾸려면 다시 누르세요`));
      };
      reader.onerror = () => toast('파일을 읽지 못했습니다.');
      reader.readAsText(file);
    }
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => takeFile(e.dataTransfer.files[0]));

    const urlInput = h('input', { type: 'url', placeholder: 'https://', 'aria-label': '도구 주소', value: editing?.url });
    const urlBox = h('div', { hidden: startKind !== 'link' }, urlInput, h('small', { class: 'muted' }, '이미 다른 곳에 올려 둔 웹앱의 주소입니다. 새 탭에서 열립니다.'));
    const kindRadio = (value, label, checked) => h('label', { class: 'seg' },
      h('input', { type: 'radio', name: 'kind', value, checked, onchange: () => { drop.hidden = value !== 'html'; urlBox.hidden = value !== 'link'; } }),
      h('span', {}, label));

    const f = {
      title: h('input', { type: 'text', required: true, maxlength: 40, placeholder: '예: 분수 덧셈 연습기', value: editing?.title }),
      summary: h('input', { type: 'text', required: true, maxlength: 60, placeholder: '카드에 보이는 한 문장', value: editing?.summary }),
      subject: h('select', { required: true }, h('option', { value: '' }, '과목 선택'), SUBJECTS.map((s) => h('option', { value: s }, s))),
      grade: h('select', {}, GRADES.map((g) => h('option', { value: g }, g))),
      intent: h('textarea', { rows: 4, required: true, maxlength: 600, placeholder: '왜 만들었고, 어떤 수업 장면에서 쓰는지 적어 주세요.', value: editing?.intent }),
      howto: h('textarea', { rows: 3, maxlength: 600, placeholder: '처음 쓰는 선생님을 위한 간단한 순서 (선택)', value: editing?.howto }),
    };
    if (editing) { f.subject.value = editing.subject; f.grade.value = editing.grade || GRADES[0]; }
    const field = (label, control, optional) => h('label', { class: 'field' }, h('span', {}, label, optional && h('em', {}, ' 선택')), control);

    // 썸네일: 고르기·끌어다 놓기·붙여넣기(Ctrl+V). 넣지 않으면 과목별 기본 그림.
    let thumb = editing?.thumb || '';
    const thumbSlot = h('div', {});
    const thumbClear = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => { thumb = ''; paintThumb(); } }, '기본 그림으로');
    function paintThumb() {
      thumbSlot.replaceChildren(thumbNode({ id: editing ? editing.id : f.title.value, subject: f.subject.value || '공통', thumb }));
      thumbClear.hidden = !thumb;
    }
    function takeImage(file) {
      if (!file) return;
      if (!file.type.startsWith('image/')) return toast('그림 파일만 넣을 수 있습니다.');
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // 16:10으로 가운데를 잘라 640×400으로 줄여 저장합니다.
        const W = 640, H = 400, scale = Math.max(W / img.width, H / img.height);
        const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, (W - img.width * scale) / 2, (H - img.height * scale) / 2, img.width * scale, img.height * scale);
        thumb = canvas.toDataURL('image/jpeg', 0.82);
        URL.revokeObjectURL(url);
        paintThumb();
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast('그림을 읽지 못했습니다.'); };
      img.src = url;
    }
    const thumbInput = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', onchange: (e) => takeImage(e.target.files[0]) });
    const thumbPick = h('div', { class: 'thumb-pick' }, thumbSlot,
      h('div', { class: 'side' },
        h('label', { class: 'btn btn-sm' }, thumbInput, '그림 고르기'),
        thumbClear,
        h('small', { class: 'muted' }, '화면을 캡처해 Ctrl+V로 붙여 넣어도 됩니다.', h('br'), '넣지 않으면 왼쪽 기본 그림이 들어갑니다.')));
    ['dragenter', 'dragover'].forEach((ev) => thumbPick.addEventListener(ev, (e) => { e.preventDefault(); thumbSlot.firstChild?.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => thumbPick.addEventListener(ev, (e) => { e.preventDefault(); thumbSlot.firstChild?.classList.remove('over'); }));
    thumbPick.addEventListener('drop', (e) => takeImage(e.dataTransfer.files[0]));
    f.subject.addEventListener('change', paintThumb);
    f.title.addEventListener('change', paintThumb);
    paintThumb();

    const form = h('form', {
      class: 'panel upload',
      onsubmit: async (e) => {
        e.preventDefault();
        const kind = form.elements.kind.value;
        const url = urlInput.value.trim();
        if (kind === 'html' && !html) return toast('HTML 파일을 넣어 주세요.');
        if (kind === 'link' && !/^https?:\/\/\S+$/i.test(url)) return toast('http:// 또는 https:// 로 시작하는 주소를 적어 주세요.');
        // 관리자가 고칠 때는 선생님 로그인을 묻지 않습니다. 만든 사람은 그대로 남습니다.
        const author = byAdmin ? editing.author : await requireName();
        if (!author) return;
        if (editing && author !== editing.author) return toast('내가 올린 도구만 고칠 수 있습니다.');
        const data = {
          title: f.title.value.trim(), summary: f.summary.value.trim(), subject: f.subject.value, grade: f.grade.value,
          intent: f.intent.value.trim(), howto: f.howto.value.trim(), kind,
          ...(kind === 'html' ? { html } : { url }),
          ...(thumb && { thumb }),
        };
        const id = await (editing
          ? Store.updateTool(editing.id, data).then((ok) => ok && editing.id)
          : Store.addTool({ ...data, author })).catch((err) => { console.error(err); return null; });
        if (!id) return toast('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        toast(editing ? '고친 내용을 저장했습니다.' : '도구를 올렸습니다.');
        location.hash = '#/tool/' + id;
      },
    },
      h('div', { class: 'segs', role: 'radiogroup', 'aria-label': '올리는 방식' }, kindRadio('html', 'HTML 파일 올리기', startKind === 'html'), kindRadio('link', '링크로 등록', startKind === 'link')),
      drop, urlBox,
      field('제목', f.title),
      field('한 줄 소개', f.summary),
      h('div', { class: 'field-row' }, field('과목', f.subject), field('대상 학년', f.grade)),
      field('만든 의도', f.intent),
      field('사용 방법', f.howto, true),
      h('div', { class: 'field' }, h('span', {}, '썸네일', h('em', {}, ' 선택')), thumbPick),
      h('p', { class: 'note' }, '학생 이름·성적 같은 개인정보가 들어 있는 파일은 올리지 마세요. 만든 사람과 올린 날짜는 자동으로 기록됩니다.'),
      h('div', { class: 'row end' },
        h('a', { class: 'btn', href: editing ? '#/tool/' + editing.id : '#/' }, '취소'),
        h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, editing ? '고친 내용 저장' : '올리기')));

    form.addEventListener('paste', (e) => {
      const image = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (image) { e.preventDefault(); takeImage(image); }
    });

    return h('div', { class: 'narrow' },
      h('h1', {}, editing ? '도구 고치기' : '도구 올리기'),
      h('p', { class: 'lead' }, byAdmin
        ? `관리자 권한으로 ${editing.author} 선생님의 도구를 고칩니다. 만든 사람은 바뀌지 않습니다.`
        : editing
        ? '받은 의견을 반영해 내용을 고치세요. 좋아요와 받은 의견은 그대로 남습니다.'
        : '만든 웹앱을 넣고 몇 칸만 채우면 모든 선생님과 공유됩니다.'),
      form);
  }

  /* ---------- 내 도구 ---------- */
  async function viewMine() {
    const me = Store.getUser();
    if (!me) {
      return h('div', { class: 'empty-state' },
        h('p', {}, '로그인하면 내가 올린 도구와 받은 의견을 볼 수 있습니다.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { if (await askName()) route(); } }, '로그인'));
    }
    const mine = (await Store.listTools()).filter((t) => t.author === me && !t.sample);
    const feedback = await Promise.all(mine.map((t) => Store.listFeedback(t.id)));
    return h('div', { class: 'narrow' },
      h('h1', {}, '내 도구'),
      h('p', { class: 'lead' }, `${me} 선생님이 올린 도구와, 다른 선생님이 보낸 의견입니다.`),
      mine.length ? mine.map((t, i) => {
        const fb = feedback[i];
        return h('section', { class: 'panel mine' },
          h('div', { class: 'mine-head' },
            h('div', {}, subjectTag(t.subject), h('h2', {}, h('a', { href: '#/tool/' + t.id }, t.title)),
              h('p', { class: 'muted' }, `${fmtDate(t.createdAt)} 올림${t.updatedAt ? ` · ${fmtDate(t.updatedAt)} 고침` : ''} · ♥ ${t.likes} · 받은 의견 ${fb.length}건`)),
            h('div', { class: 'row' },
              h('a', { class: 'btn btn-sm', href: '#/edit/' + t.id }, '고치기'),
              h('button', {
                class: 'btn btn-danger btn-sm', type: 'button',
                onclick: () => { if (confirm(`"${t.title}" 도구를 삭제할까요? 받은 의견도 함께 지워집니다.`)) act(Store.deleteTool(t.id)); },
              }, '삭제'))),
          fb.length
            ? h('ul', { class: 'fb-list' }, fb.map((x) => h('li', {}, h('p', { class: 'prose' }, x.text), h('small', { class: 'muted' }, `${x.from} · ${fmtDate(x.createdAt)}`))))
            : h('p', { class: 'muted' }, '아직 받은 의견이 없습니다.'));
      }) : h('div', { class: 'empty-state' },
        h('p', {}, '아직 올린 도구가 없습니다.'),
        h('a', { class: 'btn btn-primary', href: '#/upload' }, '도구 올리기')));
  }

  /* ---------- 관리자: 선생님 명단 등록, 신고 처리 ---------- */
  let adminUnlocked = false;
  async function viewAdmin() {
    if (!adminUnlocked) {
      const pw = h('input', { type: 'password', required: true, autocomplete: 'off', 'aria-label': '관리자 비밀번호' });
      const err = h('p', { class: 'error', role: 'alert', hidden: true }, '관리자 비밀번호가 맞지 않습니다.');
      return h('div', { class: 'narrow' },
        h('h1', {}, '관리자'),
        h('form', {
          class: 'panel upload',
          onsubmit: async (e) => {
            e.preventDefault();
            const ok = await Store.checkAdmin(pw.value).catch((x) => { console.error(x); return false; });
            if (ok) { adminUnlocked = true; route(); } else err.hidden = false;
          },
        }, h('label', { class: 'field' }, h('span', {}, '관리자 비밀번호'), pw), err,
          h('div', { class: 'row end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '들어가기'))));
    }
    const names = h('textarea', { rows: 12, placeholder: '한 줄에 한 분씩 적거나, 엑셀의 이름 열을 그대로 붙여 넣으세요.' });
    let accounts, reports, tools;
    try {
      [accounts, reports, tools] = await Promise.all([Store.listAccounts(), Store.listReports(), Store.listTools()]);
    } catch (err) {
      // 관리자 로그인 기한이 지났으면 비밀번호부터 다시 받습니다.
      if (err.message !== 'auth') throw err;
      adminUnlocked = false;
      return viewAdmin();
    }
    names.value = accounts.map((a) => a.name).join('\n');
    const managed = tools.filter((t) => !t.sample);
    return h('div', { class: 'narrow' },
      h('h1', {}, '관리자'),
      h('form', {
        class: 'panel upload',
        onsubmit: (e) => {
          e.preventDefault();
          const list = [...new Set(names.value.split(/[\n,\t]/).map((s) => s.trim()).filter(Boolean))];
          act(Store.setTeachers(list).then(() => toast(`선생님 ${list.length}분을 등록했습니다.`)));
        },
      },
        h('h2', {}, '선생님 명단'),
        h('p', { class: 'muted' }, '여기에 있는 성함만 로그인할 수 있습니다. 동명이인은 "김민수(수학)"처럼 구분해 적어 주세요.'),
        names,
        h('div', { class: 'row end' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '명단 저장'))),
      h('section', { class: 'panel' },
        h('h2', {}, '비밀번호 초기화'),
        h('p', { class: 'muted' }, '비밀번호를 잊은 선생님을 초기화하면, 가입 코드로 새 비밀번호를 다시 정할 수 있습니다.'),
        h('ul', { class: 'acct-list' }, accounts.map(({ name, active }) => {
          return h('li', {},
            h('span', {}, name),
            h('span', { class: 'muted' }, active ? '비밀번호 정함' : '아직 로그인 전'),
            active && h('button', {
              class: 'btn btn-sm', type: 'button',
              onclick: () => { if (confirm(`${name} 선생님의 비밀번호를 초기화할까요?`)) act(Store.resetPassword(name).then(() => toast('초기화했습니다.'))); },
            }, '초기화'));
        }))),
      h('section', { class: 'panel' },
        h('h2', {}, `올라온 도구 ${managed.length}개`),
        h('p', { class: 'muted' }, '관리자는 모든 선생님의 도구를 고치거나 삭제할 수 있습니다. 고쳐도 만든 사람은 바뀌지 않습니다.'),
        managed.length ? h('ul', { class: 'acct-list' }, managed.map((t) => h('li', {},
          h('span', {}, h('a', { href: '#/tool/' + t.id }, t.title)),
          h('span', { class: 'muted' }, `${t.author} · ${fmtDate(t.createdAt)}`),
          h('a', { class: 'btn btn-sm', href: '#/edit/' + t.id }, '고치기'),
          h('button', {
            class: 'btn btn-sm btn-danger', type: 'button',
            onclick: () => { if (confirm(`${t.author} 선생님의 "${t.title}" 도구를 삭제할까요? 받은 의견도 함께 지워지며 되돌릴 수 없습니다.`)) act(Store.deleteTool(t.id)); },
          }, '삭제')))) : h('p', { class: 'muted' }, '아직 올라온 도구가 없습니다.')),
      h('section', { class: 'panel' },
        h('h2', {}, `신고된 도구 ${reports.length}건`),
        reports.length ? h('ul', { class: 'fb-list' }, reports.map((r) => {
          const t = tools.find((x) => x.id === r.toolId);
          return h('li', {},
            h('strong', {}, t ? h('a', { href: '#/tool/' + t.id }, t.title) : '(삭제된 도구)'),
            h('p', { class: 'prose' }, r.text),
            h('small', { class: 'muted' }, `${r.from} · ${fmtDate(r.createdAt)}`),
            h('div', { class: 'row end' },
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => act(Store.dismissReport(r.id)) }, '문제없음'),
              t && !t.sample && h('button', {
                class: 'btn btn-sm btn-danger', type: 'button',
                onclick: () => { if (confirm(`"${t.title}" 도구를 내릴까요?`)) act(Store.deleteTool(t.id)); },
              }, '도구 내리기')));
        })) : h('p', { class: 'muted' }, '신고된 도구가 없습니다.')));
  }

  /* ---------- 화면 전환 ---------- */
  // 화면을 그리는 동안 다른 주소로 옮겨 가면, 먼저 시작한 화면은 버립니다.
  let routeSeq = 0;
  async function route() {
    const seq = ++routeSeq;
    const [, page, id] = location.hash.split('/');
    let view;
    try {
      view = await (page === 'tool' ? viewTool(id)
        : page === 'run' ? viewRun(id)
        : page === 'upload' ? viewUpload()
        : page === 'edit' ? viewUpload(id)
        : page === 'mine' ? viewMine()
        : page === 'admin' ? viewAdmin()
        : viewHome());
    } catch (err) {
      console.error(err);
      view = h('div', { class: 'empty-state' },
        h('p', {}, '내용을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => route() }, '다시 시도'));
    }
    if (seq !== routeSeq) return;
    document.body.classList.toggle('running', view.classList.contains('run'));
    app.replaceChildren(view);
    const current = page === 'mine' ? 'mine' : (!page || page === 'tool') ? 'home' : '';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === current));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  document.getElementById('demo-note').hidden = Store.mode === 'server';
  paintUser();
  route();
})();
