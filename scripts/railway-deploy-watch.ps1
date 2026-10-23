# Railway deploy-then-verify loop, tolerant of transient network errors.
# Breaks when the api production deployment list top entry is a SUCCESS whose
# commitHash is ANY hash newer than the baseline 469d6dc...  (i.e. the pause
# lifted and a fresh deploy carrying the b977766 normalizer + later commits
# exists).
$deadline = (Get-Date).AddMinutes(90)
$BASE = '469d6dcc9a6f9ee3885a892ac099f40d94465a56'
Write-Output ("start " + (Get-Date -Format o))
while ((Get-Date) -lt $deadline) {
  $list = try { railway deployment list --service api --json 2>$null | Out-String } catch { "" }
  $top = ""
  $deplId = ""
  try {
    $a = $list | ConvertFrom-Json
    if ($a.Count -gt 0) { $top = ("{0} {1}" -f $a[0].status, $a[0].meta.commitHash); $deplId = $a[0].id }
  } catch { $top = "parse-fail" }
  if ($top -like "SUCCESS*" -and -not ($top -match [regex]::Escape($BASE))) {
    Write-Output ("DEPLOYED new baseline observed: " + $top + " id=" + $deplId)
    exit 0
  }
  # attempt a from-source redeploy to catch the earliest possible moment
  $null = railway deployment redeploy --service api --environment production --from-source --yes 2>&1
  # check again right away, then sleep
  $list2 = try { railway deployment list --service api --json 2>$null | Out-String } catch { "" }
  $top2 = ""
  try {
    $a2 = $list2 | ConvertFrom-Json
    if ($a2.Count -gt 0) { $top2 = ("{0} {1}" -f $a2[0].status, $a2[0].meta.commitHash) }
  } catch { $top2 = "parse-fail" }
  Write-Output ("tick " + (Get-Date -Format HH:mm:ss) + " top=" + $top2)
  if ($top2 -like "SUCCESS*" -and -not ($top2 -match [regex]::Escape($BASE))) {
    Write-Output ("DEPLOYED new baseline observed: " + $top2)
    exit 0
  }
  Start-Sleep -Seconds 90
}
Write-Output "STILL NOT DEPLOYED after 90 minutes"
exit 1
