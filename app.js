// === Tennis Vision — V2 (compte à rebours + consignes en haut-gauche de la vidéo) ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const videoEl = $("#player");
const overlay = $("#overlay");
const overlayPrompt = $("#overlayPrompt");
const sessionEnd = $("#sessionEnd");
const summaryStats = $("#summaryStats");
const restartSessionBtn = $("#restartSession");
const closeSummaryBtn = $("#closeSummary");
const playPauseBtn = $("#playPause");
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

const stopsTableBody = $("#stopsTable tbody");

const startSessionBtn = $("#startSession");
const exportCSVBtn = $("#exportCSV");
const sessionStats = $("#sessionStats");

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
  const splitX = gs?.x ?? 0.5;
  const splitY = gs?.y ?? 0.5;
  if (relX < splitX && relY < splitY) return { col:0,row:0, id:1 };
  if (relX >= splitX && relY < splitY) return { col:1,row:0, id:2 };
  if (relX < splitX && relY >= splitY) return { col:0,row:1, id:3 };
  return { col:1,row:1, id:4 };
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
      const x = gs.x * overlay.width;
      const y = gs.y * overlay.height;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, overlay.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(overlay.width, y); ctx.stroke();
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
  const xSplit = (gs?.x ?? 0.5) * overlay.width;
  const ySplit = (gs?.y ?? 0.5) * overlay.height;
  return {
    1: {x:0, y:0, w:xSplit, h:ySplit},
    2: {x:xSplit, y:0, w:overlay.width - xSplit, h:ySplit},
    3: {x:0, y:ySplit, w:xSplit, h:overlay.height - ySplit},
    4: {x:xSplit, y:ySplit, w:overlay.width - xSplit, h:overlay.height - ySplit},
  };
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
  if (!results.length) return { n: 0 };
  const n = results.length;
  const meanRT = Math.round(results.reduce((a,r) => a + (r.rtMs||0), 0) / n);
  const accuracy = Math.round(100 * results.filter(r => r.correct).length / n);
  const dItems = results.filter(r => typeof r.distancePx === "number");
  const meanDist = dItems.length ? Math.round(dItems.reduce((a,r)=>a+r.distancePx,0)/dItems.length) : null;
  return { n, meanRT, accuracy, meanDist };
}
function renderSessionStats() {
  const s = computeStats();
  if (!s.n) { sessionStats.innerHTML = "<p>Aucune donnée pour le moment.</p>"; return; }
  sessionStats.innerHTML = `
    <h3>Résumé séance</h3>
    <ul>
      <li>Nombre d'arrêts traités: <b>${s.n}</b></li>
      <li>Temps de réaction moyen: <b>${s.meanRT} ms</b></li>
      <li>Taux de réponses « correctes »: <b>${s.accuracy}%</b></li>
      ${s.meanDist!=null ? `<li>Erreur moyenne (clic vs réponse): <b>${s.meanDist} px</b></li>` : ""}
    </ul>
  `;
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
  }
  scenario.stops.push(stop);
  refreshStopsTable();
}

function refreshStopsTable() {
  stopsTableBody.innerHTML = "";
  scenario.stops
    .sort((a,b)=>a.t-b.t)
    .forEach((s, i) => {
      let details = "";
      if (s.type === "predict-landing") {
        if (s.zoneMode) {
          details = s.answerZone ? `Réponse (zone 2×2): col=${s.answerZone.col+1}, ligne=${s.answerZone.row+1}` : "Réponse zone non définie";
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
          <button data-act="del" data-i="${i}">Supprimer</button>
        </td>
      `;
      stopsTableBody.appendChild(tr);
    });
}

stopsTableBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  const i = parseInt(btn.dataset.i, 10);
  if (btn.dataset.act === "del") { scenario.stops.splice(i,1); refreshStopsTable(); }
  else if (btn.dataset.act === "seek") { videoEl.currentTime = scenario.stops[i].t; videoEl.pause(); }
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

let definingGridStep = 0; // 0 rien, 1 verticale, 2 horizontale
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
  definingGridStep = 1; tempGrid = { x: 0.5, y: 0.5 };
  showPrompt("Définis la grille : clique la <b>ligne VERTICALE</b> (1er clic).");
  overlay.style.pointerEvents = "auto";

  const gridHandler = (evt) => {
    const rel = getRelFromEvent(evt);
    if (definingGridStep === 1) {
      tempGrid.x = rel.x; definingGridStep = 2;
      activeGridForEditor = {...tempGrid};
      showPrompt("Clique la <b>ligne HORIZONTALE</b> (2e clic).");
    } else if (definingGridStep === 2) {
      tempGrid.y = rel.y; definingGridStep = 0;
      stop.gridSplit = {...tempGrid};
      activeGridForEditor = {...tempGrid};
      overlay.removeEventListener("click", gridHandler);
      chooseZoneForStop(index);
    }
    redrawOverlay();
  };
  overlay.addEventListener("click", gridHandler);
}

function chooseZoneForStop(index) {
  const stop = scenario.stops[index];
  showPrompt("Clique maintenant dans la <b>zone correcte</b> (1/2/3/4).");
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
videoEl?.addEventListener("play", () => { if (sessionActive && pauseGuard) requestAnimationFrame(tickStopWatcher); });
setInterval(renderSessionStats, 500);
