# Time Clock

A simple personal punch clock. Punch in when you get to the office, punch out when you leave. Tracks today's hours, this week's hours, and a full shift history you can edit. No dependencies, no database to manage — just Node.

---

## Run it on your computer (optional, to try it first)

You need [Node.js](https://nodejs.org) installed.

```bash
node server.js
```

Open http://localhost:3000. Punches save to a `data/punches.json` file in this folder.

To require a PIN locally:

```bash
APP_PIN=1234 node server.js
```

---

## Deploy to Railway (so you can use it from your phone)

Same flow as any Node app — push to GitHub, deploy on Railway. **Two settings matter:** a volume (so your data survives redeploys) and a PIN (so only you can punch).

### 1. Push to GitHub
Create a new repo and push this folder to it.

### 2. Create the Railway project
- New Project → **Deploy from GitHub repo** → pick this repo.
- Railway auto-detects Node and runs `npm start`. No build config needed.

### 3. Add a Volume — **don't skip this**
Railway wipes the filesystem on every redeploy. Without a volume, every punch you've logged disappears the next time the app restarts.

- In your service, go to the **Variables / Settings** area and add a **Volume**.
- Set the **mount path** to `/data`.
- Then add a variable: `DATA_DIR` = `/data`

Now your `punches.json` lives on the volume and persists forever.

### 4. Set your PIN
Add a variable: `APP_PIN` = whatever you want (e.g. `4827`).

If you don't set a PIN, anyone with the URL can punch your clock. Set one.

### 5. Open it
Railway gives you a public URL. Open it on your phone, enter the PIN once (it's remembered on that device), and add it to your home screen so it opens like an app.

---

## Variables summary

| Variable   | What it does                          | Example          |
|------------|---------------------------------------|------------------|
| `DATA_DIR` | Where the data file lives (use the volume mount path on Railway) | `/data`          |
| `APP_PIN`  | Lock so only you can punch            | `4827`           |
| `PORT`     | Set automatically by Railway          | *(leave it)*     |

---

## Notes
- Shifts are grouped and totaled by the day you clocked **in**, in your phone's local timezone.
- The week total runs Monday→Sunday.
- Forgot to punch out, or punched the wrong time? Tap any shift to fix the times or delete it. Use **+ Add** to log a shift after the fact. If a shift stays open more than 12 hours, a banner reminds you.
- Tap the **gear icon** to set your hourly rate and pay-period start date. Pay periods run biweekly from that date, and overtime is figured per workweek (anything over 40h that week at 1.5×).
- Your **hourly rate is stored only on your phone** (browser local storage) — it is never sent to or saved on the server.
- **Export** downloads your full history as a CSV for reconciling against your paycheck.
