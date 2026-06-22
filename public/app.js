// ---------- tiny API client ----------
const PIN_KEY = "punch_pin";
let pin = localStorage.getItem(PIN_KEY) || "";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-pin": pin, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    showLock("That PIN didn't work.");
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { data });
  return data;
}

// ---------- state ----------
let entries = [];
let tickTimer = null;

// ---------- time helpers (all in the browser's local timezone) ----------
const pad = (n) => String(n).padStart(2, "0");

function durationMs(e) {
  const start = new Date(e.clockIn).getTime();
  const end = e.clockOut ? new Date(e.clockOut).getTime() : Date.now();
  return Math.max(0, end - start);
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return `${h}h ${pad(m % 60)}m`;
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtTime(d) {
  let h = d.getHours();
  const ampm = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())}${ampm}`;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d) {
  // Monday as the first day of the week
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Mon=0 ... Sun=6
  x.setDate(x.getDate() - day);
  return x;
}
function dayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayLabel(d) {
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ---------- rendering ----------
const $ = (id) => document.getElementById(id);

function openEntry() {
  return entries.find((e) => !e.clockOut);
}

function render() {
  const open = openEntry();

  // status + punch button
  const dot = $("status-dot");
  const label = $("status-label");
  const readout = $("readout");
  const punch = $("punch");
  const punchLabel = $("punch-label");

  punch.disabled = false;

  if (open) {
    dot.classList.add("live");
    label.textContent = "On the clock";
    label.classList.add("live");
    readout.classList.add("live");
    $("readout-sub").textContent = `since ${fmtTime(new Date(open.clockIn))}`;
    punch.classList.remove("out");
    punchLabel.textContent = "Punch out";
  } else {
    dot.classList.remove("live");
    label.textContent = "Off the clock";
    label.classList.remove("live");
    readout.classList.remove("live");
    readout.textContent = "00:00:00";
    $("readout-sub").innerHTML = "&nbsp;";
    punch.classList.add("out");
    punchLabel.textContent = "Punch in";
  }

  tick(); // set readout immediately
  renderTotals();
  renderTimesheet();
  renderPayPeriod();
  renderOpenWarn();
  renderHistory();
}

function tick() {
  const open = openEntry();
  if (open) {
    $("readout").textContent = fmtClock(durationMs(open));
    renderTotals(); // today/week tick up live too
    renderTimesheet();
    renderPayPeriod();
    renderOpenWarn();
  }
}

function renderTotals() {
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const weekStart = startOfWeek(now).getTime();
  let today = 0;
  let week = 0;
  for (const e of entries) {
    const inTime = new Date(e.clockIn).getTime();
    const d = durationMs(e);
    if (inTime >= todayStart) today += d;
    if (inTime >= weekStart) week += d;
  }
  $("today-total").textContent = fmtDur(today);
  $("week-total").textContent = fmtDur(week);
}

// ---------- timesheet / weekly targets ----------
const HOUR = 3600000;

function renderTimesheet() {
  const now = new Date();
  const weekStart = startOfWeek(now).getTime();
  let week = 0;
  const jobs = new Map();
  for (const e of entries) {
    if (new Date(e.clockIn).getTime() >= weekStart) {
      const d = durationMs(e);
      week += d;
      const j = (e.job || "").trim() || "__unassigned__";
      jobs.set(j, (jobs.get(j) || 0) + d);
    }
  }

  // progress bar on a 0–50h scale, with the 40h marker fixed at 80%
  $("ts-fill").style.width = Math.min(week / (50 * HOUR), 1) * 100 + "%";
  $("ot-flag").classList.toggle("hidden", week <= 40 * HOUR);

  const to40 = Math.max(0, 40 * HOUR - week);
  const to50 = Math.max(0, 50 * HOUR - week);
  const days = getDaysLeft();
  $("days-left").textContent = days;

  setTarget("to-40", to40, "40h done");
  setTarget("to-50", to50, "50h done");
  setPerDay("per-40", to40, days);
  setPerDay("per-50", to50, days);

  renderJobs(jobs);
}

function setTarget(id, ms, doneText) {
  const el = $(id);
  if (ms === 0) { el.textContent = doneText; el.classList.add("done"); }
  else { el.textContent = fmtDur(ms); el.classList.remove("done"); }
}
function setPerDay(id, ms, days) {
  const el = $(id);
  el.classList.remove("done");
  el.textContent = ms === 0 || days <= 0 ? "—" : fmtDur(ms / days);
}

function renderJobs(jobs) {
  const sec = $("jobs-section");
  const rows = [...jobs.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");
  $("jobs-list").innerHTML = rows
    .map(([name, ms]) => {
      const un = name === "__unassigned__";
      return `<div class="job-row">
        <span class="job-name ${un ? "unassigned" : ""}">${un ? "Unassigned" : escapeHtml(name)}</span>
        <span class="job-hours">${fmtDur(ms)}</span>
      </div>`;
    })
    .join("");
}

// remaining work days this week (Mon–Fri, including today), adjustable + remembered per week
function weekKey() { return dayKey(startOfWeek(new Date())); }
function defaultDaysLeft() {
  const dowMon = (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6
  let c = 0;
  for (let i = dowMon; i <= 6; i++) if (i <= 4) c++;
  return c;
}
function getDaysLeft() {
  try {
    const o = JSON.parse(localStorage.getItem("daysLeft"));
    if (o && o.week === weekKey()) return o.days;
  } catch {}
  return defaultDaysLeft();
}
function setDaysLeft(n) {
  n = Math.max(0, Math.min(7, n));
  localStorage.setItem("daysLeft", JSON.stringify({ week: weekKey(), days: n }));
  renderTimesheet();
}

// ---------- CSV export ----------
function exportCSV() {
  if (!entries.length) return toast("Nothing to export yet");
  const rows = [["Date", "Clock in", "Clock out", "Hours", "Job", "Notes"]];
  const sorted = [...entries].sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
  for (const e of sorted) {
    const inD = new Date(e.clockIn);
    const outD = e.clockOut ? new Date(e.clockOut) : null;
    rows.push([
      inD.toLocaleDateString(),
      inD.toLocaleString(),
      outD ? outD.toLocaleString() : "",
      e.clockOut ? (durationMs(e) / HOUR).toFixed(2) : "",
      e.job || "",
      e.note || "",
    ]);
  }
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `timesheet_${dayKey(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- settings (rate + pay anchor live only on this device) ----------
const RATE_KEY = "hourlyRate";
const ANCHOR_KEY = "payAnchor";
const DEFAULT_ANCHOR = "2026-06-15"; // a Monday

function getRate() {
  const v = parseFloat(localStorage.getItem(RATE_KEY));
  return isFinite(v) && v > 0 ? v : 0;
}
function getAnchor() {
  return localStorage.getItem(ANCHOR_KEY) || DEFAULT_ANCHOR;
}
function openSettings() {
  $("set-rate").value = getRate() || "";
  $("set-anchor").value = getAnchor();
  $("settings-sheet").classList.remove("hidden");
}
function closeSettings() {
  $("settings-sheet").classList.add("hidden");
}
function saveSettings() {
  const raw = $("set-rate").value.trim();
  if (raw === "") localStorage.removeItem(RATE_KEY);
  else {
    const r = parseFloat(raw);
    if (isFinite(r) && r >= 0) localStorage.setItem(RATE_KEY, String(r));
  }
  const anchor = $("set-anchor").value;
  if (anchor) localStorage.setItem(ANCHOR_KEY, anchor);
  closeSettings();
  renderPayPeriod();
  toast("Settings saved");
}

// ---------- pay period (biweekly, OT computed per workweek) ----------
const DAY_MS = 86400000;

function payPeriodFor(now) {
  const anchor = startOfDay(new Date(getAnchor() + "T00:00:00"));
  const period = 14 * DAY_MS;
  const offset = Math.floor((startOfDay(now).getTime() - anchor.getTime()) / period);
  const start = new Date(anchor.getTime() + offset * period);
  const end = new Date(start.getTime() + period); // exclusive
  return { start, end };
}

function renderPayPeriod() {
  const now = new Date();
  const { start, end } = payPeriodFor(now);
  const w1Start = start.getTime();
  const w2Start = w1Start + 7 * DAY_MS;
  const endMs = end.getTime();

  let w1 = 0,
    w2 = 0;
  for (const e of entries) {
    const t = new Date(e.clockIn).getTime();
    if (t >= w1Start && t < w2Start) w1 += durationMs(e);
    else if (t >= w2Start && t < endMs) w2 += durationMs(e);
  }

  // OT is per workweek (>40h), matching how WA payroll calculates it
  const cap = 40 * HOUR;
  const reg = Math.min(w1, cap) + Math.min(w2, cap);
  const ot = Math.max(0, w1 - cap) + Math.max(0, w2 - cap);
  const total = w1 + w2;

  const dm = { month: "short", day: "numeric" };
  $("pp-range").textContent =
    `${start.toLocaleDateString(undefined, dm)} – ${new Date(endMs - DAY_MS).toLocaleDateString(undefined, dm)}`;
  $("pp-hours").textContent = fmtDur(total);
  $("pp-reg").textContent = fmtDur(reg);
  $("pp-ot").textContent = fmtDur(ot);

  $("pp-w1-label").textContent = "Wk of " + new Date(w1Start).toLocaleDateString(undefined, dm);
  $("pp-w2-label").textContent = "Wk of " + new Date(w2Start).toLocaleDateString(undefined, dm);
  $("pp-w1-val").textContent = fmtDur(w1) + (w1 > cap ? " · OT" : "");
  $("pp-w2-val").textContent = fmtDur(w2) + (w2 > cap ? " · OT" : "");

  const rate = getRate();
  const payEl = $("pp-pay");
  if (rate > 0) {
    const gross = (reg / HOUR) * rate + (ot / HOUR) * rate * 1.5;
    payEl.textContent = "~$" + gross.toFixed(2);
    payEl.classList.remove("hidden");
  } else {
    payEl.classList.add("hidden");
  }
}

// ---------- forgot-to-punch-out guard ----------
const OPEN_WARN_MS = 12 * HOUR;
function renderOpenWarn() {
  const open = openEntry();
  const el = $("open-warn");
  if (open && durationMs(open) > OPEN_WARN_MS) {
    $("open-warn-text").textContent = `Clocked in ${fmtDur(durationMs(open))} — forget to punch out?`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// ---------- job autocomplete ----------
function refreshJobOptions() {
  const names = [...new Set(entries.map((e) => (e.job || "").trim()).filter(Boolean))].sort();
  $("job-options").innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function renderHistory() {
  const box = $("entries");
  if (!entries.length) {
    box.innerHTML = `<div class="empty">No shifts yet. Punch in to start.</div>`;
    return;
  }

  // newest first, grouped by the day of clock-in
  const sorted = [...entries].sort((a, b) => new Date(b.clockIn) - new Date(a.clockIn));
  const groups = new Map();
  for (const e of sorted) {
    const k = dayKey(new Date(e.clockIn));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  let html = "";
  for (const [, list] of groups) {
    const dayDate = new Date(list[0].clockIn);
    const sum = list.reduce((acc, e) => acc + durationMs(e), 0);
    html += `<div class="day-group">
      <div class="day-head">
        <span class="day-name">${dayLabel(dayDate)}</span>
        <span class="day-sum">${fmtDur(sum)}</span>
      </div>`;
    for (const e of list) {
      const inD = new Date(e.clockIn);
      const outTxt = e.clockOut ? fmtTime(new Date(e.clockOut)) : "now";
      const durTxt = e.clockOut ? fmtDur(durationMs(e)) : "running";
      const sub = [e.job, e.note].filter(Boolean).map(escapeHtml).join(" · ");
      html += `<div class="entry" data-id="${e.id}">
        <div>
          <div class="entry-times">${fmtTime(inD)} – ${outTxt}</div>
          ${sub ? `<div class="entry-note">${sub}</div>` : ""}
        </div>
        <div class="entry-dur ${e.clockOut ? "" : "open"}">${durTxt}</div>
      </div>`;
    }
    html += `</div>`;
  }
  box.innerHTML = html;

  box.querySelectorAll(".entry").forEach((el) =>
    el.addEventListener("click", () => openSheet(el.dataset.id))
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- actions ----------
async function punch() {
  const open = openEntry();
  if (open) {
    openClockOutSheet(); // collect job + notes before closing the shift
    return;
  }
  $("punch").disabled = true;
  try {
    await api("/api/clock-in", { method: "POST" });
    toast("Punched in");
    await load();
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message || "Something went wrong");
    $("punch").disabled = false;
  }
}

function openClockOutSheet() {
  const open = openEntry();
  if (!open) return;
  $("co-summary").textContent =
    `On the clock ${fmtClock(durationMs(open))} · since ${fmtTime(new Date(open.clockIn))}`;
  $("co-job").value = open.job || "";
  $("co-note").value = open.note || "";
  $("clockout-sheet").classList.remove("hidden");
  $("co-job").focus();
}
function closeClockOutSheet() {
  $("clockout-sheet").classList.add("hidden");
}
async function confirmClockOut() {
  const job = $("co-job").value.trim();
  const note = $("co-note").value.trim();
  try {
    await api("/api/clock-out", { method: "POST", body: JSON.stringify({ job, note }) });
    closeClockOutSheet();
    toast("Punched out");
    await load();
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message || "Couldn't punch out");
  }
}

// ---------- edit / add sheet ----------
let editingId = null;

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local wants local time, no timezone suffix
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(val) {
  return val ? new Date(val).toISOString() : null;
}

function openSheet(id) {
  editingId = id || null;
  const e = id ? entries.find((x) => x.id === id) : null;
  $("sheet-title").textContent = e ? "Edit shift" : "Add shift";
  $("edit-in").value = e ? toLocalInput(e.clockIn) : toLocalInput(new Date().toISOString());
  $("edit-out").value = e && e.clockOut ? toLocalInput(e.clockOut) : "";
  $("edit-job").value = e ? e.job || "" : "";
  $("edit-note").value = e ? e.note || "" : "";
  $("delete-btn").classList.toggle("hidden", !e);
  $("sheet").classList.remove("hidden");
}
function closeSheet() {
  $("sheet").classList.add("hidden");
  editingId = null;
}

async function saveSheet() {
  const clockIn = fromLocalInput($("edit-in").value);
  const clockOut = fromLocalInput($("edit-out").value);
  if (!clockIn) return toast("Add a clock-in time");
  if (clockOut && new Date(clockOut) <= new Date(clockIn)) return toast("Clock-out must be after clock-in");
  const note = $("edit-note").value.trim();
  const job = $("edit-job").value.trim();
  try {
    if (editingId) {
      await api(`/api/entries/${editingId}`, { method: "PUT", body: JSON.stringify({ clockIn, clockOut, job, note }) });
    } else {
      await api("/api/entries", { method: "POST", body: JSON.stringify({ clockIn, clockOut, job, note }) });
    }
    closeSheet();
    await load();
    toast("Saved");
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message || "Couldn't save");
  }
}

async function deleteEntry() {
  if (!editingId) return;
  try {
    await api(`/api/entries/${editingId}`, { method: "DELETE" });
    closeSheet();
    await load();
    toast("Deleted");
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message || "Couldn't delete");
  }
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

// ---------- lock ----------
function showLock(err) {
  $("app").classList.add("hidden");
  $("lock").classList.remove("hidden");
  $("lock-error").textContent = err || "";
  $("pin-input").focus();
}
function hideLock() {
  $("lock").classList.add("hidden");
  $("app").classList.remove("hidden");
}

// ---------- load ----------
async function load() {
  const data = await api("/api/entries");
  entries = data.entries || [];
  refreshJobOptions();
  render();
  // keep a 1s tick running only while clocked in
  clearInterval(tickTimer);
  if (openEntry()) tickTimer = setInterval(tick, 1000);
}

async function boot() {
  // do we need a PIN at all?
  const cfg = await fetch("/api/config").then((r) => r.json());
  if (cfg.pinRequired && !pin) {
    showLock();
    return;
  }
  try {
    await load();
    hideLock();
  } catch {
    if (!$("lock").classList.contains("hidden")) return; // already showing lock
    showLock();
  }
}

// ---------- wire up ----------
$("punch").addEventListener("click", punch);
$("add-btn").addEventListener("click", () => openSheet(null));
$("export-btn").addEventListener("click", exportCSV);
$("sheet-close").addEventListener("click", closeSheet);
$("save-btn").addEventListener("click", saveSheet);
$("delete-btn").addEventListener("click", deleteEntry);
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

$("co-close").addEventListener("click", closeClockOutSheet);
$("co-confirm").addEventListener("click", confirmClockOut);
$("clockout-sheet").addEventListener("click", (e) => { if (e.target.id === "clockout-sheet") closeClockOutSheet(); });

$("days-minus").addEventListener("click", () => setDaysLeft(getDaysLeft() - 1));
$("days-plus").addEventListener("click", () => setDaysLeft(getDaysLeft() + 1));

$("settings-btn").addEventListener("click", openSettings);
$("settings-close").addEventListener("click", closeSettings);
$("set-save").addEventListener("click", saveSettings);
$("settings-sheet").addEventListener("click", (e) => { if (e.target.id === "settings-sheet") closeSettings(); });

$("open-warn-fix").addEventListener("click", () => {
  const o = openEntry();
  if (o) openSheet(o.id);
});

$("lock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  pin = $("pin-input").value.trim();
  localStorage.setItem(PIN_KEY, pin);
  try {
    await load();
    hideLock();
  } catch {
    /* showLock already called on 401 */
  }
});

boot();
