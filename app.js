// === Tennis Vision — V2 (compte à rebours + consignes en haut-gauche de la vidéo) ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const videoEl = $("#player");
videoEl.framerate = 25;
const overlay = $("#overlay");
const overlayPrompt = $("#overlayPrompt");
const sessionEnd = $("#sessionEnd");
const summaryStats = $("#summaryStats");
const restartSessionBtn = $("#restartSession");
const closeSummaryBtn = $("#closeSummary");
const playPauseBtn = $("#playPause");
const frameBackBtn = $("#frameBack");
const frameForwardBtn = $("#frameForward");
const playbackRateSelect = $("#playbackRate");
const optionsWrap = $("#optionsWrap");

const videoFileInput = $("#videoFile");
const scenarioFileInput = $("#scenarioFile");

const addPredictBtn = $("#addPredict");
const addDecisionBtn = $("#addDecision");
const markAnswerBtn = $("#markAnswer");
const exportScenarioBtn = $("#exportScenario");

const decisionOptionsInput = $("#decisionOptions");
const decisionCorrectInput = $("#decisionCorrect");
const zoneModeCheckbox = $("#zoneMode");
const gridColsInput = $("#gridCols");
const gridRowsInput = $("#gridRows");

const editModal = $("#editStopModal");
const editStopTimeInput = $("#editStopTime");
const editStopTypeSelect = $("#editStopType");
const editZoneModeCheckbox = $("#editZoneMode");
const editGridColsInput = $("#editGridCols");
const editGridRowsInput = $("#editGridRows");
const editGridXInput = $("#editGridX");
const editGridYInput = $("#editGridY");
const editAnswerXInput = $("#editAnswerX");
const editAnswerYInput = $("#editAnswerY");
const editOptionsInput = $("#editOptions");
const editCorrectInput = $("#editCorrect");
const saveEditStopBtn = $("#saveEditStop");
const cancelEditStopBtn = $("#cancelEditStop");
const editPredictFields = $("#editPredictFields");
const editDecisionFields = $("#editDecisionFields");

const stopsTableBody = $("#stopsTable tbody");

const startSessionBtn = $("#startSession");
const exportCSVBtn = $("#exportCSV");
const exportJSONBtn = $("#exportJSON");
const sessionStats = $("#sessionStats");
const rtHistogramCanvas = $("#rtHistogram");
const perStopListEl = $("#perStopScores");

let currentVideoURL = null;
let scenario = { version: 2, meta: { title: "Scénario sans titre", createdAt: new Date().toISOString() }, stops: [] };

let editorMode = true;
let pendingSetAnswerForIndex = null;

// Résultats/session
let results = [];
let playQueue = [];
let nextStopIdx = 0;
let sessionActive = false;
let pauseGuard = false;

// wrap overlay au-dessus de la vidéo
let wrap = null;
function ensureWrap() {
  if (wrap) return;
  wrap = document.createElement("div");
  wrap.id = "playerWrap";
  wrap.style.position = "relative";
  wrap.style.display = "inline-block";
  videoEl.parentNode.insertBefore(wrap, videoEl);
  wrap.appendChild(videoEl);
  wrap.appendChild(overlay);
  overlay.style.position = "absolute";
  overlay.style.left = "0px";
  overlay.style.top = "0px";
  overlay.style.pointerEvents = "none";
}

// Helpers UI
function resizeOverlayToVideo() {
  ensureWrap();
  const w = videoEl.clientWidth || videoEl.videoWidth || 640;
  const h = videoEl.clientHeight || (videoEl.videoWidth ? videoEl.videoHeight * (w / videoEl.videoWidth) : 360);
  overlay.width = w; overlay.height = h;
  overlay.style.width = w + "px"; overlay.style.height = h + "px";
  positionPrompt(); positionOptionsWrap();
  redrawOverlay();
}

// Place la consigne en HAUT-GAUCHE de la vidéo
function positionPrompt() {
  if (!overlayPrompt) return;
  const rect = wrap.getBoundingClientRect();
  overlayPrompt.style.position = "fixed";
  overlayPrompt.style.left = (rect.left + 12) + "px";
  overlayPrompt.style.top  = (rect.top  + 12) + "px";
  overlayPrompt.style.transform = "none";
  overlayPrompt.style.maxWidth = Math.max(260, rect.width * 0.5) + "px";
  overlayPrompt.style.background = "rgba(0,0,0,0.55)";
  overlayPrompt.style.color = "#fff";
  overlayPrompt.style.padding = "8px 10px";
  overlayPrompt.style.borderRadius = "8px";
  overlayPrompt.style.fontWeight = "600";
  overlayPrompt.style.zIndex = 9999;
}

