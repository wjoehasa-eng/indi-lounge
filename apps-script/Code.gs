/**
 * 라운지 인기글 — Apps Script 웹 앱 백엔드 템플릿
 * -------------------------------------------------------------
 * 이 파일은 "빈 껍데기" 공개 앱에 실제 아카이브를 연결하는 서버 코드입니다.
 * 개인 계정 정보·실제 URL·파일 ID는 하나도 들어 있지 않습니다.
 *
 * [설치 순서]
 * 1. script.google.com 에서 새 프로젝트를 만들고 이 파일 내용을 Code.gs에 붙여넣습니다.
 * 2. 드라이브에 빈 파일 `lounge-archive.json`을 만들고, 파일 ID를 복사해
 *    아래 ARCHIVE_FILE_ID 에 넣습니다. (또는 편집기에서 createArchiveFile() 한 번 실행)
 * 3. WRITE_TOKEN 에 수집용 임의의 긴 문자열을 넣습니다. (읽기만 할 거면 비워 두어도 됩니다)
 * 4. 배포 → 새 배포 → 유형 '웹 앱'
 *    - 다음 사용자로 실행: 나
 *    - 액세스 권한: 링크가 있는 모든 사용자 (앱이 로그인 없이 읽어야 하므로)
 * 5. 배포된 /exec 주소를 앱의 ⚙ 설정에 붙여넣습니다.
 *
 * [데이터 형식] (아카이브 JSON)
 * {
 *   "updatedAt": "2026-11-25T10:20:00+09:00",
 *   "periods": {
 *     "hourly": { "2026-11-25-18": { "label": "11월 25일 (수) 18시", "caption": "15:00~17:59 · TOP 30",
 *                                 "collectedAt": "오후 6:00", "posts": [ ... ] } },
 *     "daily":  { "2026-11-25": { "label": "11월 25일 (수)", "caption": "오늘 · 오전 10:20 기준",
 *                                "collectedAt": "오전 10:20", "posts": [ ... ] } },
 *     "weekly": { "2026-11-W4": { ... } },
 *     "monthly":{ "2026-11": { ... } }
 *   }
 * }
 *
 * 기간 키(key)
 *  - hourly:  `YYYY-MM-DD-HH` (HH는 12·15·18) — 그 시간대 직전 3시간 글 (09~11시 → 12, 12~14시 → 15, 15~17시 → 18)
 *  - daily:   `YYYY-MM-DD`, weekly: `YYYY-Wnn`, monthly: `YYYY-MM`
 *
 * 글 한 건: { id, author, body, at, likes, comments, scraps, image, imageFull, isNew }
 *  - at: ISO 8601 (예: 2026-11-25T08:12:00+09:00)
 *  - image: 목록용 썸네일 URL, imageFull: 상세용 큰 이미지 URL (없으면 생략)
 */

var ARCHIVE_FILE_ID = '';  // ← 아카이브 JSON 파일 ID를 넣으세요.
var WRITE_TOKEN = '';      // ← 수집 스크립트용 비밀 토큰 (비우면 쓰기 잠금)

var MODES = ['hourly', 'daily', 'weekly', 'monthly'];

/* ------------------------------------------------------------ */
/* GET: 앱이 읽는 경로                                            */
/* ------------------------------------------------------------ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'index';
  var out;
  try {
    if (action === 'ping') {
      out = { ok: true, at: new Date().toISOString() };
    } else if (action === 'index') {
      out = getIndex_();
    } else if (action === 'list') {
      out = getList_(p.mode || 'daily', p.key || '');
    } else {
      out = { ok: false, error: 'unknown_action' };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return respond_(out, p.callback);
}

/* ------------------------------------------------------------ */
/* POST: 수집 스크립트가 쓰는 경로 (토큰 필요)                     */
/* ------------------------------------------------------------ */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!WRITE_TOKEN || body.token !== WRITE_TOKEN) {
      return respond_({ ok: false, error: 'unauthorized' }, body.callback);
    }
    var mode = body.mode;
    var key = String(body.key || '');
    if (MODES.indexOf(mode) < 0 || !key) {
      return respond_({ ok: false, error: 'bad_params' }, body.callback);
    }
    var archive = readArchive_();
    archive.periods[mode] = archive.periods[mode] || {};
    var cur = archive.periods[mode][key] || { posts: [] };

    var posts = (body.posts || []).map(normalizePost_);
    if (body.action === 'append') {
      cur.posts = mergePosts_(cur.posts || [], posts);
    } else {
      cur.posts = posts;
    }
    cur.label = body.label || cur.label || key;
    cur.caption = body.caption || cur.caption || '';
    cur.collectedAt = body.collectedAt || cur.collectedAt || '';
    cur.updatedAt = new Date().toISOString();
    archive.periods[mode][key] = cur;
    archive.updatedAt = new Date().toISOString();
    writeArchive_(archive);
    out = { ok: true, mode: mode, key: key, count: cur.posts.length };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return respond_(out);
}

