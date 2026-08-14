$ErrorActionPreference = 'Stop'
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = 'postgres://nssms:nssms@localhost:5432/nssms' }
if (-not $env:AUTH_SECRET) { $env:AUTH_SECRET = 'local-development-secret-change-me' }

Write-Host 'Applying database migrations...'
Push-Location "$PSScriptRoot\..\backend"
npm run migrate
Write-Host 'Starting backend in a new PowerShell window...'
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$PWD'; `$env:DATABASE_URL='$env:DATABASE_URL'; `$env:AUTH_SECRET='$env:AUTH_SECRET'; npm run dev"
Pop-Location

Write-Host 'Starting frontend in a new PowerShell window...'
Push-Location "$PSScriptRoot\..\frontend"
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$PWD'; `$env:VITE_API_URL='http://localhost:3000'; npm run dev -- --host 0.0.0.0"
Pop-Location
Write-Host 'Local services requested: backend http://localhost:3000 and frontend http://localhost:5173'
