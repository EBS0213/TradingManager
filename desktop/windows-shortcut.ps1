param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$Shell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('Desktop')
$Link = $Shell.CreateShortcut((Join-Path $Desktop 'TradingManager.lnk'))
$Link.TargetPath = Join-Path $Root 'Start-Windows.cmd'
$Link.WorkingDirectory = $Root
$Link.Description = 'TradingManager local personal workspace'
$Link.Save()
