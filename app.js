const CLIENT_ID = "9958547442-37a3cf1gmijnd2dkvkf8cdgoaf813440.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive";
let token = null, folders = [], images = [], fIdx = -1, iIdx = -1;
let scale = 1, tx = 0, ty = 0, rot = 0, showSeq = 0;
const blobCache = new Map();
const rotStore = JSON.parse(localStorage.getItem("rot") || "{}");   // 사진별 회전 기억

const $ = id => document.getElementById(id);
const img = $("img");

// ----- 설정 -----
const savedSize = localStorage.getItem("thsize") || 52;
document.documentElement.style.setProperty("--thsize", savedSize + "px");
$("thSize").value = savedSize;
$("thSize").oninput = e => {
  document.documentElement.style.setProperty("--thsize", e.target.value + "px");
  localStorage.setItem("thsize", e.target.value);
};
$("delMode").onchange = e => document.body.classList.toggle("edit", e.target.checked);
$("setBtn").onclick = () => document.body.classList.toggle("panel");
$("refreshBtn").onclick = () => quietRefresh(true);
$("autoRefresh").checked = localStorage.getItem("autoref") !== "0";
$("autoRefresh").onchange = e => localStorage.setItem("autoref", e.target.checked ? "1" : "0");
$("autoLogin").checked = localStorage.getItem("auto") !== "0";
$("autoLogin").onchange = e => localStorage.setItem("auto", e.target.checked ? "1" : "0");

// ----- 로그인 -----
let started = false;
let refreshTimer = null;

const tokenClientCallback = r => {
  if (!r.access_token) return;
  token = r.access_token;
  const exp = Date.now() + (r.expires_in - 120) * 1000;
  localStorage.setItem("tok", JSON.stringify({ t: r.access_token, exp }));
  localStorage.setItem("hadLogin", "1");
  scheduleRefresh(exp);
  if (!started) { started = true; start(); }
};

const tokenClient = google.accounts.oauth2.initTokenClient({
  client_id: CLIENT_ID, scope: SCOPE, callback: tokenClientCallback
});

// 만료 3분 전에 미리 조용히 재발급 예약
function scheduleRefresh(exp) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const wait = Math.max(10000, exp - Date.now() - 180000);
  refreshTimer = setTimeout(silentAuth, wait);
}

function silentAuth() {
  if (localStorage.getItem("auto") === "0") return;
  try { tokenClient.requestAccessToken({ prompt: "" }); } catch (e) {}
}

$("signin").onclick = () => tokenClient.requestAccessToken();

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
  $("empty").textContent = msg || "로그인이 필요합니다";
}

// 자동 로그인: 저장된 토큰이 살아있으면 즉시 사용 + 갱신 예약, 아니면 조용히 재발급
(function autoLogin() {
  if (localStorage.getItem("auto") === "0") return;
  const saved = JSON.parse(localStorage.getItem("tok") || "null");
  if (saved && saved.exp > Date.now()) {
    token = saved.t; started = true; start(); scheduleRefresh(saved.exp);
  } else if (localStorage.getItem("hadLogin")) {
    silentAuth();
  }
})();

// 안전장치: 1분마다 만료 임박이면 갱신
setInterval(() => {
  if (localStorage.getItem("auto") === "0") return;
  const saved = JSON.parse(localStorage.getItem("tok") || "null");
  if (saved && saved.exp - Date.now() < 180000 && localStorage.getItem("hadLogin")) {
    silentAuth();
  }
}, 60000);

async function api(path, method, body) {
  const opt = { method: method || "GET", headers: { Authorization: "Bearer " + token } };
  if (body) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch("https://www.googleapis.com/drive/v3/" + path, opt);
  if (r.status === 401) { needLogin("로그인이 만료됐어요 — 다시 로그인해주세요"); throw new Error("401"); }
  if (!r.ok) throw new Error("API 오류 " + r.status);
  return r.status === 204 ? null : r.json();
}

async function fileBlobUrl(id) {
  if (blobCache.has(id)) return blobCache.get(id);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    { headers: { Authorization: "Bearer " + token } });
  const url = URL.createObjectURL(await r.blob());
  blobCache.set(id, url);
  return url;
}

