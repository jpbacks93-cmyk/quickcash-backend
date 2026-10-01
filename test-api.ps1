# ─────────────────────────────────────────────
# QuickCash API Test Script
# ─────────────────────────────────────────────

Write-Host "`n=== TEST 1: Health Check ===" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health"
    $health | ConvertTo-Json
} catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== TEST 2: Send OTP ===" -ForegroundColor Cyan
try {
    $body = @{ phone = "+256777896176" } | ConvertTo-Json
    $otp = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/send-otp" `
        -Method Post -ContentType "application/json" -Body $body
    $otp | ConvertTo-Json
} catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== TEST 3: Verify OTP ===" -ForegroundColor Cyan
try {
    $body = @{ phone = "+256777896176"; code = "123456" } | ConvertTo-Json
    $verify = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/verify-otp" `
        -Method Post -ContentType "application/json" -Body $body
    $verify | ConvertTo-Json -Depth 5
    
    # Save token for later tests
    $global:TOKEN = $verify.token
    Write-Host "`nToken saved for next tests" -ForegroundColor Green
} catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== TEST 4: Set PIN ===" -ForegroundColor Cyan
if ($global:TOKEN) {
    try {
        $body = @{ pin = "1234" } | ConvertTo-Json
        $headers = @{ Authorization = "Bearer $($global:TOKEN)" }
        $setPin = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/set-pin" `
            -Method Post -ContentType "application/json" -Body $body -Headers $headers
        $setPin | ConvertTo-Json
    } catch {
        Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "SKIPPED - no token from Test 3" -ForegroundColor Yellow
}

Write-Host "`n=== ALL TESTS COMPLETE ===" -ForegroundColor Green