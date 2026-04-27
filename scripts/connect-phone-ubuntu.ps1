param(
  [Parameter(Mandatory = $true)]
  [string] $AdbSerial,

  [int] $LocalPort = 2222,
  [int] $RemotePort = 2222,
  [string] $User = "operit",
  [string] $KeyPath = "$env:USERPROFILE\.ssh\operit_phone_ed25519"
)

$ErrorActionPreference = "Stop"

adb connect $AdbSerial | Write-Output
adb -s $AdbSerial forward "tcp:$LocalPort" "tcp:$RemotePort" | Write-Output
adb -s $AdbSerial forward --list | Write-Output

ssh -i $KeyPath `
  -o IdentitiesOnly=yes `
  -o StrictHostKeyChecking=accept-new `
  -o ConnectTimeout=10 `
  "$User@127.0.0.1" `
  -p $LocalPort
