// Punch Clock — zero-dependency Node server.
// Storage: a single JSON file. Auth: a shared PIN sent in a header.
// Everything date/timezone related is computed in the browser, so the
// server just stores UTC timestamps and stays dumb on purpose.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
// On Railway: attach a Volume and set DATA_DIR to its mount path (e.g. /data)
// so the file survives redeploys. Locally it defaults to ./data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "punches.json");
// Set APP_PIN in Railway's variables. If left blank, the app runs with no lock.
const APP_PIN = process.env.APP_PIN || "";

const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- storage ----------
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [] }, null, 2));
}
function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { entries: [] };
  }
}
function writeStore(data) {
  ensureStore();
  // write to a temp file then rename, so a crash mid-write can't corrupt data
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

// constant-time-ish PIN check
function pinOk(req) {
  if (!APP_PIN) return true; // no lock configured
  const given = req.headers["x-pin"] || "";
  if (given.length !== APP_PIN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(APP_PIN));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // prevent path traversal outside /public
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// ---------- API ----------
async function handleApi(req, res) {
  const url = req.url.split("?")[0];

  // health check stays open so Railway can ping it
  if (url === "/api/health") return send(res, 200, { ok: true });

  // tells the browser whether a PIN is required (without revealing it)
  if (url === "/api/config" && req.method === "GET") {
    return send(res, 200, { pinRequired: !!APP_PIN });
  }

  if (!pinOk(req)) return send(res, 401, { error: "Wrong PIN." });

  const store = readStore();

  // GET /api/entries — everything; the browser does the date math + totals
  if (url === "/api/entries" && req.method === "GET") {
    return send(res, 200, { entries: store.entries });
  }

  // POST /api/clock-in — open a new entry if none is open
  if (url === "/api/clock-in" && req.method === "POST") {
    const open = store.entries.find((e) => !e.clockOut);
    if (open) return send(res, 409, { error: "Already clocked in.", entry: open });
    const entry = { id: crypto.randomUUID(), clockIn: new Date().toISOString(), clockOut: null, job: "", note: "" };
    store.entries.push(entry);
    writeStore(store);
    return send(res, 200, { entry });
  }

  // POST /api/clock-out — close the open entry, capturing job + notes
  if (url === "/api/clock-out" && req.method === "POST") {
    const body = await readBody(req);
    const open = store.entries.find((e) => !e.clockOut);
    if (!open) return send(res, 409, { error: "Not clocked in." });
    open.clockOut = new Date().toISOString();
    if (body.job !== undefined) open.job = body.job;
    if (body.note !== undefined) open.note = body.note;
    writeStore(store);
    return send(res, 200, { entry: open });
  }

  // POST /api/entries — manually add a past shift
  if (url === "/api/entries" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.clockIn) return send(res, 400, { error: "Need a start time." });
    const entry = {
      id: crypto.randomUUID(),
      clockIn: new Date(body.clockIn).toISOString(),
      clockOut: body.clockOut ? new Date(body.clockOut).toISOString() : null,
      job: body.job || "",
      note: body.note || "",
    };
    store.entries.push(entry);
    writeStore(store);
    return send(res, 200, { entry });
  }

  // PUT /api/entries/:id — edit a shift's times/note
  const editMatch = url.match(/^\/api\/entries\/([\w-]+)$/);
  if (editMatch && req.method === "PUT") {
    const id = editMatch[1];
    const body = await readBody(req);
    const entry = store.entries.find((e) => e.id === id);
    if (!entry) return send(res, 404, { error: "No such shift." });
    if (body.clockIn) entry.clockIn = new Date(body.clockIn).toISOString();
    if (body.clockOut !== undefined)
      entry.clockOut = body.clockOut ? new Date(body.clockOut).toISOString() : null;
    if (body.job !== undefined) entry.job = body.job;
    if (body.note !== undefined) entry.note = body.note;
    writeStore(store);
    return send(res, 200, { entry });
  }

  // DELETE /api/entries/:id
  if (editMatch && req.method === "DELETE") {
    const id = editMatch[1];
    const before = store.entries.length;
    store.entries = store.entries.filter((e) => e.id !== id);
    if (store.entries.length === before) return send(res, 404, { error: "No such shift." });
    writeStore(store);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Unknown endpoint." });
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((err) => {
      console.error(err);
      send(res, 500, { error: "Server error." });
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Punch clock running on http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`PIN lock: ${APP_PIN ? "on" : "off"}`);
});
