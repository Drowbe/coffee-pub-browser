# One-shot development setup for Windows. Safe to re-run: every step skips
# what is already in place.
#
#   1. git and fnm (Node version manager), via winget
#   2. Node 22 as the default Node
#   3. ~\Developer with a clone of each repo in $Repos
#   4. npm install for coffee-pub-studio
#
# Run it from PowerShell with:
#   irm https://raw.githubusercontent.com/Drowbe/coffee-pub-studio/main/scripts/win-dev-setup.ps1 | iex
#
# Or download it first and edit the $Repos list to taste before running:
#   iwr https://raw.githubusercontent.com/Drowbe/coffee-pub-studio/main/scripts/win-dev-setup.ps1 -OutFile win-dev-setup.ps1
#   .\win-dev-setup.ps1
#
# Unlike the Mac version of this script, $Repos here does NOT include the
# Foundry module repos (coffee-pub-blacksmith and friends). On a Windows dev
# machine those already live inside Foundry's own Data/modules folder --
# that's the one copy Foundry actually loads -- so cloning them again here
# would just create a second, unsynced copy of each. This script only
# touches the two projects that have no such required location.

$ErrorActionPreference = 'Stop'

$DevDir = Join-Path $HOME 'Developer'
$GitHubUser = 'Drowbe'
$NodeVersion = '22'
$Repos = @(
  'coffee-pub-studio'
  'coffee-pub-tavern'
)

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Yellow }
function Ok($msg) { Write-Host "   $msg" -ForegroundColor Green }

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if ($env:OS -ne 'Windows_NT') {
  Write-Error 'This script is for Windows.'
  exit 1
}

# --- winget -------------------------------------------------------------
if (-not (Test-Command 'winget')) {
  Write-Error "winget isn't available. Install 'App Installer' from the Microsoft Store, then re-run this script."
  exit 1
}

# --- git ------------------------------------------------------------------
Step 'git'
if (Test-Command 'git') {
  Ok "already installed ($(git --version))"
} else {
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  Write-Host '   Installed git. Close this window and re-run the script from a new PowerShell so PATH picks it up.'
  exit 0
}

# --- fnm (Node version manager) -------------------------------------------
Step 'fnm'
if (Test-Command 'fnm') {
  Ok "already installed ($(fnm --version))"
} else {
  winget install --id Schniz.fnm -e --source winget --accept-package-agreements --accept-source-agreements
  Write-Host '   Installed fnm. Close this window and re-run the script from a new PowerShell so PATH picks it up.'
  exit 0
}

# fnm needs to be hooked into the shell profile to auto-switch Node versions
# per directory; add it once so future terminals pick it up.
$profileDir = Split-Path $PROFILE
if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
if (-not (Test-Path $PROFILE) -or -not (Select-String -Path $PROFILE -Pattern 'fnm env' -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path $PROFILE -Value "`nfnm env --use-on-cd | Out-String | Invoke-Expression"
  Ok "added fnm to $PROFILE"
}

# --- Node via fnm -----------------------------------------------------------
Step "Node $NodeVersion via fnm"
fnm env --use-on-cd | Out-String | Invoke-Expression
$installed = fnm list
if ($installed -match "v$NodeVersion\.") {
  Ok "Node $NodeVersion already installed"
} else {
  fnm install $NodeVersion
}
fnm default $NodeVersion
fnm use $NodeVersion
Ok "node $(node --version), npm $(npm --version)"

# --- Repositories -----------------------------------------------------------
Step "Repositories in $DevDir"
if (-not (Test-Path $DevDir)) { New-Item -ItemType Directory -Path $DevDir -Force | Out-Null }
foreach ($repo in $Repos) {
  $target = Join-Path $DevDir $repo
  if (Test-Path (Join-Path $target '.git')) {
    Ok "$repo already cloned"
  } else {
    git clone --quiet "https://github.com/$GitHubUser/$repo.git" $target
    Ok "$repo cloned"
  }
}

# --- coffee-pub-studio dependencies ---------------------------------------
$studioDir = Join-Path $DevDir 'coffee-pub-studio'
if (Test-Path (Join-Path $studioDir 'package.json')) {
  Step 'coffee-pub-studio: npm install'
  Push-Location $studioDir
  npm install --no-audit --no-fund
  # npm sometimes skips Electron's binary download; fetch it explicitly.
  if (-not (Test-Path 'node_modules\electron\path.txt')) {
    Step 'coffee-pub-studio: downloading the Electron binary'
    node node_modules\electron\install.js
  }
  Pop-Location
  Ok "ready: cd $studioDir; npm start"
}

Step 'Done'
Write-Host @"
   Open a new PowerShell window so it picks up fnm and PATH changes.
   Point Cursor / Zed / `claude` at any folder under $DevDir -- they need
   nothing beyond the repo being on disk and git already knowing your
   GitHub credentials.
"@
