# ─────────────────────────────────────────────
# Loans API Test
# ─────────────────────────────────────────────

# Login
Write-Host "`n=== Logging in ===" -ForegroundColor Cyan
$body = @{ phone = "+256777896176" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/send-otp" -Method Post -ContentType "application/json" -Body $body | Out-Null
$body = @{ phone = "+256777896176"; code = "123456" } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body $body
$token = $login.token
$headers = @{ Authorization = "Bearer $token" }
Write-Host "Logged in as $($login.user.phone)" -ForegroundColor Green

# TEST 1: Apply for a loan
Write-Host "`n=== TEST 1: Apply for loan ===" -ForegroundColor Cyan
$body = @{
  amount = 100
  durationDays = 30
  purpose = "Business"
} | ConvertTo-Json
try {
  $apply = Invoke-RestMethod -Uri "http://localhost:3000/api/loans/apply" -Method Post -ContentType "application/json" -Body $body -Headers $headers
  $apply | ConvertTo-Json -Depth 5
  $loanId = $apply.loan.id
} catch {
  Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
  # Try to get existing loan
  $loans = Invoke-RestMethod -Uri "http://localhost:3000/api/loans" -Headers $headers
  if ($loans.loans.Count -gt 0) {
    $loanId = $loans.loans[0].id
  }
}

# TEST 2: List loans
Write-Host "`n=== TEST 2: List my loans ===" -ForegroundColor Cyan
$list = Invoke-RestMethod -Uri "http://localhost:3000/api/loans" -Headers $headers
$list.loans | Select-Object id, amount, totalDue, status, progress | Format-Table -AutoSize

# TEST 3: Auto-approve (dev only)
if ($loanId) {
  Write-Host "`n=== TEST 3: Auto-approve loan ===" -ForegroundColor Cyan
  try {
    $approve = Invoke-RestMethod -Uri "http://localhost:3000/api/loans/$loanId/approve" -Method Post -Headers $headers
    Write-Host "Status: $($approve.loan.status)" -ForegroundColor Green
  } catch {
    Write-Host "Error: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
  }

  # TEST 4: Make a repayment
  Write-Host "`n=== TEST 4: Repay $50 ===" -ForegroundColor Cyan
  $body = @{ amount = 50; method = "MTN_MOMO"; reference = "TEST-001" } | ConvertTo-Json
  try {
    $repay = Invoke-RestMethod -Uri "http://localhost:3000/api/loans/$loanId/repay" -Method Post -ContentType "application/json" -Body $body -Headers $headers
    $repay | ConvertTo-Json -Depth 5
  } catch {
    Write-Host "Error: $($_.ErrorDetails.Message)" -ForegroundColor Red
  }
}

Write-Host "`n=== ALL LOAN TESTS DONE ===" -ForegroundColor Green