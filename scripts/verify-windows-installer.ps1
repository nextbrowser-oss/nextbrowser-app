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
  if($env:CANDIDATE_CLI_RUN){
    if($env:CANDIDATE_CLI_RUN -notmatch '^[0-9]+$' -or $env:CANDIDATE_CLI_SOURCE -notmatch '^[0-9a-f]{40}$'){throw 'Invalid candidate CLI reference'}
    $cliRun=(& gh api "repos/nextbrowser-oss/nextctl/actions/runs/$env:CANDIDATE_CLI_RUN" | ConvertFrom-Json)
    if($LASTEXITCODE -ne 0 -or $cliRun.head_sha -ne $env:CANDIDATE_CLI_SOURCE -or $cliRun.conclusion -ne 'success'){throw 'CLI candidate CI/source mismatch'}
    $cliDownload=Join-Path $env:RUNNER_TEMP 'candidate-cli'
    & gh run download $env:CANDIDATE_CLI_RUN --repo nextbrowser-oss/nextctl --name "nbc-candidate-windows-amd64-$env:CANDIDATE_CLI_SOURCE" --dir $cliDownload
    if($LASTEXITCODE -ne 0){throw 'Cannot download the exact candidate CLI'}
    foreach($line in (Get-Content -LiteralPath (Join-Path $cliDownload 'SHA256SUMS'))){
      if($line -notmatch '^([0-9a-f]{64})\s+(.+)$'){throw 'Invalid CLI checksum record'}
      $wanted=$Matches[1];$relative=$Matches[2]
      $file=[IO.Path]::GetFullPath((Join-Path $cliDownload $relative))
      if(!$file.StartsWith(([IO.Path]::GetFullPath($cliDownload)+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected CLI checksum path'}
      if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wanted){throw 'CLI candidate checksum mismatch'}
    }
    $env:CANDIDATE_CLI_EXE=Join-Path $cliDownload 'nbc-win-amd64/nbc.exe'
    if(!(Test-Path -LiteralPath $env:CANDIDATE_CLI_EXE)){throw 'Candidate CLI executable missing'}
    $result.cli_source=$env:CANDIDATE_CLI_SOURCE
  }
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
  if($env:CANDIDATE_IPC_SCRIPT){
    $env:CANDIDATE_APP_EXE=$executable
    $env:CANDIDATE_EVIDENCE=$qa
    & node $env:CANDIDATE_IPC_SCRIPT *> "$qa/installed-app-launch.log"
  }else{
    & node "$env:GITHUB_WORKSPACE/source/scripts/smoke-launch.mjs" $executable *> "$qa/installed-app-launch.log"
  }
  if($LASTEXITCODE -ne 0){throw 'Installed app launch failed'}
  $result.launched=$true
  $protocol='HKCU:/Software/Classes/nextbrowser/shell/open/command'
  if(!(Test-Path -LiteralPath $protocol)){throw 'NextBrowser OAuth callback protocol is not registered'}
  $command=(Get-Item -LiteralPath $protocol).GetValue('')
  if($command.IndexOf($executable,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $command -notmatch '%[1Ll]'){throw 'OAuth callback command does not point to the installed app and URL argument'}
  $result.oauth_protocol_registered=$true
  $updated=Start-Process -FilePath $installer -ArgumentList @('/S','/currentuser',"/D=$install") -Wait -PassThru -WindowStyle Hidden
  if($updated.ExitCode -ne 0 -or !(Test-Path -LiteralPath $executable)){throw 'In-place candidate reinstall/update failed'}
  if(!(Test-Path -LiteralPath $protocol) -or (Get-Item -LiteralPath $protocol).GetValue('') -ne $command){throw 'Update removed or changed the existing OAuth callback'}
  $result.oauth_protocol_preserved_on_update=$true
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
  $result.owned_callback_removed=$true
  # A second installation must not remove an association owned by a different
  # install, including a sibling path that shares this installation's prefix.
  $again=Start-Process -FilePath $installer -ArgumentList @('/S','/currentuser',"/D=$install") -Wait -PassThru -WindowStyle Hidden
  if($again.ExitCode -ne 0 -or !(Test-Path -LiteralPath $executable)){throw 'Second isolated installation failed'}
  $foreignCommand='"'+$install+'-other\NextBrowser.exe" "%1"'
  New-Item -Path $protocol -Force | Out-Null
  Set-Item -LiteralPath $protocol -Value $foreignCommand
  $againRemoved=Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if($againRemoved.ExitCode -ne 0){throw 'Second uninstaller failed'}
  $deadline=(Get-Date).AddSeconds(45)
  while((Test-Path -LiteralPath $executable) -and (Get-Date) -lt $deadline){Start-Sleep -Seconds 1}
  if(Test-Path -LiteralPath $executable){throw 'Second uninstaller left its executable'}
  if(!(Test-Path -LiteralPath $protocol) -or (Get-Item -LiteralPath $protocol).GetValue('') -ne $foreignCommand){throw 'Uninstaller modified a callback owned by another installation'}
  $result.foreign_callback_preserved=$true
  $result.status='passed'
}catch{
  $result.status='failed';$result.error=$_.Exception.Message
  throw
}finally{
  $result | ConvertTo-Json -Depth 6 | Set-Content "$qa/installer-verification.json" -Encoding utf8NoBOM
  Stop-Transcript
}
