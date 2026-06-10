---
name: restart-membot
description: Restarts MemBot dev servers (Vue frontend on 5173, NestJS backend on 3001, Redis via docker compose). Use when the user asks to restart frontend, restart backend, restart dev servers, or 重启前端/后端/服务.
---

# Restart MemBot Dev Servers

## Project layout

| Service | Directory | Command | URL |
|---------|-----------|---------|-----|
| Frontend (Vue + Vite) | `front/` | `npm run dev` | http://localhost:5173 |
| Backend (NestJS) | `end/` | `npm run start:dev` | http://localhost:3001/api |
| Redis | project root | `docker compose up -d redis` | localhost:6379 |

Project root: `assistant/chat/` (contains `front/`, `end/`, `docker-compose.yml`, `.env`).

## Quick restart (preferred)

Run the bundled script from project root:

```powershell
.\.cursor\skills\restart-membot\scripts\restart.ps1
```

Skip Redis if it is already running:

```powershell
.\.cursor\skills\restart-membot\scripts\restart.ps1 -SkipRedis
```

The script will:
1. Kill processes listening on ports **5173** (frontend) and **3001** (backend)
2. Start Redis via `docker compose up -d redis` (unless `-SkipRedis`)
3. Open two new terminal windows for backend and frontend
4. Poll until both URLs respond

## Manual restart (when script fails)

### 1. Stop existing processes

On Windows, free ports 3001 and 5173:

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

### 2. Start Redis

```powershell
Set-Location <project-root>
docker compose up -d redis
```

### 3. Start backend (background)

```powershell
Set-Location <project-root>/end
npm run start:dev
```

Run in background with `block_until_ms: 0` when using the Shell tool.

### 4. Start frontend (background)

```powershell
Set-Location <project-root>/front
npm run dev
```

Run in background with `block_until_ms: 0` when using the Shell tool.

## Verify

```powershell
# Backend
Invoke-WebRequest http://localhost:3001/api/sessions/history -UseBasicParsing

# Frontend
Invoke-WebRequest http://localhost:5173 -UseBasicParsing
```

Expected: backend returns JSON (possibly `[]`); frontend returns HTML.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend 500 on `/api/sessions/history` | Redis not running → `docker compose up -d redis` |
| `ECONNREFUSED` on port 3001 | Backend not started or still compiling; wait ~10s |
| Frontend proxy errors | Ensure backend is up before using chat features |
| Port already in use | Re-run stop-port commands or use `restart.ps1` |

## Agent workflow

When user says「重启前端和后端」or similar:

1. Run `restart.ps1` from project root (or manual steps above)
2. Report URLs: frontend http://localhost:5173, backend http://localhost:3001/api
3. If verification fails, read terminal output and fix (usually Redis or missing `npm install`)
