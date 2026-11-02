<#
  Publish dsh-time-memory to your own GitHub.

  Usage (inside the repo folder):
    .\publish.cmd                                                     # private repo, includes qqbot/
    .\publish.cmd -Visibility public -RepoUrl https://github.com/USER/REPO.git
    .\publish.cmd -Name my-memory -SkipQqbot                          # different name, no qqbot/

  Notes:
  - This file is intentionally ASCII-only: Windows PowerShell 5.1 decodes .ps1
    files as the system ANSI code page, so non-ASCII text here would break parsing.
  - Launched through publish.cmd, which runs powershell -ExecutionPolicy Bypass,
    so a machine-wide "scripts are disabled" policy does not block it.
  - With gh (GitHub CLI) installed and logged in: creates the repo, sets the
    description, adds topics and pushes.
  - Without gh: pushes to -RepoUrl if given, otherwise prints the manual steps.
#>
param(
  [string]$Name = 'dsh-time-memory',
  [ValidateSet('private', 'public')][string]$Visibility = 'private',
  [string]$Description = 'Time-based memory for DeepSeek Harness: recall the named period first, widen twice, then say "I forgot".',
  [string[]]$Topics = @('dsh', 'dsh-plugin', 'deepseek-harness', 'memory', 'chat-memory', 'time'),
  [string]$RepoUrl = '',
  [switch]$SkipQqbot,
  [string]$Message = 'init: dsh-time-memory plugin',
  [switch]$Help
)

# 'Continue' on purpose: Windows PowerShell turns a native command's stderr into a
# terminating error when the preference is 'Stop', which would abort on harmless
# messages such as "No such remote". Every step below checks $LASTEXITCODE itself.
$ErrorActionPreference = 'Continue'

if ($Help) {
  Get-Help $PSCommandPath -Detailed
  exit 0
}

Set-Location -LiteralPath $PSScriptRoot

# git may be installed but missing from this shell's PATH (fresh install, no new terminal yet)
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  foreach ($dir in @(
      (Join-Path $env:ProgramFiles 'Git\cmd'),
      (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd'),
      (Join-Path $env:USERPROFILE 'scoop\apps\git\current\cmd'))) {
    if ($dir -and (Test-Path (Join-Path $dir 'git.exe'))) {
      $env:PATH = "$dir;$env:PATH"
      Write-Host "[0/4] git found at $dir"
      break
    }
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git not found. Install Git for Windows first: winget install --id Git.Git -e  (then reopen the terminal)'
}

# 1) local repo
if (-not (Test-Path '.git')) {
  git init -b main | Out-Null
  Write-Host '[1/4] git repository initialised (branch main)'
} else {
  Write-Host '[1/4] git repository already present'
}

# 2) optionally keep qqbot/ out of this publish
if ($SkipQqbot) {
  $exclude = Join-Path $PWD '.git/info/exclude'
  New-Item -ItemType Directory -Force -Path (Split-Path $exclude) | Out-Null
  if (-not (Test-Path $exclude)) { New-Item -ItemType File -Path $exclude | Out-Null }
  if (-not (Select-String -Path $exclude -Pattern '^qqbot/$' -Quiet)) {
    Add-Content -Path $exclude -Value 'qqbot/'
  }
  Write-Host '[2/4] qqbot/ excluded via .git/info/exclude'
} else {
  Write-Host '[2/4] qqbot/ follows .gitignore (not committed)'
}

# 3) commit
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m $Message | Out-Null
  Write-Host "[3/4] committed: $Message"
} else {
  Write-Host '[3/4] nothing new to commit'
}

# 4) create or push
$gh = Get-Command gh -ErrorAction SilentlyContinue
$ghReady = $false
if ($gh) {
  gh auth status 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ghReady = $true }
}

# Work out where to push. An explicit -RepoUrl always wins and never creates.
$target = $RepoUrl
if ($target -eq '' -and $ghReady) {
  $login = gh api user --jq .login 2>$null
  if ($LASTEXITCODE -eq 0 -and $login) { $target = "https://github.com/$login/$Name.git" }
}

# Only try to create when the caller did not name an existing repository.
if ($ghReady -and $RepoUrl -eq '') {
  gh repo create $Name "--$Visibility" --description $Description --source . --remote origin --push 2>$null
  if ($LASTEXITCODE -eq 0) {
    foreach ($topic in $Topics) {
      gh repo edit "--add-topic=$topic" 2>$null | Out-Null
    }
    Write-Host "[4/4] created: $(gh repo view --json url -q .url)"
    exit 0
  }
  Write-Warning 'gh repo create failed (the repository probably already exists). Falling back to a plain push.'
} elseif (-not $ghReady) {
  Write-Warning 'gh (GitHub CLI) is missing or not logged in. Falling back to a plain push.'
}

if ($target -ne '') {
  # git config exits 1 without writing to stderr when the key is missing,
  # so this is the one safe way to ask "is there an origin remote?".
  git config --get remote.origin.url | Out-Null
  if ($LASTEXITCODE -eq 0) {
    git remote set-url origin $target
  } else {
    git remote add origin $target
  }
  Write-Host "[4/4] pushing to $target ..."
  git push -u origin main
  if ($LASTEXITCODE -ne 0) {
    throw 'push failed: if the remote already has commits, run "git pull --rebase origin main" and retry; otherwise check your GitHub credentials.'
  }
  if ($ghReady) {
    # Do not overwrite the repo description the owner may have set by hand; only fill in topics.
    foreach ($topic in $Topics) {
      gh repo edit "--add-topic=$topic" 2>$null | Out-Null
    }
    Write-Host '[4/4] topics updated via gh'
  }
  Write-Host "[4/4] done: $target"
  exit 0
}

Write-Host ''
Write-Host 'Manual steps:'
Write-Host "  1) open https://github.com/new and create an EMPTY repo named $Name (no README, no .gitignore, no license)"
Write-Host '  2) run:'
Write-Host "     git remote add origin https://github.com/<your-user>/$Name.git"
Write-Host '     git push -u origin main'
Write-Host ''
Write-Host 'Or re-run with -RepoUrl to let this script push for you:'
Write-Host "     .\publish.cmd -Visibility $Visibility -RepoUrl https://github.com/<your-user>/$Name.git"
