<#
.SYNOPSIS
  Install (or roll back) dsh-echocat-skill-panel in the live DSH Desktop Beta profile.

.DESCRIPTION
  Upgrading this plugin means changing its *name* as well as its contents, because
  the package name is simultaneously the Loader entry name, the vendor directory
  name, the node_modules junction name and the client bundle id. So this script
  does four things atomically:

    1. backs up the profile manifest before it touches anything,
    2. mirrors the plugin into <profile>\vendor\dsh-echocat-skill-panel,
    3. removes the previous name everywhere it appears (an entry in
       `dsh.profile.bundles` whose directory no longer exists aborts profile
       assembly — the app will not start),
    4. re-points the manifest and the junction at the new name and installs.

  Nothing is deleted that cannot be restored: -Rollback restores the newest
  manifest backup and removes the new name again.

.EXAMPLE
  & ".\安装.ps1"
  & ".\安装.ps1" -SkipInstall          # manifest + files only
  & ".\安装.ps1" -Rollback             # undo the last install
#>
[CmdletBinding()]
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh-beta\profiles\desktop'),
  # Works from either layout: the authoring tree keeps the package in .\plugin,
  # while the shared folder IS the package.
  [string]$Source = $(if (Test-Path (Join-Path $PSScriptRoot 'plugin')) { Join-Path $PSScriptRoot 'plugin' } else { $PSScriptRoot }),
  [string]$AppDir = (Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop Beta\resources\app'),
  # Previous package names to purge; the app cannot start while one of these is
  # listed in `bundles` but absent from disk.
  #
  # THESE KEEP THEIR HISTORICAL SPELLING. The package has been renamed before — the version
  # was once part of the name, and 5.0 prefixed `dsh-`. This list records what was ACTUALLY
  # published, so the entries must be the literal old package names. A rename pass that
  # rewrites them to match the current name turns every entry into a directory that never
  # existed: it purges nothing while looking like it works.
  #
  # `echocat-skill-panel` is the one that matters for anyone upgrading from 4.x — it is the
  # name the plugin shipped under until 5.0, so its vendor directory, its junction and its
  # `bundles` entry all have to go in the SAME run that installs the new name. Leaving any
  # one of them behind stops the profile from assembling.
  [string[]]$OldNames = @('echocat-skill-panel', 'echocat-skill-panel-3.0', 'echocat-skill-panel-2.0', 'EchoCat-skill-Panel-2.0', 'dsh-skill-report'),
  [switch]$SkipInstall,
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$NewName = 'dsh-echocat-skill-panel'
$VendorDir = Join-Path $ProfileDir "vendor\$NewName"
$Junction = Join-Path $ProfileDir "node_modules\$NewName"
$BackupRoot = Join-Path $ProfileDir '.echocat-backups'
$Manifest = Join-Path $ProfileDir 'package.json'

function Say([string]$text, [string]$colour = 'Gray') { Write-Host $text -ForegroundColor $colour }
function Fail([string]$text) { Write-Host "FAIL  $text" -ForegroundColor Red; exit 1 }

<#
  Remove a directory junction WITHOUT following it.

  `Remove-Item -Recurse` on a reparse point is version-dependent: it can walk into
  the TARGET and delete its contents, which here would wipe the vendor tree we
  just mirrored. The .NET call removes the link itself, never the target.
#>
function Remove-Link([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  try {
    [System.IO.Directory]::Delete($path, $false)
  } catch {
    # Non-recursive as the fallback too: a link is removed, a real directory is not.
    Remove-Item $path -Force -ErrorAction SilentlyContinue
  }
  return $true
}

if (-not (Test-Path $Manifest)) { Fail "no profile manifest at $Manifest" }

# ---------------------------------------------------------------- rollback --
if ($Rollback) {
  if (-not (Test-Path $BackupRoot)) { Fail "no backups under $BackupRoot" }
  $latest = Get-ChildItem $BackupRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if ($null -eq $latest) { Fail "no backup directories under $BackupRoot" }
  $saved = Join-Path $latest.FullName 'package.json'
  if (-not (Test-Path $saved)) { Fail "backup $($latest.Name) has no package.json" }
  Copy-Item $saved $Manifest -Force
  Say "restored $saved" 'Green'
  if (Remove-Link $Junction) { Say "  removed junction $NewName" Yellow }
  if (Test-Path $VendorDir) { Remove-Item $VendorDir -Recurse -Force }
  Say "removed $NewName from vendor and node_modules." 'Green'
  Say "Restart DSH Desktop Beta to apply." 'Yellow'
  exit 0
}

# ------------------------------------------------------------ precondition --
Say "`n=== preconditions ===" Cyan
if (-not (Test-Path (Join-Path $Source 'package.json'))) { Fail "no package.json under $Source" }
$pkg = Get-Content (Join-Path $Source 'package.json') -Raw | ConvertFrom-Json
if ($pkg.name -ne $NewName) { Fail "source package.json says '$($pkg.name)', expected '$NewName'" }
if (-not (Test-Path (Join-Path $Source 'lib\client.js'))) { Fail "lib/client.js is missing — run 'node tools/build-client.mjs' first" }
if (-not (Test-Path (Join-Path $Source 'cordis.patch.yml'))) { Fail "cordis.patch.yml is missing" }
if (-not $pkg.dsh.bundle.patch) { Fail "package.json has no dsh.bundle.patch — profile assembly would throw" }
if ($pkg.dsh.client.platform -ne 'web') { Fail "dsh.client.platform must be 'web'" }
if (-not $pkg.exports.'./client') { Fail "package.json exports no './client' — the modules entry would fail" }
Say "  source is $NewName $($pkg.version), bundle + patch + client all present" Green

# ---------------------------------------------------------------- backup ----
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force $backupDir | Out-Null
Copy-Item $Manifest (Join-Path $backupDir 'package.json') -Force
Say "  manifest backed up to $backupDir" Green

# ------------------------------------------------------------ mirror files --
Say "`n=== vendor ===" Cyan
New-Item -ItemType Directory -Force (Join-Path $ProfileDir 'vendor') | Out-Null
$rc = robocopy $Source $VendorDir /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { Fail "robocopy failed ($LASTEXITCODE)" }
Say "  mirrored to $VendorDir" Green

# --------------------------------------------------------- purge old names --
Say "`n=== purging previous names ===" Cyan
foreach ($old in $OldNames) {
  if ($old -eq $NewName) { continue }
  $oldJunction = Join-Path $ProfileDir "node_modules\$old"
  $oldVendor = Join-Path $ProfileDir "vendor\$old"
  if (Remove-Link $oldJunction) { Say "  removed junction $old" Yellow }
  if (Test-Path $oldVendor) { Remove-Item $oldVendor -Recurse -Force; Say "  removed vendor\$old" Yellow }
}

# --------------------------------------------------------------- junction ---
Remove-Link $Junction | Out-Null
New-Item -ItemType Junction -Path $Junction -Target $VendorDir | Out-Null
Say "`n  junction: $Junction -> $VendorDir" Green

# --------------------------------------------------------------- manifest ---
Say "`n=== manifest ===" Cyan
# NOTE: the parsed document is `$doc`, never `$manifest` — PowerShell variable
# names are CASE-INSENSITIVE, so `$manifest` would silently overwrite `$Manifest`,
# the path, and every later file call would receive a PSCustomObject.
$doc = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json

$deps = [ordered]@{}
foreach ($prop in $doc.dependencies.PSObject.Properties) {
  if ($OldNames -contains $prop.Name -or $prop.Name -eq $NewName) { continue }
  $deps[$prop.Name] = $prop.Value
}
$deps[$NewName] = "link:./vendor/$NewName"
$doc.dependencies = [pscustomobject]$deps

$bundles = @()
foreach ($entry in @($doc.dsh.profile.bundles)) {
  if ($OldNames -contains $entry -or $entry -eq $NewName) { continue }
  $bundles += $entry
}
$bundles += $NewName
$doc.dsh.profile.bundles = $bundles

$json = $doc | ConvertTo-Json -Depth 12
# Written with the two-argument overload, which emits UTF-8 WITHOUT a BOM: the
# profile manifest is read back with a plain JSON.parse, and a leading U+FEFF
# would break that. (`Set-Content -Encoding UTF8` in Windows PowerShell 5.1 adds
# a BOM, so it is not an option.)
[System.IO.File]::WriteAllText($Manifest, [string]$json)
Say "  dependencies: $($deps.Keys -join ', ')" Green
Say "  bundles:      $($bundles -join ', ')" Green

# ------------------------------------------------------------------ pnpm ----
if ($SkipInstall) {
  Say "`n=== pnpm install skipped (-SkipInstall) ===" Yellow
} else {
  Say "`n=== pnpm install ===" Cyan
  $pnpm = Join-Path $AppDir 'node_modules\pnpm\bin\pnpm.mjs'
  if (-not (Test-Path $pnpm)) { Fail "pnpm not found at $pnpm (pass -AppDir)" }
  Push-Location $ProfileDir
  try { & node $pnpm install } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed ($LASTEXITCODE)" }
  Say "  dependencies installed" Green
}

Say "`n=== done ===" Cyan
Say "Restart DSH Desktop Beta to load the plugin, then look for:" Gray
Say "  [I] [$NewName] skill-report: install endpoint will write to <skills root>" Gray
Say "  [I] [$NewName] skill-report: skill install endpoint at /api/skill-report/skills" Gray
Say "Roll back with:  & `"$PSCommandPath`" -Rollback" Gray
