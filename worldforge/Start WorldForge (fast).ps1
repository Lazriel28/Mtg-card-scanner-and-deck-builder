# WorldForge fast launcher - skips rebuild, launches the already-built Electron, auto-closes console.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$exe = Join-Path $here "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $exe)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Electron isn't installed yet.`nOne-time fix: open a terminal here and run: npm install", "WorldForge", 'OK', 'Error') | Out-Null
    exit 1
}
$proc = Start-Process -FilePath $exe -ArgumentList ('"' + $here + '"') -NoNewWindow -PassThru
Start-Sleep -Milliseconds 600
if ($proc.HasExited) {
    Write-Host "[worldforge] Electron exited immediately (exit code $($proc.ExitCode))." -ForegroundColor Red
    Read-Host "press Enter to close"
} else {
    Write-Host "[worldforge] Electron is running (pid $($proc.Id)). Closing launcher window..." -ForegroundColor Green
    Stop-Process -Id $PID -Force -ErrorAction SilentlyContinue
}
