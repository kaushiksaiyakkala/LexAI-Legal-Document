@echo off
echo ============================================================
echo  LexAI  —  Agentic Legal Document Intelligence Platform
echo  LangGraph + Groq + ChromaDB + React
echo ============================================================

REM ── 1. Start FastAPI backend (port 8000) ──
echo.
echo Starting FastAPI backend...
start "LexAI Backend" cmd /k "cd /d %~dp0 && py -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"

REM ── 2. Start React frontend (port 5173) ──
echo Starting React frontend...
start "LexAI Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo  Backend:  http://localhost:8000
echo  Frontend: http://localhost:5173
echo  API docs: http://localhost:8000/docs
echo.
echo Both servers are starting in separate windows.
echo Open http://localhost:5173 in your browser.
pause
