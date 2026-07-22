// ===== 로그인/토큰 관리 =====
const CLIENT_ID = "9958547442-37a3cf1gmijnd2dkvkf8cdgoaf813440.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive";
let token = null;
let started = false;
let refreshTimer = null;
let renewing = false;

const $ = id => document.getElementById(id);

const tokenClientCallback = r => {
  if (!r.access_token) return;
  token = r.access_token;
  const exp = Date.now() + (r.expires_in - 120) * 1000;
  localStorage.setItem("tok", JSON.stringify({ t: r.access_token, exp }));
  localStorage.setItem("hadLogin", "1");
  scheduleRefresh(exp);
  $("signin").style.display = "none";
  saveAccountHint();   // 어느 계정인지 기억 (다음 갱신 때 계정 선택 창 안 뜨게)
  if (!started) { started = true; start(); }
  else if (!folders.length) loadFolders();
};

/** 로그인한 계정 이메일을 기억해뒀다가 갱신 때 힌트로 사용 */
async function saveAccountHint() {
  if (localStorage.getItem("hint")) return;
  try {
    const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user",
      { headers: { Authorization: "Bearer " + token } });
    const j = await r.json();
    if (j.user?.emailAddress) localStorage.setItem("hint", j.user.emailAddress);
  } catch (e) {}
}

function authOpts() {
  const hint = localStorage.getItem("hint");
  return hint ? { prompt: "", login_hint: hint } : { prompt: "" };
}

const tokenClient = google.accounts.oauth2.initTokenClient({
  client_id: CLIENT_ID, scope: SCOPE, callback: tokenClientCallback
});

function scheduleRefresh(exp) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(silentAuth, Math.max(10000, exp - Date.now() - 180000));
}

function silentAuth() {
  if (localStorage.getItem("auto") === "0") return;
  try { tokenClient.requestAccessToken(authOpts()); } catch (e) {}
}

/**
 * 핵심: 브라우저는 '사용자가 클릭/키를 누른 순간'에만 갱신 팝업을 허용한다.
 * 그래서 모든 클릭/키 입력 때 만료가 가까우면(15분 미만) 그 자리에서 즉시 갱신한다.
 */
function maybeRenew() {
  if (localStorage.getItem("auto") === "0") return;
  if (!localStorage.getItem("hadLogin")) return;
  if (renewing) return;
  const saved = JSON.parse(localStorage.getItem("tok") || "null");
  if (!saved || saved.exp - Date.now() < 15 * 60000) {
    renewing = true;
    setTimeout(() => { renewing = false; }, 15000);
    try { tokenClient.requestAccessToken(authOpts()); } catch (e) {}
  }
}
["pointerdown", "keydown"].forEach(ev =>
  document.addEventListener(ev, maybeRenew, true));

function start() {
  $("signin").style.display = "none";
  $("setBtn").style.display = "inline-block";
  $("refreshBtn").style.display = "inline-block";
  loadFolders();
}

function needLogin(msg) {
  token = null;
  localStorage.removeItem("tok");
  $("signin").style.display = "";
  $("empty").style.display = "";
  $("empty").textContent = msg || "화면 아무 곳이나 클릭하면 다시 연결됩니다";
}

// 시작: 저장된 토큰이 살아있으면 즉시 사용, 아니면 조용히 재발급
window.addEventListener("load", () => {
  $("signin").onclick = () => tokenClient.requestAccessToken();
  if (localStorage.getItem("auto") === "0") return;
  const saved = JSON.parse(localStorage.getItem("tok") || "null");
  if (saved && saved.exp > Date.now()) {
    token = saved.t; started = true; start(); scheduleRefresh(saved.exp);
  } else if (localStorage.getItem("hadLogin")) {
    silentAuth();
  }
});

// 백업: 1분마다 만료 임박 확인 (팝업이 차단될 수 있어 보조 수단)
setInterval(() => {
  if (localStorage.getItem("auto") === "0") return;
  const saved = JSON.parse(localStorage.getItem("tok") || "null");
  if (saved && saved.exp - Date.now() < 180000 && localStorage.getItem("hadLogin")) silentAuth();
}, 60000);

// ----- 영구 캐시 (IndexedDB): 한 번 받은 사진은 이 컴퓨터에 저장 -----
let idb = null;
const idbReady = new Promise(res => {
  try {
    const req = indexedDB.open("vflat", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("imgs");
    req.onsuccess = () => { idb = req.result; res(); };
    req.onerror = () => res();
  } catch (e) { res(); }
});
function idbGet(key) {
  return new Promise(r => {
    if (!idb) return r(null);
    try {
      const t = idb.transaction("imgs").objectStore("imgs").get(key);
      t.onsuccess = () => r(t.result || null);
      t.onerror = () => r(null);
    } catch (e) { r(null); }
  });
}
function idbPut(key, blob) {
  try { idb?.transaction("imgs", "readwrite").objectStore("imgs").put(blob, key); } catch (e) {}
}

async function api(path, method, body) {
  const opt = { method: method || "GET", headers: { Authorization: "Bearer " + token } };
  if (body) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch("https://www.googleapis.com/drive/v3/" + path, opt);
  if (r.status === 401) {
    needLogin("연결이 만료됐어요 — 화면 아무 곳이나 클릭하면 다시 연결됩니다");
    throw new Error("401");
  }
  if (!r.ok) throw new Error("API 오류 " + r.status);
  return r.status === 204 ? null : r.json();
}
