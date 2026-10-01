# Login first to get a fresh token
Write-Host "`n=== Logging in ===" -ForegroundColor Cyan
$body = @{ phone = "+256777896176" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/send-otp" -Method Post -ContentType "application/json" -Body $body | Out-Null

$body = @{ phone = "+256777896176"; code = "123456" } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body $body
$token = $login.token

Write-Host "`n=== TEST: GET /api/user/me ===" -ForegroundColor Cyan
$headers = @{ Authorization = "Bearer $token" }
$me = Invoke-RestMethod -Uri "http://localhost:3000/api/user/me" -Headers $headers
$me | ConvertTo-Json -Depth 5

Write-Host "`n=== TEST: PUT /api/user/me (update name) ===" -ForegroundColor Cyan
$body = @{ name = "John Doe"; email = "john@example.com" } | ConvertTo-Json
$update = Invoke-RestMethod -Uri "http://localhost:3000/api/user/me" -Method Put -ContentType "application/json" -Body $body -Headers $headers
$update | ConvertTo-Json -Depth 5

Write-Host "`n=== DONE ===" -ForegroundColor Green