/** 빠른 표시용: 구글이 만든 큰 압축본(s2048)을 사용 — 원본보다 훨씬 빠름 */
async function displayUrl(f) {
  const key = "disp_" + f.id;
  if (blobCache.has(key)) return blobCache.get(key);
  if (!f.thumbnailLink) return fileBlobUrl(f.id);
  const big = f.thumbnailLink.replace(/=s\d+.*$/, "=s2048");
  try {
    const r = await fetch(big, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw 0;
    const url = URL.createObjectURL(await r.blob());
    blobCache.set(key, url);
    return url;
  } catch (e) {
    return fileBlobUrl(f.id);   // 실패 시 원본
  }
}

// ----- 폴더 -----
async function loadFolders(keepIdx) {
  $("empty").textContent = "불러오는 중...";
  const q1 = encodeURIComponent("name='VFlatScans' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const root = (await api(`files?q=${q1}&fields=files(id)`)).files[0];
  if (!root) { $("empty").textContent = "드라이브에 VFlatScans 폴더가 없습니다"; return; }
  const q2 = encodeURIComponent(`'${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  folders = (await api(`files?q=${q2}&orderBy=createdTime desc&pageSize=200&fields=files(id,name)`)).files;
  renderFolders();
  if (folders.length) openFolder(Math.min(keepIdx || 0, folders.length - 1), 0);
  else {
    images = []; fIdx = -1;
    $("thumbs").style.display = "none";
    img.style.display = "none"; $("info").style.display = "none";
    $("empty").style.display = ""; $("empty").textContent = "아직 전송된 스캔이 없습니다";
  }
}

function renderFolders() {
  const box = $("folders");
  box.innerHTML = "";
  folders.forEach((f, i) => {
    const d = document.createElement("div");
    d.className = "folder";
    const s = document.createElement("span");
    s.textContent = f.name;
    const rename = document.createElement("button");
    rename.className = "fedit";
    rename.textContent = "✏️";
    rename.title = "이름 변경";
    rename.onclick = ev => renameFolder(i, ev);
    const del = document.createElement("button");
    del.className = "fdel";
    del.textContent = "삭제";
    del.onclick = ev => trashFolder(i, ev);
    d.append(s, rename, del);
    d.onclick = () => openFolder(i, 0);
    box.appendChild(d);
  });
}

async function renameFolder(i, ev) {
  ev.stopPropagation();
  const cur = folders[i].name;
  const name = prompt("폴더 이름 변경:", cur);
  if (!name || name.trim() === "" || name === cur) return;
  await api("files/" + folders[i].id, "PATCH", { name: name.trim() });
  folders[i].name = name.trim();
  renderFolders();
  [...$("folders").children].forEach((el, k) => el.classList.toggle("sel", k === fIdx));
  if (i === fIdx) $("info").textContent = `${name.trim()}  ·  ${iIdx + 1}/${images.length}`;
}

async function trashFolder(i, ev) {
  ev.stopPropagation();
  if (!confirm(`"${folders[i].name}" 폴더를 삭제할까요?\n(드라이브 휴지통으로 이동, 30일 내 복구 가능)`)) return;
  await api("files/" + folders[i].id, "PATCH", { trashed: true });
  loadFolders(fIdx === i ? i : (fIdx > i ? fIdx - 1 : fIdx));
}

/** 현재 보는 사진/확대상태를 건드리지 않고 목록만 조용히 갱신 */
async function quietRefresh(manual) {
  if (!token) return;
  const btn = $("refreshBtn");
  if (manual) btn.textContent = "🔄 갱신 중...";
  try {
    const q1 = encodeURIComponent("name='VFlatScans' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const rootRes = await api(`files?q=${q1}&fields=files(id)`);
    const root = rootRes.files[0];
    if (!root) return;
    const q2 = encodeURIComponent(`'${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const fresh = (await api(`files?q=${q2}&orderBy=createdTime desc&pageSize=200&fields=files(id,name)`)).files;

    // 폴더 목록이 달라졌으면: 현재 폴더 id를 유지하며 다시 그림
    const curId = folders[fIdx]?.id;
    const changed = fresh.length !== folders.length ||
      fresh.some((f, i) => f.id !== folders[i]?.id);
    if (changed) {
      folders = fresh;
      renderFolders();
      fIdx = Math.max(0, folders.findIndex(f => f.id === curId));
      [...$("folders").children].forEach((el, k) => el.classList.toggle("sel", k === fIdx));
    }

    // 현재 폴더 안의 사진 개수 갱신 (보던 사진은 그대로 유지)
    if (folders[fIdx]) {
      const q = encodeURIComponent(`'${folders[fIdx].id}' in parents and trashed=false and mimeType contains 'image/'`);
      const freshImgs = (await api(`files?q=${q}&orderBy=name&pageSize=500&fields=files(id,name,thumbnailLink)`)).files;
      if (freshImgs.length !== images.length) {
        const curImgId = images[iIdx]?.id;
        images = freshImgs;
        renderThumbs();
        iIdx = Math.max(0, images.findIndex(im => im.id === curImgId));
        [...$("thumbs").children].forEach((el, k) => el.classList.toggle("sel", k === iIdx));
        $("info").textContent = `${folders[fIdx].name}  ·  ${iIdx + 1}/${images.length}`;
      }
    }
  } catch (e) { /* 조용히 무시 */ }
  finally { if (manual) btn.textContent = "🔄 새로고침"; }
}

setInterval(() => {
  if (token && $("autoRefresh").checked) quietRefresh(false);
}, 30000);

// ----- 사진 -----
async function openFolder(i, startIdx) {
  fIdx = i;
  [...$("folders").children].forEach((el, k) => el.classList.toggle("sel", k === i));
  const q = encodeURIComponent(`'${folders[i].id}' in parents and trashed=false and mimeType contains 'image/'`);
  images = (await api(`files?q=${q}&orderBy=name&pageSize=500&fields=files(id,name,thumbnailLink)`)).files;
  renderThumbs();
  if (!images.length) {
    $("empty").style.display = ""; $("empty").textContent = "빈 폴더";
    img.style.display = "none"; $("info").style.display = "none";
    return;
  }
  show(startIdx < 0 ? images.length - 1 : startIdx);
}

function renderThumbs() {
  const t = $("thumbs");
  t.innerHTML = "";
  t.style.display = images.length ? "flex" : "none";
  images.forEach((f, i) => {
    const im = document.createElement("img");
    im.onclick = () => show(i);
    loadThumb(f, im);
    t.appendChild(im);
  });
}

async function loadThumb(f, im) {
  try {
    const r = await fetch(f.thumbnailLink, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw 0;
    im.src = URL.createObjectURL(await r.blob());
  } catch (e) {
    try { im.src = await fileBlobUrl(f.id); } catch (e2) { im.style.display = "none"; }
  }
}

async function show(i) {
  const my = ++showSeq;
  iIdx = i;
  rot = rotStore[images[i]?.id] || 0;   // 이 사진에 저장된 회전 복원
  resetView();
  [...$("thumbs").children].forEach((el, k) => el.classList.toggle("sel", k === i));
  $("thumbs").children[i]?.scrollIntoView({ inline: "nearest", block: "nearest" });
  $("empty").style.display = "none";
  $("info").style.display = "";
  $("info").textContent = `${folders[fIdx].name}  ·  ${i + 1}/${images.length}`;
  const url = await displayUrl(images[i]);
  if (my !== showSeq) return;
  img.src = url;
  img.style.display = "";
  $("prevBtn").style.display = $("nextBtn").style.display = "block";
  $("rotbar").style.display = "flex";
  // 앞뒤 3장씩 미리 받기 (빠른 넘김)
  for (let d = 1; d <= 3; d++) {
    if (images[i + d]) displayUrl(images[i + d]);
    if (images[i - d]) displayUrl(images[i - d]);
  }
}

function next() {
  if (iIdx < images.length - 1) show(iIdx + 1);
  else if (fIdx < folders.length - 1) openFolder(fIdx + 1, 0);
}
function prev() {
  if (iIdx > 0) show(iIdx - 1);
  else if (fIdx > 0) openFolder(fIdx - 1, -1);
}
$("prevBtn").onclick = prev;
$("nextBtn").onclick = next;

// ----- 확대/이동/회전 -----
function apply() { img.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg) scale(${scale})`; }
function resetView() { scale = 1; tx = ty = 0; apply(); }
function zoom(f) { scale = Math.min(12, Math.max(0.2, scale * f)); apply(); }

function rotate(delta) {
  rot = (rot + delta + 360) % 360;
  const id = images[iIdx]?.id;
  if (id) {
    if (rot === 0) delete rotStore[id]; else rotStore[id] = rot;
    localStorage.setItem("rot", JSON.stringify(rotStore));
  }
  apply();
}
$("rotLeft").onclick = () => rotate(-90);
$("rotRight").onclick = () => rotate(90);

document.addEventListener("keydown", e => {
  if (!images.length) return;
  if (e.key === "ArrowRight") next();
  else if (e.key === "ArrowLeft") prev();
  else if (e.key === "+" || e.key === "=") zoom(1.25);
  else if (e.key === "-" || e.key === "_") zoom(0.8);
  else if (e.key === "0") resetView();
  else if (e.key === "[" ) rotate(-90);
  else if (e.key === "]" ) rotate(90);
});

$("stage").addEventListener("wheel", e => {
  e.preventDefault();
  zoom(e.deltaY < 0 ? 1.15 : 0.87);
}, { passive: false });

img.addEventListener("dblclick", resetView);
let drag = null;
img.addEventListener("mousedown", e => { drag = { x: e.clientX - tx, y: e.clientY - ty }; e.preventDefault(); });
window.addEventListener("mousemove", e => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } });
window.addEventListener("mouseup", () => drag = null);