function positionOptionsWrap() {
  if (!optionsWrap) return;
  const rect = wrap.getBoundingClientRect();
  optionsWrap.style.position = "fixed";
  optionsWrap.style.transform = "translate(-50%, -50%)";
  optionsWrap.style.left = (rect.left + rect.width/2) + "px";
  optionsWrap.style.top  = (rect.top  + rect.height*0.78) + "px";
}

function showPrompt(html) { if(!overlayPrompt) return; overlayPrompt.innerHTML = html; overlayPrompt.classList.remove("hidden"); positionPrompt(); }
function hidePrompt() { if(!overlayPrompt) return; overlayPrompt.classList.add("hidden"); }
function clearOptions() { if(!optionsWrap) return; optionsWrap.innerHTML = ""; optionsWrap.classList.add("hidden"); }
function renderOptions(options, onPick) {
  clearOptions();
  options.forEach(opt => { const b = document.createElement("button"); b.textContent = opt; b.onclick = () => onPick(opt); optionsWrap.appendChild(b); });
  optionsWrap.classList.remove("hidden"); positionOptionsWrap();
}

// Zones
function getZoneFromSplit(relX, relY, gs) {
  const cols = gs?.cols || 2;
  const rows = gs?.rows || 2;
  const xSplits = (Array.isArray(gs?.x) ? gs.x : [gs?.x ?? 0.5]).slice().sort((a,b)=>a-b);
  const ySplits = (Array.isArray(gs?.y) ? gs.y : [gs?.y ?? 0.5]).slice().sort((a,b)=>a-b);
  let col = cols - 1;
  for (let i = 0; i < xSplits.length; i++) {
    if (relX < xSplits[i]) { col = i; break; }
  }
  let row = rows - 1;
  for (let j = 0; j < ySplits.length; j++) {
    if (relY < ySplits[j]) { row = j; break; }
  }
  return { col, row, id: row * cols + col + 1 };
}
function getRelFromEvent(evt) {
  const rect = overlay.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top) / rect.height;
  return { x: Math.max(0,Math.min(1,x)), y: Math.max(0,Math.min(1,y)) };
}

// Dessin overlay
let activeGridForEditor = null;
let feedbackFlash = null; // {zones:[{id,color}], endsAt, grid}

function redrawOverlay() {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0,0,overlay.width,overlay.height);

  // Grille en éditeur (si on définit la réponse)
  if (editorMode && pendingSetAnswerForIndex != null) {
    const s = scenario.stops[pendingSetAnswerForIndex];
    const gs = activeGridForEditor || s?.gridSplit;
    if (s?.zoneMode && gs) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,0,0,0.95)";
      ctx.lineWidth = 2;
      const xs = (Array.isArray(gs.x) ? gs.x : [gs.x ?? 0.5]).slice().sort((a,b)=>a-b);
      const ys = (Array.isArray(gs.y) ? gs.y : [gs.y ?? 0.5]).slice().sort((a,b)=>a-b);
      xs.forEach(x => { const px = x * overlay.width; ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,overlay.height); ctx.stroke(); });
      ys.forEach(y => { const py = y * overlay.height; ctx.beginPath(); ctx.moveTo(0,py); ctx.lineTo(overlay.width,py); ctx.stroke(); });
      ctx.restore();
    }
  }

  // Feedback éphémère pendant la séance
  if (feedbackFlash && performance.now() < feedbackFlash.endsAt) {
    const boxes = zoneBoxes(feedbackFlash.grid);
    feedbackFlash.zones.forEach(z => drawZoneStroke(ctx, boxes[z.id], z.color, 6));
    requestAnimationFrame(redrawOverlay);
  }
}
function zoneBoxes(gs) {
  const cols = gs?.cols || 2;
  const rows = gs?.rows || 2;
  const xSplits = (Array.isArray(gs?.x) ? gs.x : [gs?.x ?? 0.5]).slice().sort((a,b)=>a-b);
  const ySplits = (Array.isArray(gs?.y) ? gs.y : [gs?.y ?? 0.5]).slice().sort((a,b)=>a-b);
  const xCoords = [0, ...xSplits.map(v => v * overlay.width), overlay.width];
  const yCoords = [0, ...ySplits.map(v => v * overlay.height), overlay.height];
  const boxes = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c + 1;
      boxes[id] = {
        x: xCoords[c],
        y: yCoords[r],
        w: xCoords[c+1] - xCoords[c],
        h: yCoords[r+1] - yCoords[r]
      };
    }
  }
  return boxes;
}
function drawZoneStroke(ctx, box, color, lw=4) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

