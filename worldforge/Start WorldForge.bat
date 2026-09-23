@echo off
rem WorldForge launcher - starts the app and closes this window immediately.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
