@echo off
setlocal

rem Start the Satisfactory production planner web service from the project root.
set "ROOT=%~dp0"
set "SERVER=%ROOT%satisfactory_calculator\recipe_web\production_planner_server.py"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

if exist "%VENV_PY%" (
    set "PYTHON=%VENV_PY%"
) else (
    where py >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON=py -3"
    ) else (
        where python >nul 2>nul
        if errorlevel 1 (
            echo Python was not found. Install Python 3 or create .venv in this project.
            exit /b 1
        )
        set "PYTHON=python"
    )
)

echo Starting production planner web service...
echo URL: http://127.0.0.1:8000/
echo Press Ctrl+C to stop.
echo.

cd /d "%ROOT%"
%PYTHON% "%SERVER%" %*
exit /b %errorlevel%