// Lecture / séance
function startSession() {
  if (!videoEl.duration) { alert("Chargez d'abord une vidéo."); return; }
  if (!scenario.stops?.length) { alert("Chargez un scénario ou créez des arrêts dans l'éditeur."); return; }
  scenario.stops.sort((a,b)=>a.t-b.t);
  playQueue = scenario.stops.map((_,i)=>i);
  nextStopIdx = 0; results = [];
  sessionActive = true; editorMode = false;
  hidePrompt(); clearOptions(); sessionEnd?.classList.add("hidden");
  // Compte à rebours 5 -> 1 -> GO puis lecture
  runCountdownThen(() => {
    videoEl.currentTime = 0;
    videoEl.play();
    tickStopWatcher();
  });
}

function finishSession() {
  sessionActive = false; videoEl.pause(); renderSessionStats();
  if (summaryStats && sessionEnd) {
    const s = computeStats();
    summaryStats.innerHTML = `
      <p>Nombre d'arrêts traités: <b>${s.n || 0}</b></p>
      <p>Temps de réaction moyen: <b>${s.meanRT || 0} ms</b></p>
      <p>Taux de bonnes réponses: <b>${s.accuracy || 0}%</b></p>
      ${s.meanDist!=null ? `<p>Erreur moyenne (clic vs réponse): <b>${s.meanDist} px</b></p>` : ""}
    `;
    sessionEnd.classList.remove("hidden");
  }
}
let tickRAF = null;
function tickStopWatcher() {
  if (!sessionActive) return;
  if (nextStopIdx >= playQueue.length) { finishSession(); return; }
  const stop = scenario.stops[ playQueue[nextStopIdx] ];
  const current = videoEl.currentTime;
  if (current >= stop.t && !pauseGuard) {
    pauseGuard = true; videoEl.pause();
    setTimeout(() => handleStop(playQueue[nextStopIdx]), 0);
  } else {
    tickRAF = requestAnimationFrame(tickStopWatcher);
  }
}

function handleStop(index) {
  const stop = scenario.stops[index];
  const pauseTime = performance.now();
  overlay.style.pointerEvents = "auto";
  redrawOverlay();

  if (stop.type === "predict-landing" && stop.zoneMode) {
    showPrompt("Clique dans la <b>zone</b> où la balle va <b>tomber</b>.");
    const clickHandler = (evt) => {
      const now = performance.now();
      const rtMs = Math.round(now - pauseTime);
      const rel = getRelFromEvent(evt);
      const zoneObj = getZoneFromSplit(rel.x, rel.y, stop.gridSplit);
      const chosenId = zoneObj.id;
      const correctId = stop.answerZone?.id ?? null;
      const correct = (correctId != null && chosenId === correctId);

      // Feedback un peu plus long (1200ms)
      feedbackFlash = {
        grid: stop.gridSplit,
        zones: correct
          ? [{id: chosenId, color: "rgba(16,185,129,0.95)"}]
          : [{id: chosenId, color: "rgba(239,68,68,0.95)"}, {id: correctId, color: "rgba(16,185,129,0.95)"}],
        endsAt: performance.now() + 1200
      };
      redrawOverlay();

      results.push({ stopIndex: index, type: stop.type, t: stop.t, rtMs, correct, zone: {id: chosenId} });
      overlay.removeEventListener("click", clickHandler);
      overlay.style.pointerEvents = "none";
      hidePrompt();
      nextStopIdx++; pauseGuard = false;
      if (nextStopIdx >= playQueue.length) { finishSession(); }
      else { videoEl.play(); requestAnimationFrame(tickStopWatcher); }
    };
    overlay.addEventListener("click", clickHandler);

  } else if (stop.type === "predict-landing") {
    showPrompt("Clique sur la <b>zone d'atterrissage</b> de la balle.");
    const clickHandler = (evt) => {
      const now = performance.now();
      const rtMs = Math.round(now - pauseTime);
      const rect = overlay.getBoundingClientRect();
      const rel = getRelFromEvent(evt);
      let correct = false;
      let distancePx = null;
      if (stop.answerPoint) {
        const dx = (rel.x - stop.answerPoint.x) * rect.width;
        const dy = (rel.y - stop.answerPoint.y) * rect.height;
        distancePx = Math.sqrt(dx*dx + dy*dy);
        const tol = Math.max(rect.width, rect.height) * 0.08;
        correct = distancePx <= tol;
      }
      results.push({ stopIndex: index, type: stop.type, t: stop.t, rtMs, correct, distancePx, clickX: rel.x, clickY: rel.y });
      overlay.removeEventListener("click", clickHandler);
      overlay.style.pointerEvents = "none";
      hidePrompt();
      nextStopIdx++; pauseGuard = false;
      if (nextStopIdx >= playQueue.length) { finishSession(); }
      else { videoEl.play(); requestAnimationFrame(tickStopWatcher); }
    };
    overlay.addEventListener("click", clickHandler, { once:true });

  } else if (stop.type === "next-shot") {
    const options = stop.options && stop.options.length ? stop.options : ["CD croisé","Revers long de ligne","Amorti","Lob"];
    renderOptions(options, (opt) => {
      const now = performance.now();
      const rtMs = Math.round(now - pauseTime);
      const correct = stop.correct ? (opt === stop.correct) : false;
      results.push({ stopIndex: index, type: stop.type, t: stop.t, rtMs, correct, choice: opt });
      clearOptions(); overlay.style.pointerEvents = "none"; hidePrompt();
      nextStopIdx++; pauseGuard = false;
      if (nextStopIdx >= playQueue.length) { finishSession(); }
      else { videoEl.play(); requestAnimationFrame(tickStopWatcher); }
    });
    showPrompt("Choisis le <b>coup</b> que tu jouerais dans cette situation.");
  }
}

