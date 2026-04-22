$body = @{ pseudo = "Admin"; pwd = "admin123" } | ConvertTo-Json
try {
  $result = Invoke-RestMethod -Uri "http://localhost:3000/api/login" -Method POST -ContentType "application/json" -Body $body
  Write-Host "LOGIN OK:" ($result | ConvertTo-Json)
} catch {
  Write-Host "LOGIN ERREUR:" $_.Exception.Message
}
