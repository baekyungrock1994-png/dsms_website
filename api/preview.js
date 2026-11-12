// 링크의 기본 정보(제목, 소개 문장, 대표 그림)를 대신 읽어 오는 작은 서버 기능입니다.
// 브라우저는 다른 사이트의 내용을 직접 읽지 못해서, '링크로 등록'의 [정보 가져오기]가 이 기능을 부릅니다.
// Vercel이 api 폴더의 파일을 자동으로 서버 기능으로 만들어 줍니다. 주소: /api/preview?url=https://…
//
// 안전장치: http/https의 기본 포트만, 내부망 주소 금지, 읽는 양과 시간 제한, 이 사이트에서 부른 요청만 받음.
'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_HTML = 512 * 1024;        // 페이지는 앞부분 512KB만 읽습니다(제목·소개는 맨 위에 있음).
const MAX_IMAGE = 2 * 1024 * 1024;  // 대표 그림은 2MB까지
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 4;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

// 바깥 인터넷의 평범한 웹 주소인지 확인합니다. 아니면 오류.
async function assertPublic(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  if (url.port || url.username || url.password) throw new Error('bad url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
}

// 주소를 읽어 { url(최종 주소), type, bytes }를 돌려줍니다. 옮겨 가는 주소(redirect)도 매번 검사합니다.
async function safeFetch(start, maxBytes, accept) {
  let url = new URL(start);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(url);
      const res = await fetch(url, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)', Accept: accept, 'Accept-Language': 'ko,en;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      if (!res.ok || !res.body) throw new Error('status ' + res.status);
      const chunks = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          if (accept.startsWith('image/')) throw new Error('too large'); // 잘린 그림은 쓸 수 없음
          chunks.push(value.subarray(0, value.length - (size - maxBytes)));
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      return { url, type: (res.headers.get('content-type') || '').toLowerCase(), bytes: Buffer.concat(chunks) };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
const clean = (s, max) => decode(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, max);

function decodeHtml(bytes, type) {
  const head = bytes.subarray(0, 2048).toString('latin1');
  const charset = (/charset=["']?([\w-]+)/i.exec(type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

// <meta property="og:title" content="…"> 꼴에서 값을 꺼냅니다(속성 순서가 바뀌어도).
function metaOf(html, names) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (/\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1];
    if (!key || !names.includes(key.toLowerCase())) continue;
    const value = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const text = value && (value[1] ?? value[2] ?? value[3]);
    if (text && text.trim()) return text;
  }
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (code, error) => res.status(code).json({ error });
  // 이 사이트의 화면에서 부른 요청만 받습니다(다른 사이트가 이 기능을 빌려 쓰지 못하게).
  if (req.headers['sec-fetch-site'] !== 'same-origin') return fail(403, 'forbidden');
  const target = String((req.query && req.query.url) || '');
  if (!/^https?:\/\/\S+$/i.test(target) || target.length > 2000) return fail(400, 'bad url');

  try {
    const page = await safeFetch(target, MAX_HTML, 'text/html,application/xhtml+xml');
    if (!/html/.test(page.type)) return fail(422, 'not html');
    const html = decodeHtml(page.bytes, page.type);
    const title = clean(metaOf(html, ['og:title', 'twitter:title']) || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 100);
    const description = clean(metaOf(html, ['og:description', 'description', 'twitter:description']), 200);

    let image = '';
    const imageRef = decode(metaOf(html, ['og:image', 'og:image:url', 'twitter:image'])).trim();
    if (imageRef) {
      try {
        const img = await safeFetch(new URL(imageRef, page.url), MAX_IMAGE, 'image/*');
        const type = img.type.split(';')[0].trim();
        if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(type) && img.bytes.length) {
          image = `data:${type};base64,${img.bytes.toString('base64')}`;
        }
      } catch { /* 그림은 없어도 됩니다 */ }
    }
    res.status(200).json({ title, description, image });
  } catch (err) {
    fail(502, 'fetch failed');
  }
};
