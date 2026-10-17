[CmdletBinding()]
param([ValidateSet('setup', 'start', 'stop', 'status')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $IsWindows) { throw 'This portable runtime script is for Windows. Other hosts can use an existing local PostgreSQL server through DATABASE_URL.' }

$WorkspaceDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeRoot = Join-Path $WorkspaceDir '.local\native-postgres'
$RuntimeBin = Join-Path $RuntimeRoot 'runtime\pgsql\bin'
$ClusterDir = Join-Path $RuntimeRoot 'cluster'
$ConnectionFile = Join-Path $RuntimeRoot 'connection.json'
$ArchiveFile = Join-Path $RuntimeRoot 'postgresql-17.11-3-windows-x64-binaries.zip'
$ArchiveUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-3-windows-x64-binaries.zip'
$ArchiveDigest = '4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf'
$RuntimePort = 5488

function Expand-ServerRuntime {
  $ExtractionRoot = [IO.Path]::GetFullPath((Join-Path $RuntimeRoot 'runtime'))
  $Archive = [IO.Compression.ZipFile]::OpenRead($ArchiveFile)
  try {
    # The vendor ZIP also bundles a complete GUI/Python distribution. The
    # application needs only the database server, its libraries and SQL data.
    foreach ($Entry in $Archive.Entries) {
      if ($Entry.FullName -notmatch '^pgsql/(bin/|lib/|share/|server_license\.txt$|commandlinetools_3rd_party_licenses\.txt$)') { continue }
      $Target = [IO.Path]::GetFullPath((Join-Path $ExtractionRoot $Entry.FullName))
      if (-not $Target.StartsWith($ExtractionRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'The archive contains a path outside the owned runtime.' }
      if ($Entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }
      else {
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($Target)) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry, $Target, $true)
      }
    }
    [IO.File]::WriteAllText((Join-Path $RuntimeRoot 'server-runtime.complete'), $ArchiveDigest)
  } finally { $Archive.Dispose() }
}

function Protect-LocalPath([string]$LiteralPath) {
  $OwnerName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $Grant = if (Test-Path -LiteralPath $LiteralPath -PathType Container) { "${OwnerName}:(OI)(CI)F" } else { "${OwnerName}:F" }
  # Change only the DACL; changing owner/audit descriptors can require an
  # administrator's SeSecurityPrivilege even for an otherwise owned path.
  $Result = & (Join-Path $env:SystemRoot 'System32\icacls.exe') $LiteralPath '/inheritance:r' '/grant:r' $Grant 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'The current user could not restrict the owned PostgreSQL runtime permissions.' }
}

function Invoke-LocalPg([string]$Program, [string[]]$Arguments) {
  $RunId = [Guid]::NewGuid().ToString('N')
  $OutputLog = Join-Path $RuntimeRoot ($RunId + '.stdout.log')
  $ErrorLog = Join-Path $RuntimeRoot ($RunId + '.stderr.log')
  $QuotedArguments = @($Arguments | ForEach-Object {
    if ($_ -match '["\r\n]') { throw 'Unexpected character in a local PostgreSQL argument.' }
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
  })
  $Child = Start-Process -FilePath $Program -ArgumentList $QuotedArguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $OutputLog -RedirectStandardError $ErrorLog
  # Wait for pg_ctl itself, not the background postgres descendants it starts.
  $Child.WaitForExit()
  $Code = $Child.ExitCode
  # A detached server can briefly retain its parent's redirected handles.
  # Its readiness/exit status is authoritative; logs remain in this private dir.
  $OutputText = ''; $ErrorText = ''
  if ($Arguments[0] -ne 'start' -or $Code -ne 0) {
    for ($Attempt = 0; $Attempt -lt 5; $Attempt++) {
      try { $OutputText = [IO.File]::ReadAllText($OutputLog); $ErrorText = [IO.File]::ReadAllText($ErrorLog); break }
      catch [IO.IOException] { if ($Attempt -lt 4) { Start-Sleep -Milliseconds 20 } }
    }
  }
  return @{ Code = $Code; Output = $OutputText; Error = $ErrorText }
}

function Test-ClusterRunning {
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeBin 'pg_ctl.exe'))) { return $false }
  $Result = Invoke-LocalPg (Join-Path $RuntimeBin 'pg_ctl.exe') @('status', '-D', $ClusterDir)
  if ($Result.Code -notin @(0, 3, 4)) { throw ('Cannot inspect the owned cluster: ' + $Result.Error) }
  return $Result.Code -eq 0
}