// Compte à rebours 5→1→GO (affiché en gros au centre + rappel en haut-gauche)
function runCountdownThen(callback) {
  let n = 5;
  // gros compteur dessiné dans le canvas
  const ctx = overlay.getContext("2d");
  function drawBig(text) {
    ctx.clearRect(0,0,overlay.width,overlay.height);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0,0,overlay.width,overlay.height);
    ctx.fillStyle = "#fff";
    ctx.font = Math.floor(overlay.height*0.25) + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, overlay.width/2, overlay.height/2);
  }
  overlay.style.pointerEvents = "none";
  showPrompt("La séance démarre dans…");
  positionPrompt();
  drawBig(String(n));
  const timer = setInterval(() => {
    n--;
    if (n >= 1) {
      drawBig(String(n));
    } else {
      clearInterval(timer);
      drawBig("GO!");
      setTimeout(() => {
        // Nettoyage overlay + prompt et départ
        const ctx2 = overlay.getContext("2d");
        ctx2.clearRect(0,0,overlay.width,overlay.height);
        hidePrompt();
        callback();
      }, 500);
    }
  }, 1000);
}

// Stats/Exports (inchangé)
function computeStats() {
  if (!results.length) return { n: 0, rtDistribution: { binSize: 100, bins: [] }, perStop: [] };
  const n = results.length;
  const rtMs = results.map(r => r.rtMs).filter(rt => typeof rt === "number");
  const meanRT = rtMs.length ? Math.round(rtMs.reduce((a,r) => a + r, 0) / rtMs.length) : 0;
  const accuracy = Math.round(100 * results.filter(r => r.correct).length / n);
  const dItems = results.filter(r => typeof r.distancePx === "number");
  const meanDist = dItems.length ? Math.round(dItems.reduce((a,r)=>a+r.distancePx,0)/dItems.length) : null;
  const binSize = 100;
  const maxRT = rtMs.length ? Math.max(...rtMs) : 0;
  const bins = Array(Math.ceil(maxRT / binSize) || 1).fill(0);
  rtMs.forEach(rt => { bins[Math.floor(rt / binSize)]++; });
  const perStop = results.map(r => ({ stopIndex: r.stopIndex, correct: r.correct, rtMs: r.rtMs }));
  return { n, meanRT, accuracy, meanDist, rtDistribution: { binSize, bins }, perStop };
}
function renderSessionStats() {
  const s = computeStats();
  if (!s.n) {
    sessionStats.innerHTML = "<p>Aucune donnée pour le moment.</p>";
    if (rtHistogramCanvas) {
      const ctx = rtHistogramCanvas.getContext("2d");
      ctx.clearRect(0,0,rtHistogramCanvas.width,rtHistogramCanvas.height);
    }
    if (perStopListEl) perStopListEl.innerHTML = "";
    return;
  }
  sessionStats.innerHTML = `
    <h3>Résumé séance</h3>
    <ul>
      <li>Nombre d'arrêts traités: <b>${s.n}</b></li>
      <li>Temps de réaction moyen: <b>${s.meanRT} ms</b></li>
      <li>Taux de réponses « correctes »: <b>${s.accuracy}%</b></li>
      ${s.meanDist!=null ? `<li>Erreur moyenne (clic vs réponse): <b>${s.meanDist} px</b></li>` : ""}
    </ul>
  `;
  if (rtHistogramCanvas && s.rtDistribution.bins.length) {
    const ctx = rtHistogramCanvas.getContext("2d");
    const { bins } = s.rtDistribution;
    const w = rtHistogramCanvas.width;
    const h = rtHistogramCanvas.height;
    ctx.clearRect(0,0,w,h);
    const maxCount = Math.max(...bins);
    const barWidth = w / bins.length;
    bins.forEach((c, i) => {
      const barHeight = maxCount ? (c / maxCount) * h : 0;
      ctx.fillStyle = "#3498db";
      ctx.fillRect(i * barWidth, h - barHeight, barWidth - 2, barHeight);
    });
  }
  if (perStopListEl) {
    perStopListEl.innerHTML = s.perStop.map(ps =>
      `<li>Arrêt ${ps.stopIndex + 1}: ${ps.correct ? "✅" : "❌"} (${ps.rtMs != null ? ps.rtMs + " ms" : "-"})</li>`
    ).join("");
  }
}

