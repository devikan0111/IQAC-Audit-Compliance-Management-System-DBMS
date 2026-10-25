$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot '.runtime\mongodb\bin\mongod.exe'
$dataPath = Join-Path $projectRoot '.data\mongodb'
$logPath = Join-Path $projectRoot '.data\mongodb.log'
if (-not (Test-Path -LiteralPath $serverPath)) {
    & node (Join-Path $PSScriptRoot 'download-mongo.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'MongoDB runtime preparation failed.' }
}
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
Write-Output 'Starting local MongoDB on 127.0.0.1:27017. Keep this terminal running.'
& $serverPath --bind_ip 127.0.0.1 --port 27017 --dbpath $dataPath --logpath $logPath --logappend
exit $LASTEXITCODE
