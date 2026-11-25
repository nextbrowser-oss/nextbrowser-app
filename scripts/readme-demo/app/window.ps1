# Moves, focuses or grabs the Nextbrowser window in physical pixels (used by record.mjs).
param([string]$Action = "rect", [int]$Width = 1280, [int]$Height = 800, [int]$X = 60, [int]$Y = 40, [string]$Out = "")
Add-Type -Namespace Z -Name D -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
public struct RECT { public int L, T, R, B; }
'@
[Z.D]::SetProcessDPIAware() | Out-Null
$p = Get-Process NextBrowser | Where-Object { $_.MainWindowTitle -eq 'Nextbrowser' } | Select-Object -First 1
$hwnd = $p.MainWindowHandle
if ($Action -eq "move") { [Z.D]::ShowWindow($hwnd, 9) | Out-Null; [Z.D]::MoveWindow($hwnd, $X, $Y, $Width, $Height, $true) | Out-Null; Start-Sleep -Milliseconds 400 }
if ($Action -in @("move", "front", "grab")) { [Z.D]::SetForegroundWindow($hwnd) | Out-Null; Start-Sleep -Milliseconds 400 }
$r = New-Object Z.D+RECT; [Z.D]::GetWindowRect($hwnd, [ref]$r) | Out-Null
"$($r.L) $($r.T) $($r.R - $r.L) $($r.B - $r.T)"
if ($Action -eq "grab" -and $Out) {
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  & $(if ($env:FFMPEG) { $env:FFMPEG } else { "ffmpeg" }) -hide_banner -loglevel error -y -f gdigrab -draw_mouse 0 -offset_x $r.L -offset_y $r.T -video_size "${w}x${hh}" -i desktop -frames:v 1 $Out
}
