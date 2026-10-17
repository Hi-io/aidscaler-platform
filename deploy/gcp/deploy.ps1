param(
  [ValidateSet('Check','Safety','Foundation','Build','Runtime','Hosting')]
  [string]$Stage = 'Check',
  [string]$Tag = ''
)
$ErrorActionPreference = 'Stop'
$platform = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$workspace = Split-Path $platform
$terraform = Join-Path $workspace '.local/tools/terraform.exe'
$sdk = '/home/hiio/.local/aidscaler-tools/google-cloud-sdk/bin/gcloud'
Set-Location -LiteralPath $platform
$settings = Get-Content -LiteralPath '.local/gcp/settings.json' -Raw | ConvertFrom-Json
$env:TF_VAR_alert_email = $settings.alertEmail
if (-not $env:TF_VAR_alert_email) { throw 'Set the private alert email in .local/gcp/settings.json.' }
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed: $Executable" }
}
function Read-Gcloud([string[]]$Arguments) {
  $result = & wsl.exe -d Ubuntu -- $sdk @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Google Cloud command failed.' }
  return ($result -join [Environment]::NewLine)
}
if ($Stage -eq 'Check') {
  $unitTests = @(Get-ChildItem tests/cloud*.test.mjs | ForEach-Object { $_.FullName })
  Invoke-Checked 'node' (@('--test','--test-concurrency=1') + $unitTests + @('tests/vertex-provider.test.mjs','../disaster-response-simulator/tests/cloud-bridge.test.mjs'))
  Invoke-Checked 'node' @('deploy/gcp/prepare.mjs')
  Invoke-Checked $terraform @("-chdir=$PSScriptRoot", 'init','-backend=false','-input=false','-no-color')
  Invoke-Checked $terraform @("-chdir=$PSScriptRoot", 'validate','-no-color')
  Invoke-Checked $terraform @("-chdir=$PSScriptRoot", 'test','-no-color')
  Invoke-Checked 'node' @('deploy/gcp/preflight.mjs')
  exit 0
}
$billing = (Read-Gcloud @('billing','projects','describe','aidscaler','--format=json')) | ConvertFrom-Json
if (-not $billing.billingEnabled) { throw 'Billing is not enabled. No resources were created.' }
$env:GOOGLE_OAUTH_ACCESS_TOKEN = (Read-Gcloud @('auth','print-access-token')).Trim()
try {
  $headers = @{Authorization="Bearer $env:GOOGLE_OAUTH_ACCESS_TOKEN"}
  $account = Invoke-RestMethod -Uri "https://cloudbilling.googleapis.com/v1/$($billing.billingAccountName)" -Headers $headers
  if ($account.currencyCode -ne 'USD') { throw 'Billing currency is not USD. Convert and review budget amounts first; no resources were created.' }
  $env:GCP_BILLING_ACCOUNT = $billing.billingAccountName.Replace('billingAccounts/','')
  $env:TF_VAR_billing_account_id = $env:GCP_BILLING_ACCOUNT
  $jwks = & wsl.exe -d Ubuntu -- /home/hiio/.local/bin/kubectl --context kubernetes-admin@kubernetes get --raw /openid/v1/jwks
  if ($LASTEXITCODE -ne 0) { throw 'Cannot retrieve the Kubernetes public signing keys.' }
  $env:TF_VAR_kubernetes_jwks = $jwks -join [Environment]::NewLine
  $bucket = 'aidscaler-terraform-state-439219992256'
  # State contains private credentials. Keep the backend private and out of Git.
  try { Read-Gcloud @('storage','buckets','describe',"gs://$bucket",'--format=json') | Out-Null }
  catch {
    Read-Gcloud @('storage','buckets','create',"gs://$bucket",'--project=aidscaler','--location=us-central1','--uniform-bucket-level-access','--public-access-prevention') | Out-Null
  }
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'backend.tf'), 'terraform { backend "gcs" {} }')
  Invoke-Checked $terraform @("-chdir=$PSScriptRoot",'init','-reconfigure',"-backend-config=bucket=$bucket",'-backend-config=prefix=demo','-input=false','-no-color')
  if ($Stage -eq 'Safety') {
    Invoke-Checked $terraform @("-chdir=$PSScriptRoot",'apply','-input=false','-auto-approve','-target=google_billing_budget.infrastructure','-no-color')
    Invoke-Checked 'node' @('deploy/gcp/spend-cap.mjs')
  } elseif ($Stage -eq 'Foundation') {
    $existing = & $terraform "-chdir=$PSScriptRoot" state list
    if ($existing -match 'google_cloud_run_v2_service\.api') { throw 'Runtime already exists. Use Runtime for updates; Foundation is only for initial setup.' }
    Invoke-Checked 'node' @('deploy/gcp/spend-cap.mjs')
    Invoke-Checked $terraform @("-chdir=$PSScriptRoot",'apply','-input=false','-auto-approve','-var=deploy_runtime=false','-no-color')
  } elseif ($Stage -eq 'Build') {
    Invoke-Checked 'node' @('deploy/gcp/spend-cap.mjs')
    Invoke-Checked 'node' @('deploy/gcp/prepare.mjs')
    if (-not $Tag) { $Tag = (git rev-parse --short=12 HEAD).Trim() }
    $stagePath = Join-Path $platform '.local/gcp/stage'
    $wslPath = (& wsl.exe -d Ubuntu -- wslpath -a $stagePath).Trim()
    Read-Gcloud @('builds','submit',$wslPath,'--project=aidscaler',"--config=$wslPath/cloudbuild.json",
      '--gcs-source-staging-dir=gs://aidscaler-build-source-439219992256/source',
      '--service-account=projects/aidscaler/serviceAccounts/aidscaler-build@aidscaler.iam.gserviceaccount.com',
      "--substitutions=_REPOSITORY=us-central1-docker.pkg.dev/aidscaler/aidscaler,_TAG=$Tag") | Out-Host
  } elseif ($Stage -eq 'Runtime') {
    if (-not $Tag) { throw 'Pass the verified build tag with -Tag.' }
    Invoke-Checked 'node' @('deploy/gcp/spend-cap.mjs')
    Invoke-Checked $terraform @("-chdir=$PSScriptRoot",'apply','-input=false','-auto-approve','-var=deploy_runtime=true',
      "-var=image=us-central1-docker.pkg.dev/aidscaler/aidscaler/platform:$Tag",'-no-color')
  } elseif ($Stage -eq 'Hosting') {
    Invoke-Checked 'node' @('deploy/gcp/prepare.mjs')
    Invoke-Checked 'node' @('deploy/gcp/publish-hosting.mjs')
  }
} finally {
  Remove-Item Env:GOOGLE_OAUTH_ACCESS_TOKEN -ErrorAction SilentlyContinue
}
