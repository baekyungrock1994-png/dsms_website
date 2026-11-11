// 저장 계층. 화면(app.js)은 이 파일의 함수만 부릅니다.
// 지금은 체험용으로 이 브라우저(localStorage)에만 저장합니다.
// 2단계에서 이 파일만 서버용으로 바꾸면 모든 선생님이 같은 내용을 보게 됩니다.
//
// 약속: getUser()만 값을 바로 돌려주고, 나머지 함수는 모두 Promise를 돌려줍니다(await로 받기).
// 서버용으로 바꿀 때 함수 이름·인자·돌려주는 값을 그대로 지키면 app.js는 손대지 않아도 됩니다.
window.Store = (function () {
  'use strict';
  const K = {
    tools: 'dsms.hub.tools', likeDelta: 'dsms.hub.likeDelta', liked: 'dsms.hub.liked',
    favs: 'dsms.hub.favs', feedback: 'dsms.hub.feedback', user: 'dsms.hub.user',
    passwords: 'dsms.hub.passwords', teachers: 'dsms.hub.teachers', reports: 'dsms.hub.reports',
  };
  const read = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const toggleIn = (key, id) => {
    const list = read(key, []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    write(key, list);
    return i < 0;
  };

  // 체험용 비밀번호입니다. 이 파일은 누구나 읽을 수 있으므로 실제 비밀번호를 여기에 적으면 안 됩니다.
  // 정식 버전에서는 비밀번호 확인을 서버에서 합니다(설계서 8절).
  // DEMO_SHARED_PASSWORD는 첫 로그인 때 한 번 쓰는 '가입 코드'입니다.
  const DEMO_SHARED_PASSWORD = 'daesung-demo';
  const DEMO_ADMIN_PASSWORD = 'admin-demo';
  const DEMO_TEACHERS = ['홍길동', '김대성'];
  // 개인 비밀번호는 글자 그대로 두지 않고 변환해서 저장합니다(체험용 수준의 보호).
  const hash = async (name, password) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dsms|${name}|${password}`));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const teachers = () => read(K.teachers, DEMO_TEACHERS);
  const allTools = () => {
    const delta = read(K.likeDelta, {});
    return [...read(K.tools, []), ...(window.SEED_TOOLS || [])]
      .map((t) => ({ ...t, likes: Math.max(0, (t.likes || 0) + (delta[t.id] || 0)) }));
  };
  const stateOf = (name) => {
    if (!teachers().includes(name)) return 'unknown';
    return read(K.passwords, {})[name] ? 'active' : 'new';
  };

  return {
    mode: 'local', // 서버에 연결되면 js/store-supabase.js가 Store를 통째로 바꾸고 mode는 'server'가 됩니다.

    /* ----- 로그인 ----- */
    getUser: () => read(K.user, ''),
    // 'unknown'(등록되지 않은 성함) | 'new'(아직 비밀번호를 정하지 않음) | 'active'
    async accountState(name) { return stateOf(name); },
    // 'ok' | 'password'(비밀번호 틀림)
    async login(name, password) {
      if (stateOf(name) !== 'active') return 'password';
      if (read(K.passwords, {})[name] !== await hash(name, password)) return 'password';
      write(K.user, name);
      return 'ok';
    },
    // 첫 로그인: 가입 코드를 확인하고 개인 비밀번호를 정합니다. 'ok' | 'code' | 'short' | 'state'
    async register(name, code, newPassword) {
      if (stateOf(name) !== 'new') return 'state';
      if (code !== DEMO_SHARED_PASSWORD) return 'code';
      if (newPassword.length < 6) return 'short';
      write(K.passwords, { ...read(K.passwords, {}), [name]: await hash(name, newPassword) });
      write(K.user, name);
      return 'ok';
    },
    async logout() { write(K.user, ''); },

    /* ----- 관리자 ----- */
    async checkAdmin(password) { return password === DEMO_ADMIN_PASSWORD; },
    // [{ name, active }] — active는 비밀번호를 정했는지
    async listAccounts() {
      const pw = read(K.passwords, {});
      return teachers().map((name) => ({ name, active: Boolean(pw[name]) }));
    },
    // 명단에서 빠진 선생님의 비밀번호도 함께 지웁니다.
    async setTeachers(names) {
      const kept = Object.fromEntries(Object.entries(read(K.passwords, {})).filter(([n]) => names.includes(n)));
      write(K.passwords, kept);
      return write(K.teachers, names);
    },
    // 비밀번호를 잊은 선생님: 초기화하면 가입 코드로 다시 정할 수 있습니다.
    async resetPassword(name) {
      const all = read(K.passwords, {});
      delete all[name];
      write(K.passwords, all);
    },

    /* ----- 신고 ----- */
    async addReport(toolId, text, from) {
      return write(K.reports, [{ id: newId(), toolId, text, from, createdAt: now() }, ...read(K.reports, [])]);
    },
    async listReports() { return read(K.reports, []); },
    async dismissReport(id) { return write(K.reports, read(K.reports, []).filter((r) => r.id !== id)); },

    /* ----- 도구 ----- */
    async listTools() { return allTools(); },
    async getTool(id) { return allTools().find((t) => t.id === id) || null; },
    // 저장에 성공하면 새 도구의 id, 실패하면 null
    async addTool(data) {
      const tool = { ...data, id: newId(), createdAt: now(), likes: 0 };
      return write(K.tools, [tool, ...read(K.tools, [])]) ? tool.id : null;
    },
    // 내용을 통째로 바꿉니다. 만든 사람·올린 날·좋아요는 그대로 두고 고친 날을 남깁니다. 성공하면 true
    async updateTool(id, data) {
      const tools = read(K.tools, []);
      const i = tools.findIndex((t) => t.id === id);
      if (i < 0) return false;
      const { author, createdAt, likes } = tools[i];
      tools[i] = { ...data, id, author, createdAt, likes, updatedAt: now() };
      return write(K.tools, tools);
    },
    async deleteTool(id) {
      write(K.tools, read(K.tools, []).filter((t) => t.id !== id));
      write(K.feedback, read(K.feedback, []).filter((f) => f.toolId !== id));
      write(K.reports, read(K.reports, []).filter((r) => r.toolId !== id));
    },

    /* ----- 좋아요·즐겨찾기 ----- */
    async isLiked(id) { return read(K.liked, []).includes(id); },
    // 누른 뒤의 상태(true = 좋아요 켜짐)를 돌려줍니다.
    async toggleLike(id) {
      const on = toggleIn(K.liked, id);
      const delta = read(K.likeDelta, {});
      delta[id] = (delta[id] || 0) + (on ? 1 : -1);
      write(K.likeDelta, delta);
      return on;
    },
    async listFavs() { return read(K.favs, []); },
    async isFav(id) { return read(K.favs, []).includes(id); },
    async toggleFav(id) { return toggleIn(K.favs, id); },

    /* ----- 의견 ----- */
    async addFeedback(toolId, text, from) {
      return write(K.feedback, [{ id: newId(), toolId, text, from, createdAt: now() }, ...read(K.feedback, [])]);
    },
    async listFeedback(toolId) { return read(K.feedback, []).filter((f) => f.toolId === toolId); },
  };
})();
