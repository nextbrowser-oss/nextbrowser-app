$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted'){throw 'This installer test must run on a disposable hosted Windows VM'}
if($env:CANDIDATE_RUN -notmatch '^[0-9]+$' -or $env:CANDIDATE_SOURCE -notmatch '^[0-9a-f]{40}$'){throw 'Invalid candidate reference'}
$repo='nextbrowser-oss/nextbrowser-app'
$version='0.2.73-rc.2'
$qa=Join-Path $env:GITHUB_WORKSPACE 'evidence'
$download=Join-Path $env:RUNNER_TEMP 'candidate-download'
$install=Join-Path $env:RUNNER_TEMP 'NextBrowserInstalled'
$install=[IO.Path]::GetFullPath($install)
if(!$install.StartsWith(([IO.Path]::GetFullPath($env:RUNNER_TEMP)+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $install)){throw 'Expected fresh isolated install directory'}
New-Item -ItemType Directory -Path $qa,$download | Out-Null
$result=@{status='started';candidate_source=$env:CANDIDATE_SOURCE;candidate_run_id=$env:CANDIDATE_RUN;version=$version;disposable_runner=$true;local_user_machine_modified=$false;published=$false}
Start-Transcript -Path "$qa/installer-verification.log"
try{
  $run=(& gh api "repos/$repo/actions/runs/$env:CANDIDATE_RUN" | ConvertFrom-Json)
  if($LASTEXITCODE -ne 0 -or $run.head_sha -ne $env:CANDIDATE_SOURCE -or $run.conclusion -ne 'success'){throw 'Candidate CI/source mismatch'}
  & gh run download $env:CANDIDATE_RUN --repo $repo --name "NextBrowser-Windows-$env:CANDIDATE_SOURCE" --dir $download
  if($LASTEXITCODE -ne 0){throw 'Cannot download the exact candidate installer'}
  $installer=Join-Path $download "NextBrowser-$version-x64.exe"
  $metadata=Get-Content -LiteralPath (Join-Path $download 'latest.yml') -Raw
  if($metadata -notmatch ('(?m)^version: '+[regex]::Escape($version)+'\s*$')){throw 'Unexpected updater version'}
  $expected=[regex]::Match($metadata,'(?m)^sha512:\s*(\S+)').Groups[1].Value
  $stream=[IO.File]::OpenRead($installer)
  try{$actual=[Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData($stream))}finally{$stream.Dispose()}
  if(!$expected -or $actual -ne $expected){throw 'Installer SHA512 differs from updater metadata'}
  $result.installer_sha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  $process=Start-Process -FilePath $installer -ArgumentList @('/S','/currentuser',"/D=$install") -Wait -PassThru -WindowStyle Hidden
  if($process.ExitCode -ne 0){throw "Installer failed: $($process.ExitCode)"}
  $executable=Join-Path $install 'NextBrowser.exe'
  if(!(Test-Path -LiteralPath $executable -PathType Leaf)){throw 'The installer did not create the executable at the requested path'}
  if(!(Test-Path -LiteralPath (Join-Path $install 'resources/app.asar') -PathType Leaf)){throw 'Installed app bundle is missing'}
  $result.installed=$true
  $result.installed_product_version=(Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
  if(!$result.installed_product_version.StartsWith('0.2.73')){throw 'Installed executable version mismatch'}
  # The download token is needed by gh only, never inherited by the app.
  Remove-Item Env:GH_TOKEN
  & node "$env:GITHUB_WORKSPACE/source/scripts/smoke-launch.mjs" $executable *> "$qa/installed-app-launch.log"
  if($LASTEXITCODE -ne 0){throw 'Installed app launch failed'}
  $result.launched=$true
  $protocol='HKCU:/Software/Classes/nextbrowser/shell/open/command'
  if(!(Test-Path -LiteralPath $protocol)){throw 'NextBrowser OAuth callback protocol is not registered'}
  $command=(Get-Item -LiteralPath $protocol).GetValue('')
  if(!$command.Contains($executable) -or $command -notmatch '%[1Ll]'){throw 'OAuth callback command does not point to the installed app and URL argument'}
  $result.oauth_protocol_registered=$true
  $uninstallers=@(Get-ChildItem -LiteralPath $install -Filter '*Uninstall*.exe' -File)
  if($uninstallers.Count -ne 1){throw 'Expected one installed uninstaller'}
  $uninstaller=$uninstallers[0].FullName
  if(!$uninstaller.StartsWith(($install+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected uninstaller location'}
  $removed=Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if($removed.ExitCode -ne 0){throw "Uninstaller failed: $($removed.ExitCode)"}
  $deadline=(Get-Date).AddSeconds(45)
  while((Test-Path -LiteralPath $executable) -and (Get-Date) -lt $deadline){Start-Sleep -Seconds 1}
  if(Test-Path -LiteralPath $executable){throw 'Uninstaller left the installed executable'}
  if(Test-Path -LiteralPath $protocol){
    $remaining=(Get-Item -LiteralPath $protocol).GetValue('')
    if($remaining -and $remaining.Contains($install)){throw 'Uninstaller left a callback pointing to the removed app'}
  }
  $result.uninstalled=$true
  $result.status='passed'
}catch{
  $result.status='failed';$result.error=$_.Exception.Message
  throw
}finally{
  $result | ConvertTo-Json -Depth 6 | Set-Content "$qa/installer-verification.json" -Encoding utf8NoBOM
  Stop-Transcript
}
