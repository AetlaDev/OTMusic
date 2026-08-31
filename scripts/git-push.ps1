# git-push.ps1
# One-command push: stage all changes, auto-generate commit message, commit, pull, push.
# Usage: npm run push

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[push] Working dir: $root" -ForegroundColor Gray

# 1. ensure we are inside a git repository
git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[push] Not a git repository." -ForegroundColor Red
    exit 1
}

# 2. collect changes
$lines = @(git status --porcelain)
if ($lines.Count -eq 0) {
    Write-Host "[push] No local changes. Pulling latest and pushing..."
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { exit 1 }
    git push
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[push] Push failed. Check remote state." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "[push] Already up to date." -ForegroundColor Green
    exit 0
}

Write-Host "[push] Changes detected ($($lines.Count)):" -ForegroundColor Cyan
$lines | ForEach-Object { Write-Host "   $_" }

git add -A
if ($LASTEXITCODE -ne 0) { exit 1 }

# 3. classify changes and build commit message
$added = 0; $modified = 0; $deleted = 0; $renamed = 0
$keyFiles = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
    $code = $line.Substring(0, 2).Trim()
    $path = $line.Substring(3)
    switch -Regex ($code) {
        '^(A|$)' { $added++; break }
        '^D'     { $deleted++; break }
        '^R'     { $renamed++; break }
        default  { $modified++ }
    }
    if ($keyFiles.Count -lt 6) { $keyFiles.Add($path) }
}

$prefix = if ($added -gt 0) { "feat" } else { "chore" }

$counts = @()
if ($added -gt 0)    { $counts += "add $added" }
if ($modified -gt 0) { $counts += "modify $modified" }
if ($deleted -gt 0)  { $counts += "delete $deleted" }
if ($renamed -gt 0)  { $counts += "rename $renamed" }

$short = $keyFiles | ForEach-Object { $_ -replace '^src/', '' }
$fileList = $short -join ", "
if ($lines.Count -gt $keyFiles.Count) {
    $fileList += " (+$($lines.Count - $keyFiles.Count) more)"
}

$msg = "${prefix}: $($counts -join ', ') - $fileList"

# write message via file (avoid console encoding issues), UTF-8 without BOM
$msgFile = Join-Path $env:TEMP ("gitmsg_" + [guid]::NewGuid().ToString("N") + ".txt")
[System.IO.File]::WriteAllText($msgFile, $msg, (New-Object System.Text.UTF8Encoding $false))

try {
    git commit -F $msgFile
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
finally {
    Remove-Item $msgFile -ErrorAction SilentlyContinue
}

Write-Host "[push] Commit: $msg" -ForegroundColor Green

# 4. pull then push
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "[push] Pull failed (remote moved?). Aborting push." -ForegroundColor Yellow
    exit 1
}
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "[push] Push failed." -ForegroundColor Yellow
    exit 1
}

Write-Host "[push] Done." -ForegroundColor Green