/* ------------------------------------------------------------ */
/* 내부                                                          */
/* ------------------------------------------------------------ */
function getIndex_() {
  var archive = readArchive_();
  var periods = { hourly: [], daily: [], weekly: [], monthly: [] };
  MODES.forEach(function (mode) {
    var bucket = archive.periods[mode] || {};
    Object.keys(bucket).forEach(function (key) {
      var p = bucket[key] || {};
      periods[mode].push({
        key: key,
        label: p.label || key,
        caption: p.caption || '',
        collectedAt: p.collectedAt || '',
        count: (p.posts || []).length,
        updatedAt: p.updatedAt || ''
      });
    });
    periods[mode].sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });
  });
  return {
    ok: true,
    updatedAt: archive.updatedAt || '',
    periods: periods
  };
}

function getList_(mode, key) {
  if (MODES.indexOf(mode) < 0) throw new Error('bad_mode');
  var archive = readArchive_();
  var bucket = archive.periods[mode] || {};
  var p = bucket[key];
  if (!p) throw new Error('not_found');
  var posts = (p.posts || []).slice().sort(function (a, b) { return (+b.likes || 0) - (+a.likes || 0); });
  return {
    ok: true,
    mode: mode,
    key: key,
    label: p.label || key,
    caption: p.caption || '',
    collectedAt: p.collectedAt || '',
    count: posts.length,
    posts: posts
  };
}

function archiveFile_() {
  if (!ARCHIVE_FILE_ID) throw new Error('ARCHIVE_FILE_ID가 비어 있습니다. README의 설치 순서를 확인하세요.');
  return DriveApp.getFileById(ARCHIVE_FILE_ID);
}

function readArchive_() {
  var file = archiveFile_();
  var text = file.getBlob().getDataAsString('UTF-8');
  if (!text || !text.trim()) return { updatedAt: '', periods: { hourly: {}, daily: {}, weekly: {}, monthly: {} } };
  var data = JSON.parse(text);
  data.periods = data.periods || {};
  MODES.forEach(function (m) { data.periods[m] = data.periods[m] || {}; });
  return data;
}

function writeArchive_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    archiveFile_().setContent(JSON.stringify(data));
  } finally {
    lock.releaseLock();
  }
}

function normalizePost_(p) {
  return {
    id: String(p.id != null ? p.id : ''),
    author: String(p.author || '익명'),
    body: String(p.body || ''),
    at: String(p.at || ''),
    likes: Number(p.likes || 0),
    comments: Number(p.comments || 0),
    scraps: Number(p.scraps || 0),
    image: p.image ? String(p.image) : '',
    imageFull: p.imageFull ? String(p.imageFull) : (p.image ? String(p.image) : ''),
    isNew: !!p.isNew
  };
}

function mergePosts_(oldPosts, newPosts) {
  var map = {};
  oldPosts.forEach(function (p) { map[String(p.id)] = p; });
  newPosts.forEach(function (p) { map[String(p.id)] = p; });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return (+b.likes || 0) - (+a.likes || 0); });
}

function respond_(obj, callback) {
  var json = JSON.stringify(obj);
  var cb = String(callback || '');
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------ */
/* 편의 함수 (편집기에서 직접 실행)                                */
/* ------------------------------------------------------------ */
/** 아카이브 JSON 파일을 새로 만들어 ID를 로그에 남깁니다. */
function createArchiveFile() {
  var f = DriveApp.createFile('lounge-archive.json', JSON.stringify({
    updatedAt: new Date().toISOString(),
    periods: { hourly: {}, daily: {}, weekly: {}, monthly: {} }
  }), MimeType.PLAIN_TEXT);
  Logger.log('만들어진 파일 ID: ' + f.getId() + '\n이 값을 ARCHIVE_FILE_ID 에 넣으세요.');
  return f.getId();
}

/** 설정이 맞는지 확인합니다. */
function testIndex() {
  Logger.log(JSON.stringify(getIndex_(), null, 2));
}
