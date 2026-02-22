Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinApi {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$browsers = Get-Process -Name 'chrome','msedge','firefox' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
$b = $browsers | Select-Object -First 1
if ($b) {
    [WinApi]::ShowWindow($b.MainWindowHandle, 3) | Out-Null
    [WinApi]::SetForegroundWindow($b.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 1
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bitmap.Save($args[0])
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "Screenshot saved to $($args[0])"