exportCSVBtn?.addEventListener("click", exportCSV);
function exportCSV() {
  if (!results.length) { alert("Pas de résultats à exporter."); return; }
  const headers = ["stopIndex","type","t","rtMs","correct","distancePx","clickX","clickY","choice","zoneId"];
  const lines = [headers.join(",")];
  results.forEach(r => {
    lines.push([
      r.stopIndex, r.type, r.t, r.rtMs, r.correct,
      (r.distancePx ?? ""), (r.clickX ?? ""), (r.clickY ?? ""),
      (r.choice ?? ""), (r.zone?.id ?? "")
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "resultats_session.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

exportJSONBtn?.addEventListener("click", exportJSON);
function exportJSON() {
  if (!results.length) { alert("Pas de résultats à exporter."); return; }
  const payload = { results, stats: computeStats() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "resultats_session.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// Editeur
videoFileInput?.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (currentVideoURL) URL.revokeObjectURL(currentVideoURL);
  currentVideoURL = URL.createObjectURL(f);
  videoEl.src = currentVideoURL;
  videoEl.controls = true;
  videoEl.addEventListener("loadedmetadata", () => { resizeOverlayToVideo(); redrawOverlay(); }, { once:true });
});

addPredictBtn?.addEventListener("click", () => addStop("predict-landing"));
addDecisionBtn?.addEventListener("click", () => addStop("next-shot"));

function addStop(type) {
  if (!videoEl.duration) { alert("Chargez d'abord une vidéo."); return; }
  const t = videoEl.currentTime;
  const stop = { t, type };
  if (type === "next-shot") {
    stop.options = (decisionOptionsInput.value || "").split(",").map(s => s.trim()).filter(Boolean);
    stop.correct = (decisionCorrectInput.value || "").trim();
  } else if (type === "predict-landing") {
    stop.zoneMode = !!zoneModeCheckbox.checked;
    if (stop.zoneMode) {
      const cols = parseInt(gridColsInput.value, 10) || 2;
      const rows = parseInt(gridRowsInput.value, 10) || 2;
      stop.gridSplit = { cols, rows, x: [], y: [] };
    }
  }
  scenario.stops.push(stop);
  refreshStopsTable();
}

function refreshStopsTable() {
  stopsTableBody.innerHTML = "";
  scenario.stops
    .forEach((s, i) => {
      let details = "";
      if (s.type === "predict-landing") {
        if (s.zoneMode) {
          const c = s.gridSplit?.cols || 2;
          const r = s.gridSplit?.rows || 2;
          details = s.answerZone ? `Réponse (zone ${c}×${r}): col=${s.answerZone.col+1}, ligne=${s.answerZone.row+1}` : "Réponse zone non définie";
        } else {
          details = s.answerPoint ? `Réponse: x=${s.answerPoint.x.toFixed(2)}, y=${s.answerPoint.y.toFixed(2)}` : "Réponse non définie";
        }
      } else {
        details = `Options: ${(s.options||[]).join(", ")} | Correct: ${s.correct||"(non défini)"}`;
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i+1}</td>
        <td>${(Math.round(s.t*100)/100).toFixed(2)}</td>
        <td>${s.type === "predict-landing" ? "Prédire atterrissage" : "Décision coup suivant"}</td>
        <td>${details}</td>
        <td>
          <button data-act="seek" data-i="${i}">Aller</button>
          <button data-act="edit" data-i="${i}">Éditer</button>
          <button data-act="up" data-i="${i}">↑</button>
          <button data-act="down" data-i="${i}">↓</button>
          <button data-act="del" data-i="${i}">Supprimer</button>
        </td>
      `;
      stopsTableBody.appendChild(tr);
    });
}

let editingIndex = null;
function editStop(i) {
  const stop = scenario.stops[i]; if (!stop) return;
  editingIndex = i;
  editStopTimeInput.value = stop.t.toFixed(2);
  editStopTypeSelect.value = stop.type;
  if (stop.type === "predict-landing") {
    editPredictFields.classList.remove("hidden");
    editDecisionFields.classList.add("hidden");
    editZoneModeCheckbox.checked = !!stop.zoneMode;
    editGridColsInput.value = stop.gridSplit?.cols || 2;
    editGridRowsInput.value = stop.gridSplit?.rows || 2;
    editGridXInput.value = (stop.gridSplit?.x || []).join(",");
    editGridYInput.value = (stop.gridSplit?.y || []).join(",");
    editAnswerXInput.value = stop.answerPoint?.x ?? "";
    editAnswerYInput.value = stop.answerPoint?.y ?? "";
    editOptionsInput.value = "";
    editCorrectInput.value = "";
  } else {
    editPredictFields.classList.add("hidden");
    editDecisionFields.classList.remove("hidden");
    editOptionsInput.value = (stop.options || []).join(",");
    editCorrectInput.value = stop.correct || "";
    editZoneModeCheckbox.checked = false;
  }
  editModal.classList.remove("hidden");
}

editStopTypeSelect?.addEventListener("change", () => {
  if (editStopTypeSelect.value === "predict-landing") {
    editPredictFields.classList.remove("hidden");
    editDecisionFields.classList.add("hidden");
  } else {
    editPredictFields.classList.add("hidden");
    editDecisionFields.classList.remove("hidden");
  }
});

saveEditStopBtn?.addEventListener("click", () => {
  if (editingIndex == null) return;
  const stop = scenario.stops[editingIndex];
  stop.t = parseFloat(editStopTimeInput.value) || 0;
  stop.type = editStopTypeSelect.value;
  if (stop.type === "predict-landing") {
    stop.zoneMode = !!editZoneModeCheckbox.checked;
    if (stop.zoneMode) {
      const cols = parseInt(editGridColsInput.value,10) || 2;
      const rows = parseInt(editGridRowsInput.value,10) || 2;
      const x = (editGridXInput.value || "").split(",").map(v=>parseFloat(v.trim())).filter(v=>!isNaN(v));
      const y = (editGridYInput.value || "").split(",").map(v=>parseFloat(v.trim())).filter(v=>!isNaN(v));
      stop.gridSplit = { cols, rows, x, y };
    } else {
      delete stop.gridSplit;
    }
    const ax = parseFloat(editAnswerXInput.value);
    const ay = parseFloat(editAnswerYInput.value);
    if (!isNaN(ax) && !isNaN(ay)) stop.answerPoint = {x:ax,y:ay}; else delete stop.answerPoint;
    delete stop.options; delete stop.correct;
  } else {
    stop.options = (editOptionsInput.value || "").split(",").map(s=>s.trim()).filter(Boolean);
    stop.correct = (editCorrectInput.value || "").trim();
    stop.zoneMode = false;
    delete stop.gridSplit; delete stop.answerPoint; delete stop.answerZone;
  }
  editModal.classList.add("hidden");
  editingIndex = null;
  refreshStopsTable();
});

cancelEditStopBtn?.addEventListener("click", () => { editModal.classList.add("hidden"); editingIndex = null; });

stopsTableBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  const i = parseInt(btn.dataset.i, 10);
  const act = btn.dataset.act;
  if (act === "del") { scenario.stops.splice(i,1); refreshStopsTable(); }
  else if (act === "seek") { videoEl.currentTime = scenario.stops[i].t; videoEl.pause(); }
  else if (act === "up" && i > 0) { [scenario.stops[i-1], scenario.stops[i]] = [scenario.stops[i], scenario.stops[i-1]]; refreshStopsTable(); }
  else if (act === "down" && i < scenario.stops.length-1) { [scenario.stops[i+1], scenario.stops[i]] = [scenario.stops[i], scenario.stops[i+1]]; refreshStopsTable(); }
  else if (act === "edit") { editStop(i); }
});

markAnswerBtn?.addEventListener("click", () => {
  if (!scenario.stops.length) { alert("Ajoutez d'abord un arrêt."); return; }
  const idx = scenario.stops.findIndex(s => s.type === "predict-landing" && ((s.zoneMode && !s.answerZone) || (!s.zoneMode && !s.answerPoint)));
  if (idx === -1) {
    const index = prompt("Entrez l'index de l'arrêt à renseigner (1..N) — regardez le tableau ci-dessus.");
    const i = parseInt(index,10)-1;
    if (isNaN(i) || i<0 || i>=scenario.stops.length) return;
    if (scenario.stops[i].type !== "predict-landing") { alert("Cet arrêt n'est pas de type « Prédire »."); return; }
    setAnswerForStop(i);
  } else { setAnswerForStop(idx); }
});

let definingGridAxis = null; // 'x' ou 'y' pendant définition
let linesLeft = 0;
let tempGrid = null;

function setAnswerForStop(index) {
  const stop = scenario.stops[index];
  pendingSetAnswerForIndex = index;

  if (!stop.zoneMode) {
    showPrompt("Clique sur l'endroit où la balle <b>atterrit</b>.");
    overlay.style.pointerEvents = "auto";
    const clickHandler = (evt) => {
      const rel = getRelFromEvent(evt);
      stop.answerPoint = { x: rel.x, y: rel.y };
      overlay.removeEventListener("click", clickHandler);
      overlay.style.pointerEvents = "none";
      hidePrompt();
      pendingSetAnswerForIndex = null;
      refreshStopsTable(); redrawOverlay();
    };
    overlay.addEventListener("click", clickHandler, { once:true });
    return;
  }

  // ZoneMode: grille par arrêt
  if (stop.gridSplit && !Array.isArray(stop.gridSplit.x)) {
    stop.gridSplit = { cols:2, rows:2, x:[stop.gridSplit.x], y:[stop.gridSplit.y] };
  }
  stop.gridSplit = stop.gridSplit || { cols:2, rows:2, x:[], y:[] };
  const gs = stop.gridSplit;
  if (gs.x.length < gs.cols-1 || gs.y.length < gs.rows-1) {
    tempGrid = { cols: gs.cols, rows: gs.rows, x:[...gs.x], y:[...gs.y] };
    definingGridAxis = tempGrid.x.length < gs.cols-1 ? 'x' : 'y';
    linesLeft = (definingGridAxis === 'x' ? gs.cols-1 - tempGrid.x.length : gs.rows-1 - tempGrid.y.length);
    overlay.style.pointerEvents = "auto";
    showPrompt(definingGridAxis === 'x'
      ? `Définis la grille : clique la <b>ligne VERTICALE ${tempGrid.x.length+1}/${gs.cols-1}</b>.`
      : `Définis la grille : clique la <b>ligne HORIZONTALE ${tempGrid.y.length+1}/${gs.rows-1}</b>.`);
    const gridHandler = (evt) => {
      const rel = getRelFromEvent(evt);
      if (definingGridAxis === 'x') {
        tempGrid.x.push(rel.x);
        tempGrid.x.sort((a,b)=>a-b);
        linesLeft--;
        activeGridForEditor = {...tempGrid};
        if (linesLeft === 0) {
          definingGridAxis = 'y';
          linesLeft = gs.rows-1 - tempGrid.y.length;
          if (linesLeft === 0) {
            overlay.removeEventListener("click", gridHandler);
            gs.x = tempGrid.x; gs.y = tempGrid.y;
            activeGridForEditor = {...gs};
            chooseZoneForStop(index);
            redrawOverlay();
            return;
          } else {
            showPrompt(`Clique la <b>ligne HORIZONTALE ${tempGrid.y.length+1}/${gs.rows-1}</b>.`);
          }
        } else {
          showPrompt(`Clique la <b>ligne VERTICALE ${tempGrid.x.length+1}/${gs.cols-1}</b>.`);
        }
      } else {
        tempGrid.y.push(rel.y);
        tempGrid.y.sort((a,b)=>a-b);
        linesLeft--;
        activeGridForEditor = {...tempGrid};
        if (linesLeft === 0) {
          overlay.removeEventListener("click", gridHandler);
          gs.x = tempGrid.x; gs.y = tempGrid.y;
          activeGridForEditor = {...gs};
          chooseZoneForStop(index);
        } else {
          showPrompt(`Clique la <b>ligne HORIZONTALE ${tempGrid.y.length+1}/${gs.rows-1}</b>.`);
        }
      }
      redrawOverlay();
    };
    overlay.addEventListener("click", gridHandler);
  } else {
    activeGridForEditor = {...gs};
    chooseZoneForStop(index);
  }
}

function chooseZoneForStop(index) {
  const stop = scenario.stops[index];
  showPrompt("Clique maintenant dans la <b>zone correcte</b>.");
  const clickHandler = (evt) => {
    const rel = getRelFromEvent(evt);
    const z = getZoneFromSplit(rel.x, rel.y, stop.gridSplit);
    stop.answerZone = { id: z.id, col: z.col, row: z.row };
    overlay.removeEventListener("click", clickHandler);
    overlay.style.pointerEvents = "none";
    hidePrompt();
    pendingSetAnswerForIndex = null;
    activeGridForEditor = null;
    refreshStopsTable(); redrawOverlay();
  };
  overlay.addEventListener("click", clickHandler);
}

// Export/Import scénario (identique V2)
exportScenarioBtn?.addEventListener("click", exportScenario);
function exportScenario() {
  const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (scenario.meta?.title?.replace(/\s+/g, "_") || "scenario") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}
scenarioFileInput?.addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const obj = JSON.parse(fr.result);
      if (!obj.stops || !Array.isArray(obj.stops)) throw new Error("JSON invalide (stops manquant).");
      scenario = obj;
      refreshStopsTable(); redrawOverlay();
      alert("Scénario chargé.");
    } catch (e) { alert("Erreur: " + e.message); }
  };
  fr.readAsText(f);
});

startSessionBtn?.addEventListener("click", () => {
  if (!scenario.stops?.length) { alert("Pas d'arrêts. Chargez un scénario ou créez-en dans l'éditeur."); return; }
  startSession();
});

// Lecture/Pause bouton
playPauseBtn?.addEventListener("click", () => {
  if (!videoEl.src) return;
  if (videoEl.paused) { videoEl.play(); } else { videoEl.pause(); }
});

playbackRateSelect?.addEventListener("change", () => {
  if (!videoEl.src) return;
  videoEl.playbackRate = parseFloat(playbackRateSelect.value || "1");
});

frameBackBtn?.addEventListener("click", () => {
  if (!videoEl.src) return;
  const fps = videoEl.framerate || 25;
  videoEl.currentTime = Math.max(0, videoEl.currentTime - 1 / fps);
});

frameForwardBtn?.addEventListener("click", () => {
  if (!videoEl.src) return;
  const fps = videoEl.framerate || 25;
  videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + 1 / fps);
});

// Popup: Rejouer / Fermer
restartSessionBtn?.addEventListener("click", () => {
  sessionEnd?.classList.add("hidden");
  startSession();
});
closeSummaryBtn?.addEventListener("click", () => {
  sessionEnd?.classList.add("hidden");
  editorMode = true;
});

// Événements globaux
window.addEventListener("resize", () => { resizeOverlayToVideo(); });
document.addEventListener("DOMContentLoaded", () => { ensureWrap(); resizeOverlayToVideo(); });
videoEl?.addEventListener("loadedmetadata", resizeOverlayToVideo);
videoEl?.addEventListener("loadedmetadata", () => {
  try {
    const stream = videoEl.captureStream?.();
    const track = stream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.();
    if (settings?.frameRate) {
      videoEl.framerate = settings.frameRate;
      return;
    }
  } catch (e) {}
  if (typeof videoEl.getVideoPlaybackQuality === "function") {
    const startFrames = videoEl.getVideoPlaybackQuality().totalVideoFrames;
    const startTime = videoEl.currentTime;
    const handler = () => {
      const q = videoEl.getVideoPlaybackQuality();
      const dt = videoEl.currentTime - startTime;
      const df = q.totalVideoFrames - startFrames;
      if (dt > 0 && df > 0) {
        videoEl.framerate = df / dt;
        videoEl.removeEventListener("timeupdate", handler);
      }
    };
    videoEl.addEventListener("timeupdate", handler);
  }
});
videoEl?.addEventListener("play", () => { if (sessionActive && pauseGuard) requestAnimationFrame(tickStopWatcher); });
setInterval(renderSessionStats, 500);
