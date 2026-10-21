@echo off
REM ====================================================================
REM  A股四线资金博弈分时图 - 单次启动脚本
REM  双击运行 / 命令行运行皆可，关闭窗口即停止服务
REM ====================================================================

setlocal

cd /d "%~dp0"

REM 1. 检测端口 8765 是否已被占用（说明服务已在跑）
netstat -ano | findstr :8765 | findstr LISTENING >nul 2>&1
if %errorlevel%==0 (
    echo [info] 端口 8765 已被占用，跳过启动，直接打开浏览器。
    start http://127.0.0.1:8765/
    goto :end
)

REM 2. 探测 python 命令（兼容 py launcher）
where python >nul 2>&1
if %errorlevel%==0 (
    set "PY=python"
) else (
    where py >nul 2>&1
    if %errorlevel%==0 (
        set "PY=py -3"
    ) else (
        echo [error] 未找到 python，请先安装 Python 3.7+
        pause
        goto :end
    )
)

echo [info] 启动本地代理服务（按 Ctrl+C 停止）...
echo.

REM 3. 启动服务。前台运行，关闭窗口即停止。
%PY% server.py

:end
endlocal