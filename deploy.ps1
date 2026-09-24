# Build and deploy Command Center to Cloudflare Workers.
#
# Set these first, from your own Cloudflare account:
#   $env:CLOUDFLARE_API_TOKEN  = "..."
#   $env:CLOUDFLARE_ACCOUNT_ID = "..."
#
# Usage:  powershell -ExecutionPolicy Bypass -File deploy.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $env:CLOUDFLARE_API_TOKEN -or -not $env:CLOUDFLARE_ACCOUNT_ID) {
  throw "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first. See README.md."
}

Write-Host "Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

# Change the worker `name` in .output/server/wrangler.json to something of your
# own before the first deploy, or it will collide with someone else's.
Write-Host "Deploying to Cloudflare Workers..." -ForegroundColor Cyan
npx --yes wrangler@latest deploy --config .output/server/wrangler.json
if ($LASTEXITCODE -ne 0) { throw "Deploy failed." }

Write-Host "Done." -ForegroundColor Green
