
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getDatabase, ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

// ── FIREBASE CONFIG ──
// Erstat disse værdier med din egen Firebase config
// (Firebase Console → Project settings → Your apps → SDK setup)
const firebaseConfig = {
  apiKey: "AIzaSyBJRX5sV-sin2wu1_FC2I25eqwcBnT6RHs",
  authDomain: "superliga-fantasy-14c4e.firebaseapp.com",
  databaseURL: "https://superliga-fantasy-14c4e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "superliga-fantasy-14c4e",
  storageBucket: "superliga-fantasy-14c4e.firebasestorage.app",
  messagingSenderId: "952252233248",
  appId: "1:952252233248:web:319133c0e90a6edce92e45"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ── STATE ── 
let allPlayers = {};
let allManagers = {};
let allRounds = {};
let allClubKickoffs = {};
let currentUser = 'Reitzel';
let posFilter = 'alle';
let currentFormation = '4-3-3';
let lineup = { MÅL: [], FOR: [], MID: [], ANG: [] };
let tradeGive = [], tradeGet = [], tradeDrop = [];
let swapMode = null;
let playerSort = { col: 'total', dir: -1 };
let selectedRunde = null; // Den runde der vises i Mit hold

const formations = {
  '4-3-3':[4,3,3],'4-4-2':[4,4,2],'4-5-1':[4,5,1],
  '3-4-3':[3,4,3],'3-5-2':[3,5,2],'5-4-1':[5,4,1],'5-3-2':[5,3,2]
};
const posOrder = ['ANG','MID','FOR','MÅL'];
const posLabel = { MÅL:'Målmand', FOR:'Forsvarsspiller', MID:'Midtbanespiller', ANG:'Angriber' };
const posClass = { MÅL:'pos-mål', FOR:'pos-for', MID:'pos-mid', ANG:'pos-ang' };
const managerColors = { Reitzel:'#3C3489', Thom:'#085041', Heine:'#0C447C', Marl:'#633806', Guldmann:'#27500A', Dan:'#4A1B0C' };

// ── LOAD DATA ──
async function loadAll() {
  const [pSnap, mSnap, rSnap, ckSnap] = await Promise.all([
    get(ref(db, 'players')),
    get(ref(db, 'managers')),
    get(ref(db, 'rounds')),
    get(ref(db, 'clubKickoffs'))
  ]);
  allPlayers = pSnap.val() || {};
  allManagers = mSnap.val() || {};
  allRounds = rSnap.val() || {};
  allClubKickoffs = ckSnap.val() || {};

  buildDefaultLineup();
  renderStandings();
  renderBars();
  renderPlayers();
  renderRundebar();
  renderPitch();
  renderBench();
  renderTrup();
  renderAdminTable();
  renderRoundsAdmin();
  renderUserModal();
}

// ── HELPERS ──
function mySquad() {
  return Object.values(allPlayers).filter(p => p.owner === currentUser);
}

function getStarters() {
  return Object.values(lineup).flat().filter(Boolean);
}

function getBench() {
  const s = new Set(getStarters());
  return mySquad().filter(p => !s.has(p.fullName));
}

function fmtGrowth(n) {
  if (!n) return '0';
  return (n > 0 ? '+' : '') + (n/1000).toFixed(0) + 'k';
}

function activeRound() {
  const now = new Date();
  // Find runden vi er inden for baseret på tidspunkter
  for (const [key, round] of Object.entries(allRounds)) {
    const start = new Date(round.start);
    const end   = new Date(round.end);
    if (now >= start && now <= end) return key;
  }
  // Ingen aktiv runde – find den senest afsluttede
  const done = Object.entries(allRounds)
    .filter(([,r]) => new Date(r.end) < now)
    .sort((a,b) => new Date(b[1].end) - new Date(a[1].end));
  return done[0]?.[0] || 'r5';
}

function calcTotal(player) {
  if (!player.roundGrowth) return 0;
  return Object.values(player.roundGrowth).reduce((a,b) => a + (b||0), 0);
}

// managerTotal er nu defineret i managerRoundScore-blokken ovenfor

function managerRoundScore(manager, rnd) {
  // Brug gemt snapshot hvis det findes (låst score fra opstillingen den runde)
  const snapshot = allManagers[manager]?.roundScores?.[rnd];
  if (snapshot !== undefined) return snapshot;
  // Fallback: beregn fra nuværende trup (bruges for aktiv runde)
  return Object.values(allPlayers)
    .filter(p => p.owner === manager)
    .reduce((sum, p) => sum + (p.roundGrowth?.[rnd] || 0), 0);
}

function managerTotal(manager) {
  const now = new Date();
  const rnd = activeRound();
  const roundScores = allManagers[manager]?.roundScores || {};
  let total = 0;
  for (const [key, round] of Object.entries(allRounds)) {
    const start = new Date(round.start);
    const end   = new Date(round.end);
    if (now < start) continue; // Fremtidig runde – spring over
    if (now >= start && now <= end) {
      // Aktiv runde – brug live opstillingsdata
      const starters = new Set(allManagers[manager]?.lineup?.[key]?.starters || []);
      if (starters.size > 0) {
        total += Object.values(allPlayers)
          .filter(p => starters.has(p.fullName))
          .reduce((sum, p) => sum + (p.roundGrowth?.[key] || 0), 0);
      } else {
        // Ingen gemt opstilling – brug trup som fallback
        total += Object.values(allPlayers)
          .filter(p => p.owner === manager)
          .reduce((sum, p) => sum + (p.roundGrowth?.[key] || 0), 0);
      }
    } else {
      // Afsluttet runde – brug snapshot
      total += roundScores[key] || 0;
    }
  }
  return total;
}

// ── STANDINGS ──
function renderStandings() {
  document.getElementById('standings-loading').style.display = 'none';
  const tbl = document.getElementById('standings-table');
  tbl.style.display = 'table';
  const rnd = activeRound();
  const managers = Object.keys(allManagers).filter(m => !allManagers[m].isAdmin);

  // Beregn ligapoint FOERST
  const ligaPoints = {};
  managers.forEach(m => ligaPoints[m] = 0);
  Object.keys(allRounds).sort((a,b) => parseInt(a.replace('r',''))-parseInt(b.replace('r',''))).forEach(rk => {
    if (allRounds[rk].status === 'upcoming') return;
    const scores = managers.map(m => ({ m, s: managerRoundScore(m, rk) }))
      .sort((a,b) => b.s - a.s);
    scores.forEach(({m}, i) => { ligaPoints[m] += (managers.length - i); });
  });

  // Derefter sorter efter ligapoint
  const ranked = managers.map(m => ({
    name: m,
    total: managerTotal(m),
    runde: managerRoundScore(m, rnd),
    ligaPts: ligaPoints[m] || 0
  })).sort((a,b) => b.ligaPts - a.ligaPts || b.total - a.total);

  const body = document.getElementById('standings-body');
  body.innerHTML = ranked.map((r, i) => `
    <tr class="${r.name === currentUser ? 'me' : ''}">
      <td style="font-weight:700;color:var(--text-muted)">${i+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="avatar" style="background:${managerColors[r.name]||'#333'}">${r.name[0]}</div>
          <span style="font-weight:${r.name===currentUser?'600':'400'}">${r.name}</span>
        </div>
      </td>
      <td class="pts-neu" style="text-align:right">${ligaPoints[r.name]}</td>
      <td class="${r.total>=0?'pts-pos':'pts-neg'}" style="text-align:right">${fmtGrowth(r.total)}</td>
      <td class="${r.runde>=0?'pts-pos':'pts-neg'}" style="text-align:right">${fmtGrowth(r.runde)}</td>
    </tr>`).join('');

  // Opdater badge
  const now = new Date();
  const ar = allRounds[rnd];
  if (ar) {
    const start = new Date(ar.start);
    const end   = new Date(ar.end);
    const isLive = now >= start && now <= end;
    const badge  = document.getElementById('active-round-badge');
    badge.textContent = isLive ? ar.label + ' · live' : ar.label + ' · afsluttet';
    badge.className   = isLive ? 'badge badge-live' : 'badge badge-done';
  }
}

function renderBars() {
  const managers = Object.keys(allManagers).filter(m => !allManagers[m].isAdmin);
  const totals = managers.map(m => ({ m, t: managerTotal(m) })).sort((a,b) => b.t - a.t);
  const max = Math.max(...totals.map(x => Math.abs(x.t)), 1);
  const colors = ['#1a7a3c','#2d9e54','#57c97a','#8adba0','#b5ecc4','#d9f5e2'];
  document.getElementById('season-bars').innerHTML = totals.map(({m,t},i) => `
    <div class="bar-row">
      <div class="bar-name">${m}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(Math.abs(t)/max*100)}%;background:${colors[i]}"></div></div>
      <div class="bar-val ${t>=0?'pts-pos':'pts-neg'}">${fmtGrowth(t)}</div>
    </div>`).join('');
}

// ── HOLD ──
function buildDefaultLineup() {
  const squad = mySquad();
  const byPos = { MÅL:[], FOR:[], MID:[], ANG:[] };
  squad.forEach(p => { if(byPos[p.position]) byPos[p.position].push(p.fullName); });
  const [def,mid,att] = formations[currentFormation];
  lineup = {
    MÅL: byPos.MÅL.slice(0,1),
    FOR: byPos.FOR.slice(0,def),
    MID: byPos.MID.slice(0,mid),
    ANG: byPos.ANG.slice(0,att),
  };
  // Pad med null
  const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
  Object.keys(counts).forEach(pos => {
    while(lineup[pos].length < counts[pos]) lineup[pos].push(null);
  });
}

function renderHoldMetrics() {
  const rnd = getDisplayRunde();
  const now = new Date();
  const roundEnd = allRounds[rnd] ? new Date(allRounds[rnd].end) : null;
  const isHistoric = roundEnd && now > roundEnd;

  // Total vækst – altid fra managerTotal
  const total = managerTotal(currentUser);

  // Runderesultat – brug snapshot hvis historisk, ellers live
  let runde = 0;
  if (isHistoric) {
    runde = allManagers[currentUser]?.roundScores?.[rnd] || 0;
  } else {
    const starters = new Set(allManagers[currentUser]?.lineup?.[rnd]?.starters || []);
    if (starters.size > 0) {
      runde = Object.values(allPlayers)
        .filter(p => starters.has(p.fullName))
        .reduce((s,p) => s+(p.roundGrowth?.[rnd]||0), 0);
    } else {
      runde = mySquad().reduce((s,p) => s+(p.roundGrowth?.[rnd]||0), 0);
    }
  }

  const managers = Object.keys(allManagers).filter(m=>!allManagers[m].isAdmin);
  const rank = managers.map(m=>managerTotal(m)).sort((a,b)=>b-a).indexOf(total)+1;
  document.getElementById('m-total').textContent = fmtGrowth(total);
  document.getElementById('m-runde').textContent = fmtGrowth(runde);
  document.getElementById('m-place').textContent = rank + '/' + managers.length;
  document.getElementById('hold-title').textContent = (allManagers[currentUser]?.teamName || currentUser + "'s hold");
  document.getElementById('hold-runde-label').textContent = allRounds[rnd]?.label || 'Runde ?';
}

function renderRundebar() {
  const rnd = activeRound();
  const sorted = Object.entries(allRounds).sort((a,b) => {
    return parseInt(a[0].replace('r','')) - parseInt(b[0].replace('r',''));
  });
  document.getElementById('runde-bar').innerHTML = sorted.map(([k,r]) => `
    <button class="runde-chip ${k===rnd?'active':''} ${r.status==='done'?'done':''}"
      onclick="selectRunde('${k}',this)">${r.label.replace('Runde ','R')}${k===rnd?' ●':''}</button>`
  ).join('');
}

function selectRunde(key, btn) {
  document.querySelectorAll('.runde-chip').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  selectedRunde = key;
  document.getElementById('hold-runde-label').textContent = allRounds[key]?.label || key;
  renderPitchForRunde(key);
  renderTrup();
  renderHoldMetrics();
}

function renderFormGrid() {
  const rnd = getDisplayRunde();
  const roundLocked = isRoundLocked(rnd);

  // Tæl låste spillere pr position
  const lockedCounts = { MÅL:0, FOR:0, MID:0, ANG:0 };
  if (!roundLocked) {
    Object.entries(lineup).forEach(([pos, slots]) => {
      (slots||[]).forEach(name => {
        if (name && isPlayerLocked(name, rnd)) lockedCounts[pos]++;
      });
    });
  }

  document.getElementById('form-grid').innerHTML = Object.keys(formations).map(f => {
    const [def,mid,att] = formations[f];
    const needed = { MÅL:1, FOR:def, MID:mid, ANG:att };
    const invalid = !roundLocked && (
      needed.FOR < lockedCounts.FOR ||
      needed.MID < lockedCounts.MID ||
      needed.ANG < lockedCounts.ANG
    );
    const disabled = roundLocked || invalid;
    const isActive = f === currentFormation;
    let cls = 'form-btn';
    if (isActive) cls += ' active';
    if (disabled) cls += ' disabled';
    const style = disabled ? 'opacity:.35;cursor:not-allowed;' : '';
    const onclick = (!disabled) ? ' onclick="setFormation(' + JSON.stringify(f) + ')"' : '';
    return '<button class="' + cls + '" style="' + style + '"' + onclick + '>' + f + '</button>';
  }).join('');
}

function getDisplayRunde() {
  return selectedRunde || activeRound();
}

function isRoundLocked(rnd) {
  if (!allRounds[rnd]) return false;
  const now = new Date();
  const end = new Date(allRounds[rnd].end);
  return now > end;
}

function isPlayerLocked(playerName, rnd) {
  const p = allPlayers[playerName] || allPlayers[playerName.replace(/[.#$\/\[\]]/g,'_')];
  if (!p || !p.club) return false;
  // Brug club_ prefix som matchede seed_fixtures_v2
  const key = "club_" + p.club.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_");
  const kickoffStr = allClubKickoffs?.[rnd]?.[key];
  if (!kickoffStr) return false;
  return new Date() >= new Date(kickoffStr);
}

function isRoundActive(rnd) {
  if (!allRounds[rnd]) return false;
  const now = new Date();
  const start = new Date(allRounds[rnd].start);
  const end = new Date(allRounds[rnd].end);
  return now >= start && now <= end;
}

function renderPitchForRunde(rnd) {
  const savedLineup = allManagers[currentUser]?.lineup?.[rnd];
  const starters = savedLineup?.starters || [];
  const savedFormation = savedLineup?.formation;
  const now = new Date();
  const roundEnd = allRounds[rnd] ? new Date(allRounds[rnd].end) : null;
  const isHistoric = roundEnd && now > roundEnd;

  // Sæt altid currentFormation fra gemt opstilling hvis den findes
  if (savedFormation && formations[savedFormation]) {
    currentFormation = savedFormation;
  }

  if (isHistoric) {
    // Historisk runde – byg pitch direkte fra starters, ingen redigering
    const f = currentFormation;
    const [def,mid,att] = formations[f] || formations['4-3-3'];
    const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
    const posOrderH = ['ANG','MID','FOR','MÅL'];
    const byPos = { MÅL:[], FOR:[], MID:[], ANG:[] };
    starters.forEach(name => {
      const p = allPlayers[name] || allPlayers[name.replace(/[.#$\/\[\]]/g,'_')];
      if(p && byPos[p.position]) byPos[p.position].push(p);
    });
    let html = '<div style="text-align:center;font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.1em;margin-bottom:10px">' + f + ' · ' + (allRounds[rnd]?.label||'') + '</div>';
    posOrderH.forEach(pos => {
      const need = counts[pos]||1;
      const players = byPos[pos].slice(0, need);
      let row = '';
      for(let i=0;i<need;i++) {
        const p = players[i];
        if(p) {
          const rpts = p.roundGrowth?.[rnd] || 0;
          row += '<div class="pslot locked" style="cursor:default"><div class="pts">' + fmtGrowth(rpts) + '</div><div class="nm">' + p.fullName.split(' ').pop() + '</div><div class="cl">' + p.club + '</div></div>';
        } else {
          row += '<div class="pslot empty" style="cursor:default"><div class="ep">-</div></div>';
        }
      }
      html += '<div class="pitch-row">' + row + '</div>';
    });
    document.getElementById('pitch').innerHTML = html;
    document.getElementById('pos-warn').innerHTML = '';
    document.querySelector('#hold-opstilling .btn-primary').style.display = 'none';
    document.querySelector('#hold-opstilling .btn:not(.btn-primary)').style.display = 'none';
    renderFormGrid();
    renderBench();
    return;
  }

  // Aktiv/fremtidig runde – indlæs gemt lineup og vis redigerbar pitch
  if (starters.length > 0) {
    const [def,mid,att] = formations[currentFormation] || formations['4-3-3'];
    const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
    const byPos = { MÅL:[], FOR:[], MID:[], ANG:[] };
    starters.forEach(name => {
      const p = allPlayers[name] || allPlayers[name.replace(/[.#$\/\[\]]/g,'_')];
      if(p && byPos[p.position]) byPos[p.position].push(name);
    });
    Object.keys(counts).forEach(pos => {
      lineup[pos] = byPos[pos].slice(0, counts[pos]);
      while(lineup[pos].length < counts[pos]) lineup[pos].push(null);
    });
  }
  document.querySelector('#hold-opstilling .btn-primary').style.display = 'inline-block';
  document.querySelector('#hold-opstilling .btn:not(.btn-primary)').style.display = 'inline-block';
  const roundStart = allRounds[rnd] ? new Date(allRounds[rnd].start) : null;
  const noteEl = document.getElementById('deadline-note');
  if (noteEl && roundStart) {
    noteEl.textContent = 'Spillere låses individuelt når deres kamp starter · Transfervindue lukker ' + roundStart.toLocaleDateString('da-DK', {weekday:'long', day:'numeric', month:'short'}) + ' kl. ' + roundStart.toLocaleTimeString('da-DK', {hour:'2-digit', minute:'2-digit'});
  }
  renderPitch();
}

function renderPitch() {
  renderFormGrid();
  const [def,mid,att] = formations[currentFormation];
  const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
  let html = `<div style="text-align:center;font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.1em;margin-bottom:10px">${currentFormation}</div>`;
  posOrder.forEach(pos => {
    const need = counts[pos]||1;
    const slots = lineup[pos]||[];
    let row = '';
    for(let i=0;i<need;i++) {
      const name = slots[i];
      const p = name ? allPlayers[name] : null;
      if(p) {
        const rnd = getDisplayRunde();
        const rpts = p.roundGrowth?.[rnd] || 0;
        const locked = isRoundLocked(rnd) || isPlayerLocked(p.fullName, rnd);
        row += `<div class="pslot ${locked?'locked':'filled'}" onclick="openSwap('${pos}',${i})">
          ${locked ? `<div class="lk">LÅST</div>` : `<div class="pts">${fmtGrowth(rpts)}</div>`}
          <div class="nm">${p.fullName.split(' ').pop()}</div>
          <div class="cl">${p.club}</div>
        </div>`;
      } else {
        row += `<div class="pslot empty" onclick="openSwap('${pos}',${i})">
          <div class="ep">Mangler</div>
          <div style="font-size:9px;color:rgba(255,255,255,.35)">${posLabel[pos]}</div>
        </div>`;
      }
    }
    html += `<div class="pitch-row">${row}</div>`;
  });
  document.getElementById('pitch').innerHTML = html;
  renderBench();
  checkPosWarnings();
}

function checkPosWarnings() {
  const [def,mid,att] = formations[currentFormation];
  const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
  const missing = Object.entries(counts).filter(([pos,n]) =>
    (lineup[pos]||[]).filter(Boolean).length < n
  ).map(([pos,n]) => `${n-(lineup[pos]||[]).filter(Boolean).length} ${posLabel[pos].toLowerCase()}`);
  document.getElementById('pos-warn').innerHTML = missing.length
    ? `<div class="notif notif-warn">Mangler: ${missing.join(' · ')}</div>` : '';
}

function renderBench() {
  const bench = getBench();
  const rnd = getDisplayRunde();
  document.getElementById('bench').innerHTML = bench.slice(0,5).map(p => {
    const locked = isRoundLocked(rnd) || isPlayerLocked(p.fullName, rnd);
    return `<div class="bench-slot ${locked?'locked':''}" onclick="${locked?'void(0)':'openSwapFromBench('+JSON.stringify(p.fullName)+')'}">
      <div class="b-name">${p.fullName.split(' ').pop()}</div>
      <div class="b-club">${p.club}</div>
      <div style="margin:3px 0"><span class="pos ${posClass[p.position]}">${p.position}</span></div>
      <div class="b-pts ${calcTotal(p)>=0?'pts-pos':'pts-neg'}">${fmtGrowth(calcTotal(p))}</div>
      ${locked ? '<div class="b-lock">Kamp startet</div>' : ''}
    </div>`;
  }).join('');
}


function renderTrup() {
  const squad = mySquad().sort((a,b) => calcTotal(b)-calcTotal(a));
  document.getElementById('trup-body').innerHTML = squad.map(p => `
    <tr>
      <td style="font-weight:600">${p.fullName}</td>
      <td style="color:var(--text-muted)">${p.club}</td>
      <td><span class="pos ${posClass[p.position]}">${p.position}</span></td>
      <td class="${calcTotal(p)>=0?'pts-pos':'pts-neg'}" style="text-align:right">${fmtGrowth(calcTotal(p))}</td>
      <td style="text-align:right"><button class="btn btn-sm btn-danger" onclick="releasePlayer('${p.fullName}')">Frigiv</button></td>
    </tr>`).join('');
}

// ── SWAP MODAL ──
function openSwap(pos, idx) {
  const rnd = getDisplayRunde();
  if (isRoundLocked(rnd)) {
    alert('Denne runde er afsluttet og kan ikke redigeres.');
    return;
  }
  const current = (lineup[pos]||[])[idx];
  if (current && isPlayerLocked(current, rnd)) {
    alert('Denne spillers kamp er allerede startet – kan ikke byttes ud.');
    return;
  }
  swapMode = { type:'slot', pos, idx };
  const starters = new Set(getStarters());
  const options = getBench().filter(p => p.position === pos);
  document.getElementById('swap-title').textContent = current ? 'Byt ud: ' + current.split(' ').pop() : 'Vælg ' + posLabel[pos].toLowerCase();
  document.getElementById('swap-sub').textContent = 'Kun ' + posLabel[pos].toLowerCase() + 'e kan placeres her';
  document.getElementById('swap-list').innerHTML = options.length
    ? options.map(p => `
        <div class="pick-item" onclick="doSwap('${p.fullName}')">
          <div>
            <div class="pick-name">${p.fullName}</div>
            <div class="pick-detail">${p.club}</div>
          </div>
          <span class="${calcTotal(p)>=0?'pts-pos':'pts-neg'}">${fmtGrowth(calcTotal(p))}</span>
        </div>`).join('')
    : '<div style="color:var(--text-muted);font-size:13px;padding:10px 0">Ingen tilgængelige spillere på bænken i denne position.</div>';
  openModal('modal-swap');
}

function openSwapFromBench(name) {
  if (isRoundLocked(getDisplayRunde())) {
    alert('Denne runde er afsluttet og kan ikke redigeres.');
    return;
  }
  const p = allPlayers[name];
  const pos = p.position;
  const [def,mid,att] = formations[currentFormation];
  const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
  const slots = lineup[pos]||[];
  for(let i=0;i<(counts[pos]||1);i++) {
    if(!slots[i]) { lineup[pos][i]=name; renderPitch(); return; }
  }
  // Alle slots fyldte – spørg hvem der skal ud
  swapMode = { type:'bench', incoming: name, pos };
  document.getElementById('swap-title').textContent = 'Hvem skal ud for ' + name.split(' ').pop() + '?';
  document.getElementById('swap-sub').textContent = 'Vælg hvem der rykker på bænk';
  const starters = (lineup[pos]||[]).filter(Boolean);
  document.getElementById('swap-list').innerHTML = starters.map(n => {
    const s = allPlayers[n];
    return `<div class="pick-item" onclick="doSwapOut('${n}','${name}','${pos}')">
      <div><div class="pick-name">${n}</div><div class="pick-detail">${s?.club||''}</div></div>
      <span class="${calcTotal(s)>=0?'pts-pos':'pts-neg'}">${fmtGrowth(calcTotal(s))}</span>
    </div>`;
  }).join('');
  openModal('modal-swap');
}

function doSwap(name) {
  if(!swapMode) return;
  const {pos,idx} = swapMode;
  lineup[pos][idx] = name;
  closeModal('modal-swap');
  renderPitch();
}

function doSwapOut(out, incoming, pos) {
  const idx = lineup[pos].indexOf(out);
  if(idx>=0) lineup[pos][idx] = incoming;
  closeModal('modal-swap');
  renderPitch();
}

// ── SPILLERE ──
function renderPlayers() {
  document.getElementById('players-loading').style.display = 'none';
  const tbl = document.getElementById('players-table');
  tbl.style.display = 'table';
  const q = document.getElementById('player-search').value.toLowerCase();
  const sortFns = {
    name:  (a,b) => a.fullName.localeCompare(b.fullName) * playerSort.dir,
    club:  (a,b) => (a.club||'').localeCompare(b.club||'') * playerSort.dir,
    pos:   (a,b) => (a.position||'').localeCompare(b.position||'') * playerSort.dir,
    owner: (a,b) => (a.owner||'').localeCompare(b.owner||'') * playerSort.dir,
    total: (a,b) => (calcTotal(a)-calcTotal(b)) * playerSort.dir,
  };
  const players = Object.values(allPlayers).filter(p => {
    const matchQ = !q || p.fullName.toLowerCase().includes(q) || p.club?.toLowerCase().includes(q);
    const matchPos = posFilter==='alle' ? true : posFilter==='ledig' ? p.owner==='Ledig' : p.position===posFilter;
    return matchQ && matchPos;
  }).sort(sortFns[playerSort.col] || sortFns.total);

  document.getElementById('player-count-badge').textContent = players.length + ' spillere';

  document.getElementById('players-body').innerHTML = players.map(p => {
    const isMe = p.owner === currentUser;
    const isLedig = p.owner === 'Ledig' || !p.owner;
    const total = calcTotal(p);
    let actionBtn = '';
    if(isLedig) actionBtn = `<button class="btn btn-sm btn-success player-action-btn" onclick="pickupPlayer('${p.fullName}')">Hent</button>`;
    else if(isMe) actionBtn = `<button class="btn btn-sm btn-danger player-action-btn" onclick="releasePlayer('${p.fullName}')">Frigiv</button>`;
    else actionBtn = `<button class="btn btn-sm player-action-btn" onclick="startTrade('${p.fullName}','${p.owner}')">Trade</button>`;

    return `<tr>
      <td style="font-weight:600">${p.fullName}</td>
      <td style="color:var(--text-muted)">${p.club||'–'}</td>
      <td><span class="pos ${posClass[p.position]}">${p.position||'–'}</span></td>
      <td>${isLedig
        ? '<span class="badge badge-ledig">Ledig</span>'
        : `<div style="display:flex;align-items:center;gap:6px"><div class="avatar" style="width:20px;height:20px;font-size:9px;background:${managerColors[p.owner]||'#666'}">${p.owner?.[0]}</div>${p.owner}</div>`
      }</td>
      <td class="${total>=0?'pts-pos':'pts-neg'}" style="text-align:right">${fmtGrowth(total)}</td>
      <td style="text-align:right">${actionBtn}</td>
    </tr>`;
  }).join('');
}

// ── ADMIN ──
function renderAdminTable() {
  document.getElementById('admin-loading').style.display = 'none';
  document.getElementById('admin-table').style.display = 'table';
  const players = Object.values(allPlayers).slice(0,50);
  const managers = Object.keys(allManagers).filter(m=>!allManagers[m].isAdmin);
  document.getElementById('admin-body').innerHTML = players.map(p => `
    <tr>
      <td style="font-weight:600">${p.fullName}</td>
      <td><span class="pos ${posClass[p.position]}">${p.position}</span></td>
      <td>${p.owner==='Ledig'||!p.owner ? '<span class="badge badge-ledig">Ledig</span>' : p.owner}</td>
      <td>
        <select class="inp" style="margin:0;padding:4px 8px;font-size:12px;width:110px">
          <option ${!p.owner||p.owner==='Ledig'?'selected':''}>Ledig</option>
          ${managers.map(m=>`<option ${p.owner===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </td>
      <td><button class="btn btn-sm btn-primary" onclick="adminSave(this,'${p.fullName}')">Gem</button></td>
    </tr>`).join('');
}

function renderRoundsAdmin() {
  const sorted = Object.entries(allRounds).sort((a,b) =>
    parseInt(a[0].replace('r','')) - parseInt(b[0].replace('r','')));
  document.getElementById('rounds-body').innerHTML = sorted.map(([k,r]) => `
    <tr>
      <td style="font-weight:600">${r.label}</td>
      <td style="font-size:12px;color:var(--text-muted)">${new Date(r.start).toLocaleDateString('da-DK')}</td>
      <td style="font-size:12px;color:var(--text-muted)">${new Date(r.end).toLocaleDateString('da-DK')}</td>
      <td><span class="badge badge-${r.status==='active'?'live':r.status==='done'?'done':'upcoming'}">${r.status}</span></td>
      <td>
        <select class="inp" style="margin:0;padding:4px 8px;font-size:12px;width:110px" onchange="updateRoundStatus('${k}',this.value)">
          <option ${r.status==='done'?'selected':''}>done</option>
          <option ${r.status==='active'?'selected':''}>active</option>
          <option ${r.status==='upcoming'?'selected':''}>upcoming</option>
        </select>
      </td>
    </tr>`).join('');
}

// ── TRADE BUILDER ──
function updateTradeTarget() {
  tradeGet = [];
  renderTradeLists();
  const btn = document.getElementById('get-add-btn');
  const m = document.getElementById('trade-to').value;
  btn.disabled = !m;
}

function openPickModal(mode) {
  swapMode = { type: 'trade', mode };
  const manager = document.getElementById('trade-to').value;
  document.getElementById('swap-title').textContent = mode==='give' ? 'Jeg afgiver' : 'Jeg modtager';
  document.getElementById('swap-sub').textContent = mode==='give' ? 'Vælg fra din trup' : 'Vælg fra ' + manager + "'s trup";
  const opts = mode==='give'
    ? mySquad().filter(p=>!tradeGive.includes(p.fullName))
    : Object.values(allPlayers).filter(p=>p.owner===manager && !tradeGet.includes(p.fullName));
  document.getElementById('swap-list').innerHTML = opts.map(p => `
    <div class="pick-item" onclick="addToTrade('${p.fullName}','${mode}')">
      <div><div class="pick-name">${p.fullName}</div><div class="pick-detail">${p.club} · ${p.position}</div></div>
      <span class="${calcTotal(p)>=0?'pts-pos':'pts-neg'}">${fmtGrowth(calcTotal(p))}</span>
    </div>`).join('') || '<div style="color:var(--text-muted);padding:10px 0;font-size:13px">Ingen spillere tilgængelige</div>';
  openModal('modal-swap');
}

function addToTrade(name, mode) {
  if(mode==='give' && !tradeGive.includes(name)) tradeGive.push(name);
  if(mode==='get' && !tradeGet.includes(name)) tradeGet.push(name);
  closeModal('modal-swap');
  renderTradeLists();
  checkUnevenTrade();
}

function renderTradeLists() {
  document.getElementById('give-list').innerHTML = tradeGive.map(n=>`
    <div class="player-tag"><span>${n}</span><span class="rm" onclick="removeFromTrade('${n}','give')">×</span></div>`).join('');
  document.getElementById('get-list').innerHTML = tradeGet.map(n=>`
    <div class="player-tag"><span>${n}</span><span class="rm" onclick="removeFromTrade('${n}','get')">×</span></div>`).join('');
  const g=tradeGive.length, r=tradeGet.length;
  document.getElementById('trade-sum').textContent = (g||r) ? `${g} ud · ${r} ind` : '';
}

function removeFromTrade(name, mode) {
  if(mode==='give') tradeGive = tradeGive.filter(n=>n!==name);
  if(mode==='get') tradeGet = tradeGet.filter(n=>n!==name);
  renderTradeLists();
  checkUnevenTrade();
}

function checkUnevenTrade() {
  const diff = tradeGet.length - tradeGive.length;
  const warn = document.getElementById('uneven-warn');
  if(diff > 0) {
    warn.style.display = 'block';
    document.getElementById('uw-give').textContent = tradeGive.length;
    document.getElementById('uw-get').textContent = tradeGet.length;
    document.getElementById('uw-drop').textContent = diff;
    const eligible = mySquad().filter(p=>!tradeGive.includes(p.fullName));
    document.getElementById('drop-picks').innerHTML = eligible.slice(0,8).map(p=>`
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0;cursor:pointer">
        <input type="checkbox" onchange="toggleDrop('${p.fullName}',this)"> ${p.fullName}
      </label>`).join('');
  } else {
    warn.style.display = 'none';
  }
}

function toggleDrop(name, cb) {
  if(cb.checked) tradeDrop.push(name);
  else tradeDrop = tradeDrop.filter(n=>n!==name);
}

// ── USER MODAL ──
function renderUserModal() {
  const managers = Object.keys(allManagers).filter(m=>!allManagers[m].isAdmin);
  document.getElementById('user-list').innerHTML = managers.map(m=>`
    <div class="pick-item" onclick="setUser('${m}')">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="avatar" style="background:${managerColors[m]||'#333'}">${m[0]}</div>
        <div>
          <div class="pick-name">${m}</div>
          <div class="pick-detail">${allManagers[m]?.teamName||''}</div>
        </div>
      </div>
      ${m===currentUser?'<span class="badge badge-done">Aktiv</span>':''}
    </div>`).join('');
}

// ── ALLE HOLD ──
function renderAlleHold() {
  const rnd = activeRound();
  document.getElementById('alle-hold-runde').textContent = allRounds[rnd]?.label || 'Runde ?';
  const managers = Object.keys(allManagers).filter(m => !allManagers[m].isAdmin);
  const posOrder = ['ANG','MID','FOR','MÅL'];
  const formations_map = {'4-3-3':[4,3,3],'4-4-2':[4,4,2],'4-5-1':[4,5,1],'3-4-3':[3,4,3],'3-5-2':[3,5,2],'5-4-1':[5,4,1],'5-3-2':[5,3,2]};

  document.getElementById('hold-grid').innerHTML = managers.map(m => {
    const squad = Object.values(allPlayers).filter(p => p.owner === m);
    const savedLineup = allManagers[m]?.lineup?.[rnd];
    const formation = savedLineup?.formation || '4-3-3';
    const starters = savedLineup?.starters || [];
    const [def,mid,att] = formations_map[formation] || [4,3,3];
    const counts = { MÅL:1, FOR:def, MID:mid, ANG:att };
    const total = managerTotal(m);
    const rScore = managerRoundScore(m, rnd);

    // Gruppér starters efter position
    const byPos = { MÅL:[], FOR:[], MID:[], ANG:[] };
    starters.forEach(name => {
      const p = allPlayers[name];
      if(p && byPos[p.position]) byPos[p.position].push(p);
    });
    // Fallback: brug squad hvis ingen gemt opstilling
    if(!starters.length) {
      squad.forEach(p => { if(byPos[p.position]) byPos[p.position].push(p); });
    }

    const pitchRows = posOrder.map(pos => {
      const need = counts[pos] || 1;
      const players = byPos[pos].slice(0, need);
      const slots = players.map(p => `
        <div class="mini-slot">
          <div class="ms">${fmtGrowth(p.roundGrowth?.[rnd]||0)}</div>
          <div class="mn">${p.fullName.split(' ').pop()}</div>
          <div class="mp">${p.club?.substring(0,3)||''}</div>
        </div>`).join('');
      const empty = Array(Math.max(0, need-players.length)).fill(
        `<div class="mini-slot"><div class="mn" style="opacity:.3">–</div></div>`).join('');
      return `<div class="mini-row">${slots}${empty}</div>`;
    }).join('');

    return `
      <div class="hold-card">
        <div class="hold-card-header">
          <div class="avatar" style="width:22px;height:22px;font-size:9px;background:${managerColors[m]||'#333'}">${m[0]}</div>
          <span class="name">${allManagers[m]?.teamName||m}</span>
          <span class="pts">${fmtGrowth(rScore)} denne runde</span>
        </div>
        <div class="mini-pitch">${pitchRows}</div>
        <div class="hold-card-footer">${formation} · ${fmtGrowth(total)} samlet</div>
      </div>`;
  }).join('');
}

// ── FIREBASE ACTIONS ──
async function pickupPlayer(name) {
  if(!confirm('Hent ' + name + ' til din trup?')) return;
  await update(ref(db, 'players/' + name), { owner: currentUser });
  allPlayers[name].owner = currentUser;
  renderPlayers(); renderTrup(); renderStandings();
}

async function releasePlayer(name) {
  if(!confirm('Frigiv ' + name + '? Spilleren bliver ledig for alle.')) return;
  await update(ref(db, 'players/' + name), { owner: 'Ledig' });
  allPlayers[name].owner = 'Ledig';
  renderPlayers(); renderTrup(); renderPitch(); renderStandings();
}

async function adminSave(btn, name) {
  const select = btn.closest('tr').querySelector('select');
  const newOwner = select.value;
  await update(ref(db, 'players/' + name), { owner: newOwner });
  allPlayers[name].owner = newOwner;
  alert('Gemt!');
}

async function updateRoundStatus(key, status) {
  await update(ref(db, 'rounds/' + key), { status });
  allRounds[key].status = status;
}

async function saveLineup() {
  const rnd = getDisplayRunde();
  if (isRoundLocked(rnd)) {
    alert('Denne runde er afsluttet og kan ikke gemmes.');
    return;
  }
  const starters = getStarters();
  await update(ref(db, 'managers/' + currentUser + '/lineup/' + rnd), {
    formation: currentFormation,
    starters: starters
  });
  alert('Opstilling gemt til ' + (allRounds[rnd]?.label||rnd) + '!');
}

// ── UI ACTIONS ──
window.showPage = function(page, btn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  btn.classList.add('active');
  if(page==='hold') {
    selectedRunde = activeRound();
    renderHoldMetrics();
    renderPitchForRunde(selectedRunde);
    renderTrup();
    renderRundebar();
  }
  if(page==='alle-hold') { renderAlleHold(); }
};

window.holdTab = function(t, btn) {
  document.getElementById('hold-opstilling').style.display = t==='opstilling'?'block':'none';
  document.getElementById('hold-trup').style.display = t==='trup'?'block':'none';
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
};

window.trTab = function(t, btn) {
  ['anmod','indgaende','historik'].forEach(id=>document.getElementById('tr-'+id).style.display='none');
  document.getElementById('tr-'+t).style.display='block';
  document.querySelectorAll('#page-transfers .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
};

window.adminTab = function(t, btn) {
  ['tildel','runder'].forEach(id=>document.getElementById('admin-'+id).style.display='none');
  document.getElementById('admin-'+t).style.display='block';
  document.querySelectorAll('#page-admin .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
};

window.setFormation = function(f) {
  const rnd = getDisplayRunde();

  // Tjek at den nye formation ikke fjerner låste spillere
  const [def,mid,att] = formations[f];
  const needed = { MÅL:1, FOR:def, MID:mid, ANG:att };
  let blocked = false;
  Object.entries(needed).forEach(([pos, need]) => {
    const lockedInPos = (lineup[pos]||[]).filter(name => name && isPlayerLocked(name, rnd)).length;
    if (lockedInPos > need) {
      alert(`Kan ikke skifte til ${f} – du har ${lockedInPos} låste ${pos.toLowerCase()}-spillere, men formationen kræver kun ${need}.`);
      blocked = true;
    }
  });
  if (blocked) return;

  currentFormation = f;
  const counts = needed;
  Object.keys(counts).forEach(pos => {
    const need = counts[pos];
    if(!lineup[pos]) lineup[pos]=[];
    // Behold låste spillere, tilføj fra bænk til resten
    const locked = lineup[pos].filter(name => name && isPlayerLocked(name, rnd));
    const unlocked = lineup[pos].filter(name => name && !isPlayerLocked(name, rnd));
    const newLineup = [...locked];
    let i = 0;
    while(newLineup.length < need) {
      if(i < unlocked.length) {
        newLineup.push(unlocked[i++]);
      } else {
        const bench = getBench().find(p=>p.position===pos);
        newLineup.push(bench?.fullName||null);
      }
    }
    lineup[pos] = newLineup.slice(0, need);
  });
  renderPitch();
};

window.resetLineup = function() { buildDefaultLineup(); renderPitch(); };
window.selectRunde = selectRunde;
window.setPosFilter = function(f, btn) {
  posFilter = f;
  document.querySelectorAll('.filter-pill').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderPlayers();
};

window.openSwap = openSwap;
window.openSwapFromBench = openSwapFromBench;
window.doSwap = doSwap;
window.doSwapOut = doSwapOut;
window.openPickModal = openPickModal;
window.addToTrade = addToTrade;
window.removeFromTrade = removeFromTrade;
window.toggleDrop = toggleDrop;
window.updateTradeTarget = updateTradeTarget;
window.pickupPlayer = pickupPlayer;
window.releasePlayer = releasePlayer;
window.adminSave = adminSave;
window.updateRoundStatus = updateRoundStatus;
window.saveLineup = saveLineup;
window.renderPlayers = renderPlayers;

window.sortPlayers = function(col) {
  if (playerSort.col === col) playerSort.dir *= -1;
  else { playerSort.col = col; playerSort.dir = col === 'total' ? -1 : 1; }
  // Opdater pile
  ['name','club','pos','owner','total'].forEach(c => {
    const el = document.getElementById('sort-'+c);
    if(el) el.textContent = playerSort.col===c ? (playerSort.dir===1?'↑':'↓') : '';
  });
  renderPlayers();
};

window.sendTrade = function() {
  if(!tradeGive.length||!tradeGet.length) { alert('Tilføj mindst én spiller på begge sider.'); return; }
  const diff = tradeGet.length - tradeGive.length;
  if(diff>0 && tradeDrop.length<diff) { alert('Vælg '+diff+' spiller(e) at frigive.'); return; }
  alert('Trade sendt til ' + (document.getElementById('trade-to').value||'modtager') + '!');
  tradeGive=[]; tradeGet=[]; tradeDrop=[];
  renderTradeLists();
};

window.acceptTrade = function(btn) {
  const card = btn.closest('.trade-card');
  card.style.display = 'none';
  // Tæl resterende indgående trades
  const remaining = document.querySelectorAll('#tr-indgaende .trade-card:not([style*="display: none"])').length;
  document.getElementById('incoming-count').textContent = remaining;
  alert('Trade accepteret og gennemført!');
};
window.declineTrade = function(btn) {
  const card = btn.closest('.trade-card');
  card.style.display = 'none';
  const remaining = document.querySelectorAll('#tr-indgaende .trade-card:not([style*="display: none"])').length;
  document.getElementById('incoming-count').textContent = remaining;
  alert('Trade afvist.');
};

window.startTrade = function(name, owner) {
  showPage('transfers', document.querySelector('nav button:nth-child(4)'));
  document.getElementById('trade-to').value = owner;
  updateTradeTarget();
  addToTrade(name, 'get');
};

window.setUser = function(name) {
  currentUser = name;
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = name[0];
  document.getElementById('user-avatar').style.background = managerColors[name]||'#333';
  closeModal('modal-user');
  buildDefaultLineup();
  renderStandings();
  renderBars();
  renderPlayers();
  renderHoldMetrics();
  renderPitch();
  renderTrup();
  renderUserModal();
};

window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };

document.querySelectorAll('.modal-bg').forEach(bg => {
  bg.addEventListener('click', e => { if(e.target===bg) bg.classList.remove('open'); });
});

// ── ADMIN PIN ──
const ADMIN_PIN = '1234'; // Skift dette til din ønskede PIN-kode
let adminUnlocked = false;

window.checkAdminPin = function(btn) {
  if (adminUnlocked) {
    showPage('admin', btn);
    return;
  }
  const input = prompt('Indtast admin PIN-kode:');
  if (input === null) return; // Annulleret
  if (input === ADMIN_PIN) {
    adminUnlocked = true;
    showPage('admin', btn);
  } else {
    alert('Forkert PIN-kode.');
  }
};

// ── START ──
loadAll();