function Start-OwnedCluster {
  if (-not (Test-Path -LiteralPath (Join-Path $ClusterDir 'PG_VERSION'))) { throw 'Run setup first. An existing incomplete cluster is never erased automatically.' }
  if (Test-ClusterRunning) { return }
  if (Get-NetTCPConnection -LocalPort $RuntimePort -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $RuntimePort belongs to another process. It was not stopped."
  }
  $Result = Invoke-LocalPg (Join-Path $RuntimeBin 'pg_ctl.exe') @('start', '-D', $ClusterDir, '-l', (Join-Path $RuntimeRoot 'postgres.log'), '-w', '-t', '60')
  if ($Result.Code -ne 0) { throw ('The owned PostgreSQL cluster did not start: ' + $Result.Error) }
}

if ($Action -eq 'setup') {
  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  Protect-LocalPath $RuntimeRoot
  if (-not (Test-Path -LiteralPath $ArchiveFile)) { Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchiveFile }
  if ((Get-FileHash -LiteralPath $ArchiveFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ArchiveDigest) {
    throw 'The portable archive does not match the SHA-256 published by its vendor. Nothing was executed.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'server-runtime.complete')) -or -not (Test-Path -LiteralPath (Join-Path $RuntimeBin 'postgres.exe'))) {
    Expand-ServerRuntime
  }
  $Version = Invoke-LocalPg (Join-Path $RuntimeBin 'postgres.exe') @('--version')
  if ($Version.Code -ne 0 -or $Version.Output -notmatch '17\.11') { throw 'Unexpected PostgreSQL runtime version.' }
  if (-not (Test-Path -LiteralPath (Join-Path $ClusterDir 'PG_VERSION'))) {
    if (Test-Path -LiteralPath $ClusterDir) { throw 'An incomplete cluster exists. It was retained for inspection; no files were deleted.' }
    $Password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $PasswordFile = Join-Path $RuntimeRoot 'initdb-password.txt'
    [IO.File]::WriteAllText($PasswordFile, $Password + "`n", [Text.UTF8Encoding]::new($false))
    Protect-LocalPath $PasswordFile
    try {
      $Init = Invoke-LocalPg (Join-Path $RuntimeBin 'initdb.exe') @('-D', $ClusterDir, '--username=aidscaler_local', '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', ('--pwfile=' + $PasswordFile))
      if ($Init.Code -ne 0) { throw ('The owned PostgreSQL cluster could not initialize: ' + $Init.Error) }
      $Settings = @"

# AidScaler local runtime. Physical durability settings stay enabled.
listen_addresses = '127.0.0.1'
port = 5488
password_encryption = 'scram-sha-256'
max_connections = 150
shared_buffers = '256MB'
work_mem = '16MB'
effective_cache_size = '2GB'
checkpoint_timeout = '10min'
max_wal_size = '1GB'
fsync = on
synchronous_commit = on
full_page_writes = on
jit = off
log_statement = 'none'
"@
      [IO.File]::AppendAllText((Join-Path $ClusterDir 'postgresql.conf'), $Settings, [Text.UTF8Encoding]::new($false))
      [IO.File]::WriteAllText((Join-Path $ClusterDir 'pg_hba.conf'), "# Private loopback-only local application cluster.`nhost all all 127.0.0.1/32 scram-sha-256`n", [Text.UTF8Encoding]::new($false))
      $Connection = [ordered]@{
        format = 'aidscaler-native-postgres-v1'; host = '127.0.0.1'; port = $RuntimePort
        user = 'aidscaler_local'; password = $Password; database = 'postgres'
        databaseUrl = ('postgresql://aidscaler_local:' + $Password + '@127.0.0.1:5488/postgres')
        clusterDir = $ClusterDir; binDir = $RuntimeBin; version = '17.11'; archiveSha256 = $ArchiveDigest
        vendorUrl = $ArchiveUrl; checksumSource = 'https://github.com/EnterpriseDB/edb-installers/issues/682'
      }
      [IO.File]::WriteAllText($ConnectionFile, ($Connection | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
      Protect-LocalPath $ConnectionFile
    } finally {
      if (Test-Path -LiteralPath $PasswordFile) { Remove-Item -LiteralPath $PasswordFile }
    }
  }
  if (-not (Test-Path -LiteralPath $ConnectionFile)) { throw 'The existing cluster has no matching private connection file. Credentials were not replaced.' }
  Start-OwnedCluster
} elseif ($Action -eq 'start') {
  Start-OwnedCluster
} elseif ($Action -eq 'stop') {
  if (Test-ClusterRunning) {
    $Result = Invoke-LocalPg (Join-Path $RuntimeBin 'pg_ctl.exe') @('stop', '-D', $ClusterDir, '-m', 'fast', '-w', '-t', '60')
    if ($Result.Code -ne 0) { throw ('The owned cluster has not completed its clean shutdown: ' + $Result.Error) }
  }
}

$Running = Test-ClusterRunning
Write-Output ('Local PostgreSQL 17.11: ' + $(if ($Running) { 'running on 127.0.0.1:5488' } else { 'stopped' }))
if ($Running) { Write-Output 'Connection details remain in the ignored .local/native-postgres/connection.json file.' }
