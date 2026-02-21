# WiseSpine

A custom OHIF v3 medical imaging viewer with an integrated AI chat assistant, built on top of the OHIF monorepo and backed by an Orthanc DICOM server.

---

## Repository Layout

```
WiseSpine/
├── Viewers/                        — OHIF v3 monorepo (the main viewer app)
├── ohif-modes/
│   ├── wise-spine/                 — WiseSpine OHIF mode (route: /wiseSpine)
│   └── wisespine-extension-layout/ — Custom layout extension + AI chatbot
└── orthanc-setup-samples/
    └── docker/ohif/                — Docker Compose stack (Orthanc + nginx)
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Git | any | For cloning |
| Node.js | ≥ 18 | Use [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| Yarn | ≥ 1.20 | `npm install -g yarn` |
| Docker Desktop | any | Must be running before Step 1 |
| Ollama | any | **Optional** — only needed for local AI models |

---

## Architecture Overview

Two parts run simultaneously:

| Part | Port | What it does |
|------|------|-------------|
| Docker stack | 80 | Runs Orthanc PACS behind an nginx reverse proxy |
| Webpack dev server | 3000 | Runs the WiseSpine OHIF viewer, proxying DICOMweb requests to port 80 |

---

## Step 1 — Start the Orthanc Docker Stack

```bash
cd orthanc-setup-samples/docker/ohif
docker compose up --build
```

Verify all containers are running:

```bash
docker ps
```

You should see **5 containers**: `nginx`, `ohif`, `orthanc-container`, `orthanc-plugin`, and `orthanc-index`.

**Available URLs once running:**

| URL | Purpose |
|-----|---------|
| `http://localhost/orthanc-container/ui/app/` | Orthanc Explorer — upload DICOM files here |
| `http://localhost/orthanc-plugin/ui/app/` | Orthanc Explorer (plugin variant) |
| `http://localhost/ohif/` | Stock OHIF viewer (not the custom WiseSpine build) |

---

## Step 2 — Upload DICOM Images

1. Open `http://localhost/orthanc-container/ui/app/`
2. Click **Upload**
3. Drag and drop your `.dcm` files
4. The study appears in the study list once the upload completes

---

## Step 3 — Configure OHIF

The following files are already configured in this repo. Verify they are correct if you run into connection issues.

### `.env`

`Viewers/platform/app/.env` sets the active config file:

```
APP_CONFIG=config/local_orthanc.js
```

### Data source endpoints

[Viewers/platform/app/public/config/local_orthanc.js](Viewers/platform/app/public/config/local_orthanc.js) points OHIF at Orthanc using relative paths:

```js
wadoUriRoot: '/orthanc-container/dicom-web',
qidoRoot:    '/orthanc-container/dicom-web',
wadoRoot:    '/orthanc-container/dicom-web',
```

### Webpack proxy rule

`Viewers/platform/app/.webpack/webpack.pwa.js` forwards `/orthanc-container/*` from the dev server (port 3000) to the Docker nginx (port 80):

```js
{
  context: ['/orthanc-container'],
  target: 'http://localhost',
  changeOrigin: true,
}
```

---

## Step 4 — Install Dependencies and Start the Dev Server

```bash
cd Viewers
yarn install
yarn dev
```

The viewer starts at **`http://localhost:3000`**.

---

## Step 5 — View Your DICOM Images

1. Open `http://localhost:3000` — the Study List shows all studies from Orthanc
2. Click a study to open it
3. Select the **WiseSpine** mode to use the custom layout

To open a study directly in WiseSpine mode:

```
http://localhost:3000/wiseSpine?StudyInstanceUIDs=<STUDY_INSTANCE_UID>
```

---

## AI Chat Panel

The AI Chat tab appears in the right side panel whenever a study is open.

### Ollama — local models (no API key required)

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model:
   ```bash
   ollama pull mistral-small3.1   # supports image input
   ollama pull llama3.2            # text only
   ```
3. Start Ollama with CORS allowed for the dev server:
   ```bash
   # macOS / Linux
   OLLAMA_ORIGINS=http://localhost:3000 ollama serve

   # Windows (PowerShell)
   $env:OLLAMA_ORIGINS="http://localhost:3000"; ollama serve
   ```

### DeepSeek / Gemini — cloud providers

Create the AI config file (gitignored — must be created manually):

```
ohif-modes/wisespine-extension-layout/src/components/aiConfig.ts
```

```ts
export const GEMINI_API_KEY = 'your-gemini-api-key';     // '' to disable
export const DEEPSEEK_API_KEY = 'your-deepseek-api-key'; // '' to disable
```

Providers with a blank key are hidden from the model dropdown automatically.

For full chatbot component documentation see [ohif-modes/wisespine-extension-layout/src/components/CHATBOT_README.md](ohif-modes/wisespine-extension-layout/src/components/CHATBOT_README.md).

---

## Troubleshooting

**`EADDRINUSE` error on port 3000**

Another process is using port 3000. Find and kill it:

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F
```

**"Data source is not configured correctly or is not running"**

- Verify Docker containers are running: `docker ps`
- Open `http://localhost/orthanc-container/dicom-web/studies` in your browser — it should return JSON
- Confirm `APP_CONFIG=config/local_orthanc.js` is set in `.env`
- Confirm the Webpack proxy rule for `/orthanc-container` is present in `webpack.pwa.js`

**CORS errors in the browser console**

The dev server proxy is not forwarding requests. Check the proxy entry in `webpack.pwa.js`.

**No studies appear in the study list**

Upload DICOM files via `http://localhost/orthanc-container/ui/app/` first.

**Ollama models do not appear in the dropdown**

Ollama must be started with `OLLAMA_ORIGINS=http://localhost:3000`. Without it the browser receives a CORS error and the model list stays empty.

---

## Key Files

| File | Purpose |
|------|---------|
| `Viewers/platform/app/.env` | Sets which OHIF config file is active |
| `Viewers/platform/app/public/config/local_orthanc.js` | DICOMweb data source pointing at Orthanc |
| `Viewers/platform/app/.webpack/webpack.pwa.js` | Dev server proxy rules |
| `orthanc-setup-samples/docker/ohif/docker-compose.yml` | Docker stack (Orthanc + nginx + PostgreSQL) |
| `ohif-modes/wise-spine/src/index.jsx` | WiseSpine mode definition |
| `ohif-modes/wisespine-extension-layout/` | Custom layout extension + AI chatbot |
| `ohif-modes/wisespine-extension-layout/src/components/aiConfig.ts` | API keys — **never commit** |
