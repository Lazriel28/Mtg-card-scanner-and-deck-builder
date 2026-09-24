# WorldForge app icon generator (PowerShell + System.Drawing).
# Produces icon.ico (256x256 PNG-encoded ICO), icon.png, icon-64.png in project root.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$root = $PSScriptRoot
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::White)
# outer ring
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120,150,220), 20)
$g.DrawEllipse($pen, 16, 16, $size-32, $size-32)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235,235,240))
$g.FillEllipse($brush, 20, 20, $size-40, $size-40)
# earth
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$gp.AddPolygon(@([System.Drawing.Point]::new(128,46),[System.Drawing.Point]::new(210,150),[System.Drawing.Point]::new(90,150)))
$gp.AddPolygon(@([System.Drawing.Point]::new(128,46),[System.Drawing.Point]::new(166,212),[System.Drawing.Point]::new(90,150)))
$gp.AddPolygon(@([System.Drawing.Point]::new(128,46),[System.Drawing.Point]::new(166,212),[System.Drawing.Point]::new(210,150)))
$gb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245,180,60))
$g.FillPath($gb, $gp)
$g.DrawPath((New-Object System.Drawing.Pen([System.Drawing.Color]::White, 6)), $gp)
# spark
$g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,230,120))), 206, 46, 12, 12)
$g.Dispose()
# encode as PNG then build ICO
$ms = (New-Object System.IO.MemoryStream).ToArray(); $bmp.Save([System.IO.MemoryStream]::new(), [System.Drawing.Imaging.ImageFormat]::Png); $ms = [System.IO.MemoryStream]::new(); $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $ms = $ms.ToArray()
$bmp.Dispose()
# ICO header
$ico = [System.Collections.Generic.List[byte]]::new()
$ico.AddRange([System.BitConverter]::GetBytes([Int16]0))        # reserved
$ico.AddRange([System.BitConverter]::GetBytes([Int16]1))        # type (1 = ICO)
$ico.AddRange([System.BitConverter]::GetBytes([Int16]1))        # count
# entry
$entry = [System.Collections.Generic.List[byte]]::new()
$entry.AddRange([System.BitConverter]::GetBytes([Int16]256))    # width
$entry.AddRange([System.BitConverter]::GetBytes([Int16]256))    # height
$entry.AddRange([System.BitConverter]::GetBytes([Int16]0))      # colors
$entry.AddRange([System.BitConverter]::GetBytes([Int16]0))      # reserved
$entry.AddRange([System.BitConverter]::GetBytes([Int16]1))      # planes
$entry.AddRange([System.BitConverter]::GetBytes([Int16]32))     # bpp
$entry.AddRange([System.BitConverter]::GetBytes([Int32]$ms.Length)) # size
$entry.AddRange([System.BitConverter]::GetBytes([Int32]22))     # offset
$ico.AddRange($entry)
$ico.AddRange($ms)
[System.IO.File]::WriteAllBytes((Join-Path $root 'icon.ico'), $ico.ToArray())
$bmp2 = [System.Drawing.Bitmap]::new($size, $size)
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g2.Clear([System.Drawing.Color]::White)
$g2.DrawImage($bmp, 0, 0, $size, $size)
$g2.Dispose()
$bmp2.Save((Join-Path $root 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$small = [System.Drawing.Bitmap]::new(64, 64)
$g3 = [System.Drawing.Graphics]::FromImage($small)
$g3.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g3.DrawImage($bmp2, 0, 0, 64, 64)
$g3.Dispose()
$small.Save((Join-Path $root 'icon-64.png'), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "[worldforge] wrote icon.ico, icon.png, icon-64.png" -ForegroundColor Green
