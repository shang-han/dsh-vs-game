@echo off
rem Dev dependency junctions: link EAC runtime packages into plugin node_modules.
rem ASCII-only on purpose: cmd.exe parses batch files as ANSI; UTF-8 corrupts them.
set SRC=D:\DSH\Deepseek Harness EAC\resources\app\node_modules
set DST=D:\DSH\workspace\plugin\dsh-vs-game\node_modules

if not exist "%DST%\@deepseek-ai" mkdir "%DST%\@deepseek-ai"
if not exist "%DST%\@standard-schema" mkdir "%DST%\@standard-schema"

call :link "%DST%\ws" "%SRC%\ws"
call :link "%DST%\zod" "%SRC%\zod"
call :link "%DST%\@deepseek-ai\cosmokit" "%SRC%\@deepseek-ai\cosmokit"
call :link "%DST%\@deepseek-ai\schemastery" "%SRC%\@deepseek-ai\schemastery"
call :link "%DST%\@deepseek-ai\dsh-storage-domain" "%SRC%\@deepseek-ai\dsh-storage-domain"
call :link "%DST%\@standard-schema\spec" "%SRC%\@standard-schema\spec"
echo Done.
exit /b 0

:link
rem remove broken/old junction first (rmdir removes junctions, not contents)
if exist "%~1" rmdir "%~1"
mklink /J "%~1" "%~2" >nul
if errorlevel 1 (echo FAILED %~1) else (echo linked %~nx1)
exit /b 0
