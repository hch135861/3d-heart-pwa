$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$required = @(
    'index.html',
    'manifest.webmanifest',
    'service-worker.js',
    'vendor\three.module.js',
    'vendor\OrbitControls.js',
    'icons\icon-192.png',
    'icons\icon-512.png',
    'icons\apple-touch-icon.png',
    '.github\workflows\deploy-pages.yml',
    'README.md'
)

$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) })
if ($missing.Count -gt 0) {
    throw "Missing PWA files: $($missing -join ', ')"
}

$index = Get-Content -LiteralPath (Join-Path $root 'index.html') -Raw
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.webmanifest') -Raw | ConvertFrom-Json
$worker = Get-Content -LiteralPath (Join-Path $root 'service-worker.js') -Raw
$workflow = Get-Content -LiteralPath (Join-Path $root '.github\workflows\deploy-pages.yml') -Raw

if ($index -match 'https?://|unpkg\.com|cdn\.') { throw 'Remote URL found in index.html.' }
if ($index -notmatch 'manifest\.webmanifest') { throw 'Manifest link is missing.' }
if ($index -notmatch 'apple-touch-icon\.png') { throw 'Apple touch icon link is missing.' }
if ($index -notmatch "serviceWorker\.register\('\./service-worker\.js'\)") { throw 'Service Worker registration is missing.' }
if ($index -notmatch 'getInitialCameraDistance') { throw 'Responsive camera distance is missing.' }
if ($index -notmatch 'controls\.maxDistance\s*=\s*80') { throw 'Portrait zoom range is too small.' }

if ($manifest.name -ne '3D 爱心' -or $manifest.display -ne 'standalone') { throw 'Manifest identity or display mode is invalid.' }
if ($manifest.start_url -ne './' -or $manifest.scope -ne './') { throw 'Manifest scope is invalid for GitHub Pages.' }
if (@($manifest.icons).Count -ne 2) { throw 'Manifest must contain two install icons.' }

$workerRequirements = @(
    'heart-pwa-v1',
    './index.html',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './vendor/three.module.js',
    './vendor/OrbitControls.js',
    "key\.startsWith\(CACHE_PREFIX\)",
    'cache\.addAll\(CORE_ASSETS\)'
)
foreach ($pattern in $workerRequirements) {
    if ($worker -notmatch $pattern) { throw "Missing Service Worker rule: $pattern" }
}

$officialActions = @(
    'actions/checkout@v4',
    'actions/configure-pages@v5',
    'actions/upload-pages-artifact@v3',
    'actions/deploy-pages@v4'
)
foreach ($action in $officialActions) {
    if ($workflow -notmatch [regex]::Escape($action)) { throw "Missing official Pages action: $action" }
}

Write-Output 'PASS: PWA structure and offline assets verified'
