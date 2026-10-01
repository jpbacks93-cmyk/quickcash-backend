# ─────────────────────────────────────────────
# Guarantors + KYC API Test
# ─────────────────────────────────────────────

Write-Host "`n=== Logging in ===" -ForegroundColor Cyan
$body = @{ phone = "+256777896176" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/send-otp" -Method Post -ContentType "application/json" -Body $body | Out-Null
$body = @{ phone = "+256777896176"; code = "123456" } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body $body
$token = $login.token
$headers = @{ Authorization = "Bearer $token" }
Write-Host "Logged in" -ForegroundColor Green

# ── Guarantors ────────────────────────────────
Write-Host "`n=== TEST 1: Add Guarantor 1 ===" -ForegroundColor Cyan
$body = @{
    name = "Jane Doe"
    phone = "+256701111111"
    email = "jane@example.com"
    relationship = "Family"
    idNumber = "CM12345678"
} | ConvertTo-Json
$g1 = Invoke-RestMethod -Uri "http://localhost:3000/api/guarantors" -Method Post -ContentType "application/json" -Body $body -Headers $headers
$g1 | ConvertTo-Json -Depth 5
$g1Id = $g1.guarantor.id

Write-Host "`n=== TEST 2: Verify Guarantor 1 with OTP ===" -ForegroundColor Cyan
$body = @{ code = "123456" } | ConvertTo-Json
$verify = Invoke-RestMethod -Uri "http://localhost:3000/api/guarantors/$g1Id/verify" -Method Post -ContentType "application/json" -Body $body -Headers $headers
$verify.guarantor | Select-Object name, status, verifiedAt | Format-List

Write-Host "`n=== TEST 3: Add Guarantor 2 ===" -ForegroundColor Cyan
$body = @{
    name = "Joe Bolic"
    phone = "+256702222222"
    relationship = "Friend"
} | ConvertTo-Json
$g2 = Invoke-RestMethod -Uri "http://localhost:3000/api/guarantors" -Method Post -ContentType "application/json" -Body $body -Headers $headers
Write-Host "Guarantor 2 ID: $($g2.guarantor.id)" -ForegroundColor Green

Write-Host "`n=== TEST 4: List all guarantors ===" -ForegroundColor Cyan
$list = Invoke-RestMethod -Uri "http://localhost:3000/api/guarantors" -Headers $headers
$list.guarantors | Select-Object name, phone, relationship, status | Format-Table -AutoSize

# ── KYC ───────────────────────────────────────
Write-Host "`n=== TEST 5: Submit KYC ===" -ForegroundColor Cyan
$body = @{
    documentType = "National ID"
    frontImageUrl = "https://example.com/front.jpg"
    backImageUrl = "https://example.com/back.jpg"
    selfieUrl = "https://example.com/selfie.jpg"
} | ConvertTo-Json
$kyc = Invoke-RestMethod -Uri "http://localhost:3000/api/kyc/submit" -Method Post -ContentType "application/json" -Body $body -Headers $headers
$kyc | ConvertTo-Json

Write-Host "`n=== TEST 6: Get KYC status ===" -ForegroundColor Cyan
$status = Invoke-RestMethod -Uri "http://localhost:3000/api/kyc" -Headers $headers
$status | ConvertTo-Json -Depth 5

Write-Host "`n=== ALL TESTS DONE ===" -ForegroundColor Green