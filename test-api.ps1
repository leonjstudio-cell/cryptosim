$body = @{ pseudo = "Admin"; pwd = "12345678" } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "http://localhost:3000/api/register" -Method POST -ContentType "application/json" -Body $body
Write-Host ($result | ConvertTo-Json)
