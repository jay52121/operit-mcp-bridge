# Phone Ubuntu SSH

This documents the working local control path into the Operit embedded Ubuntu environment.

## Current Path

```text
Local Codex
-> adb wireless debugging
-> adb forward tcp:2222 tcp:2222
-> ssh operit@127.0.0.1 -p 2222
-> Operit Ubuntu
```

This does not expose SSH to the public internet.

## Local Key

Private key:

```text
C:\Users\YZ\.ssh\operit_phone_ed25519
```

Public key installed in phone Ubuntu:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHPwtAt3QGOunRuxTtJFNH6JzuAr75V+HnFGZS/LleNU operit-phone-codex
```

## Phone Ubuntu User

```text
user: operit
home: /home/operit
```

## Start SSHD In Phone Ubuntu

Run this from the phone Operit Ubuntu root terminal after the environment restarts:

```bash
/home/operit/start-sshd.sh
```

The script creates `/run/sshd`, starts `/usr/sbin/sshd` on port `2222`, and writes logs to:

```text
/tmp/sshd.log
```

If needed, the equivalent manual commands are:

```bash
mkdir -p /run/sshd
chmod 755 /run/sshd
pkill sshd 2>/dev/null || true
nohup /usr/sbin/sshd -D -p 2222 -e > /tmp/sshd.log 2>&1 &
cat /tmp/sshd.log
```

## Connect From Windows

After enabling Android wireless debugging, use the current `ip:port` shown by Android:

```powershell
.\scripts\connect-phone-ubuntu.ps1 -AdbSerial "192.168.50.37:43171"
```

Or run the commands manually:

```powershell
adb connect 192.168.50.37:43171
adb -s 192.168.50.37:43171 forward tcp:2222 tcp:2222
ssh -i "$env:USERPROFILE\.ssh\operit_phone_ed25519" -o IdentitiesOnly=yes operit@127.0.0.1 -p 2222
```

## Verified Environment

Last verified:

```text
pwd: /home/operit
whoami: operit
kernel: Linux localhost 6.6.89-android15-8-g97a9aaefab9a-ab14519050-4k aarch64
node: v24.14.1
npm: 11.11.0
python3: Python 3.12.3
VPS health: {"ok":true,"service":"operit-mcp-bridge"}
```

The phone Ubuntu environment can access the production Bridge:

```bash
curl -sS http://35.212.203.107:8787/debug/mcp-info
```
