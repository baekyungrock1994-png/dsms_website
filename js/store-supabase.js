// 서버용 저장 계층(Supabase). js/config.js에 주소와 키가 채워져 있을 때만 켜지고,
// 비어 있으면 아무 일도 하지 않아 체험용(js/store.js)이 그대로 쓰입니다.
// 함수 이름·인자·돌려주는 값은 js/store.js와 같습니다. 서버 쪽 짝은 supabase/setup.sql입니다.
(function () {
  'use strict';
  const cfg = window.DSMS_CONFIG || {};
  const base = (cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = (cfg.supabaseKey || '').trim();
  if (!base || !key) return;

  const K = { session: 'dsms.hub.session', voter: 'dsms.hub.voter', favs: 'dsms.hub.favs' };
  const read = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
  };
  const write = (k, value) => {
    try { localStorage.setItem(k, JSON.stringify(value)); return true; } catch { return false; }
  };

  // 새 키(sb_publishable_…)는 apikey에만 싣습니다. 예전 anon 키(eyJ…)는 Authorization에도 함께 싣습니다.
  const headers = { 'Content-Type': 'application/json', apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;

  // 서버의 함수 하나를 부릅니다. 서버가 거절하면 그 이유(message)를 담은 Error를 던집니다.
  async function rpc(fn, args = {}) {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* JSON이 아닌 응답 */ }
    if (!res.ok) throw new Error((body && body.message) || `서버 응답 ${res.status}`);
    return body;
  }

  // 로그인 상태: 성함과 로그인 표(token)를 이 브라우저에 기억합니다. 비밀번호는 기억하지 않습니다.
  let session = read(K.session, null);
  const setSession = (value) => { session = value; write(K.session, value); };
  let adminToken = null; // 관리자 표는 기억하지 않습니다. 새로 고치면 다시 들어가야 합니다.
  const token = () => (session && session.token) || '';
  // 로그인이 필요한 함수. 서버가 로그인 표를 모른다고 하면(기한 지남·초기화됨) 이 브라우저도 로그아웃합니다.
  const asUser = (fn, args) => rpc(fn, { p_token: token(), ...args })
    .catch((err) => { if (err.message === 'auth') setSession(null); throw err; });
  const asAdmin = (fn, args) => rpc(fn, { p_token: adminToken || '', ...args })
    .catch((err) => { if (err.message === 'auth') adminToken = null; throw err; });

  // 좋아요는 로그인 없이 브라우저마다 한 번. 브라우저를 구분하는 임의의 번호입니다.
  const voter = () => {
    let v = read(K.voter, '');
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2).padEnd(16, '0'));
      write(K.voter, v);
    }
    return v;
  };

  // 목록은 잠깐 기억해 두어 화면을 오갈 때마다 다시 받지 않습니다. 내가 바꾸면 바로 버립니다.
  const LIST_KEEP_MS = 20000;
  let listCache = null, listAt = 0;
  const dropList = () => { listCache = null; };
  const tidy = (t) => t && { ...t, likes: Number(t.likes) || 0 };
  const toolData = (d) => ({
    title: d.title, summary: d.summary, subject: d.subject, grade: d.grade, intent: d.intent, howto: d.howto || '',
    kind: d.kind, url: d.url, html: d.html, thumb: d.thumb,
  });
  const toggleFavLocal = (id) => {
    const list = read(K.favs, []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    write(K.favs, list);
    return i < 0;
  };
  const signIn = (name) => (r) => {
    if (r.result === 'ok') setSession({ name, token: r.token });
    return r.result;
  };

  window.Store = {
    mode: 'server',

    /* ----- 로그인 ----- */
    getUser: () => (session && session.name) || '',
    accountState: (name) => rpc('account_state', { p_name: name }),
    // 'ok' | 'password' | 'locked'(여러 번 틀려 잠시 잠김)
    login: (name, password) => rpc('login', { p_name: name, p_password: password }).then(signIn(name)),
    // 'ok' | 'code' | 'short' | 'state' | 'locked'
    register: (name, code, newPassword) =>
      rpc('register', { p_name: name, p_code: code, p_password: newPassword }).then(signIn(name)),
    async logout() {
      const t = token();
      setSession(null);
      if (t) await rpc('logout', { p_token: t }).catch(() => {});
    },

    /* ----- 관리자 ----- */
    async checkAdmin(password) {
      const r = await rpc('admin_login', { p_password: password });
      adminToken = r.result === 'ok' ? r.token : null;
      return r.result === 'ok';
    },
    listAccounts: () => asAdmin('list_accounts'),
    setTeachers: (names) => asAdmin('set_teachers', { p_names: names }),
    resetPassword: (name) => asAdmin('reset_password', { p_name: name }),

    /* ----- 신고 ----- */
    // 보낸 사람은 서버가 로그인한 성함으로 기록합니다(from 인자는 쓰지 않음).
    addReport: (toolId, text) => asUser('add_report', { p_tool: toolId, p_text: text }),
    listReports: () => asAdmin('list_reports'),
    dismissReport: (id) => asAdmin('dismiss_report', { p_id: id }),

    /* ----- 도구 ----- */
    // 목록의 도구에는 html 본문이 없습니다. 본문은 getTool로 받습니다.
    async listTools() {
      if (!listCache || Date.now() - listAt > LIST_KEEP_MS) {
        listCache = (await rpc('list_tools')).map(tidy);
        listAt = Date.now();
      }
      return listCache.map((t) => ({ ...t }));
    },
    getTool: (id) => rpc('get_tool', { p_id: id }).then(tidy),
    // 만든 사람은 서버가 로그인한 성함으로 기록합니다.
    async addTool(data) {
      const id = await asUser('add_tool', { p_data: toolData(data) });
      dropList();
      return id;
    },
    async updateTool(id, data) {
      const ok = await asUser('update_tool', { p_id: id, p_data: toolData(data) });
      dropList();
      return ok;
    },
    async deleteTool(id) {
      const ok = await rpc('delete_tool', { p_token: token(), p_id: id, p_admin_token: adminToken });
      dropList();
      return ok;
    },

    /* ----- 좋아요·즐겨찾기 ----- */
    isLiked: (id) => rpc('is_liked', { p_voter: voter(), p_id: id }),
    async toggleLike(id) {
      const on = await rpc('toggle_like', { p_voter: voter(), p_id: id });
      dropList();
      return on;
    },
    // 즐겨찾기는 교실 컴퓨터마다 따로 두는 것이라 서버에 올리지 않고 이 브라우저에만 둡니다.
    async listFavs() { return read(K.favs, []); },
    async isFav(id) { return read(K.favs, []).includes(id); },
    async toggleFav(id) { return toggleFavLocal(id); },

    /* ----- 의견 ----- */
    addFeedback: (toolId, text) => asUser('add_feedback', { p_tool: toolId, p_text: text }),
    // 그 도구를 올린 본인에게만 내용이 옵니다. 다른 사람에게는 빈 목록.
    listFeedback: (toolId) => asUser('list_feedback', { p_tool: toolId }),
  };
})();
