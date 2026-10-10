# Installing the Wellsure Agent

This is for whoever sets up the small program that copies new punches from the
attendance machine to the HR system. You do not need to be a developer. Take it
one step at a time. If you get stuck, stop and phone whoever is supporting you:
nothing here can damage the machine, so stopping halfway is always safe.

It takes about 20 minutes.

---

## What this program is, and what it will never do

The attendance machine keeps a list of every punch. The **Wellsure Agent** sits on
one PC in the office, looks at that list every 30 seconds, and sends any new
punches to the HR system so they show up on screen within a minute, instead of
at month end.

**The agent only ever *reads* the machine. It cannot change, clear, pause or
disrupt it.**

- It cannot delete punches, clear the machine's memory, change its clock, add or
  remove people, or switch it off or "pause" it. People keep punching exactly as
  before, and greytHR keeps reading the machine as before.
- This is not just a promise. The program does not contain any instruction that
  changes the machine. It can send only a short fixed list of "tell me" requests
  (what is your serial number, how many punches do you hold, what time is it,
  give me the punches). The program refuses to send anything else, and the
  automated tests fail if it ever tried.
- If you are ever worried, **stopping the agent is instant and changes nothing
  on the machine** (see "Everyday things" below).

The agent runs as its own account on the PC, which can do nothing else. It starts
by itself whenever the PC starts, and starts itself again if it ever stops.

---

## Before you start: have these ready

**The PC**

- A Windows 10, Windows 11 or Windows Server PC that is **switched on all the
  time** (a PC that is off or asleep reads nothing). A spare office PC is fine.
- It must be on the **same network as the attendance machine**, and be able to
  reach the internet.
- You must be able to open it **as an administrator** (your own login may already
  be one; if Windows asks for an administrator's password, you need that person).

**From the person who supports you** (they will send these; the key is secret, so
send it by a private message, not an email to many people. Menu names on the
machine vary a little by model; your supporter can talk you through them):

| What | Where it comes from | Example |
|---|---|---|
| The zip file | They send it | `wellsure-agent-0.2.0-windows-x64.zip` |
| The HR system's address | They tell you | `https://hr.example.com` |
| The **agent key** | In the app: *Admin Tools → Devices → Sync agents → Add agent*. It is **shown only once** | `wsa_…` (a long string) |
| The machine's **serial number** | Printed on the machine, or in *Admin Tools → Devices* | `AEXY225060969` |
| The machine's **IP address** | On the machine: *Menu → Comm (or Network) → IP Address* | `192.168.29.213` |
| The machine's **comm key** | On the machine: *Menu → Comm → Comm Key* ("connection password"). **0 or blank means none** | `0` |

---

## Install, step by step

### 1. Unzip it

Right-click the zip file → **Extract All…** → Extract. Do not run anything from
inside the zip itself. You should end up with a folder called something like
`wellsure-agent-0.2.0` containing files such as `install.ps1`, `wellsure-agent.exe`
and `nssm.exe`.

### 2. Open PowerShell as an administrator

Click **Start**, type `PowerShell`, right-click **Windows PowerShell**, choose
**Run as administrator**, and click **Yes**. A blue (or black) window opens. The
title bar should say **Administrator**. *(If it doesn't, the install will stop
and tell you so.)*

### 3. Go to the folder

Type `cd ` (the letters c, d and a space), then **drag the unzipped folder from
File Explorer into the blue window** (that types its address for you), and press
**Enter**.

### 4. Allow the installer to run, for this window only

Type this and press Enter:

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Windows may ask "Do you want to change the execution policy?" — type `Y` and
press Enter. *What this does:* it lets this one window run the installer. It is
forgotten as soon as you close the window; it changes nothing permanent.

Then type this and press Enter (it removes the "downloaded from the internet"
mark so Windows doesn't block the files):

```
Get-ChildItem -Recurse | Unblock-File
```

### 5. Run the installer

```
.\install.ps1
```

It will ask you questions. Type the answer and press Enter each time.

| It asks | What to give it |
|---|---|
| **The HR system's address** | e.g. `https://hr.example.com` — it must start with `https://` |
| **The agent key** | Paste it. **You will not see anything appear as you paste or type — that is normal** (it is hidden so nobody can read it over your shoulder). Press Enter |
| **Device serial number** | The serial from the table above |
| **Device IP address** | The IP address from the table above |
| **Device connection password / "comm key"** | The comm key. Press Enter on its own if it is 0 or blank. Hidden, like the key |
| **Another device? (y/N)** | `N` and Enter, unless there is a second machine on this network |

Then it works through eight steps by itself and prints a line for each, with
**OK** (good) or **!!** (worth reading). It looks at the machine, creates the
account, installs and starts the program, and then **waits up to two minutes to
prove it works**.

| Step | What it does | Why |
|---|---|---|
| 1 | Checks your answers; tries to reach the machine | Catches a typo now |
| 2 | Creates a locked-down account and a private data folder | The agent runs as that account, not as you |
| 3 | Copies the program into `C:\Program Files\Wellsure Agent` | |
| 4 | Saves the settings; locks the key away in Windows' own password store | The key is never left in a file |
| 5 | Sets the program to start with the PC and restart if it stops | So nobody has to remember it |
| 6 | Registers with the Windows event log | So events can be looked up later |
| 7 | Warns if the PC is set to go to sleep | A sleeping PC reads nothing |
| 8 | Starts it and checks it is really working | So "installed" really means "working" |

### 6. Read the last lines

- **`WORKING.`** in green — done. Go to "How to tell it is working" and do the
  quick check in the app.
- **`INSTALLED, BUT NOT WORKING YET.`** in yellow — it is installed, but something
  needs fixing. The lines just above it say what. Go to "If something is not
  right" below, find the matching line, and follow it. You do not need to
  install again from the start.
- **A red message** — read it; it says what to fix. Then run `.\install.ps1`
  again. It is safe to run as often as you like.

Close the window when you are done.

---

## How to tell it is working

**1. On the PC.** In an administrator PowerShell window, type:

```
& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" status
```

When all is well it looks like this, ending in **WORKING.**

```
Wellsure Agent 0.2.0 on OFFICE-PC
The agent is running (process 4120, since 2026-10-12 09:01:12 UTC).
The server last answered it 12 s ago.

Device AEXY225060969 (C-10 entrance) at 192.168.29.213:
  This device is being read normally.
  Last read 14 s ago.
  Nothing waiting to be sent.
  The device's clock is 2 s ahead (set it from the device's own menu if it is more than a couple of minutes out).

No punches have been refused by the server.

WORKING.
```

If the last line is **NEEDS ATTENTION**, the lines above say which part.

**2. In the app.** Sign in and open **Admin Tools → Devices**. The device should show:

- **Agent says: Read OK**, with a "last read" time within the last minute;
- **Clock: exact** (or a few seconds), not minutes;
- no red or orange warning banner at the top.

**3. With a real punch.** Ask someone to punch on the machine. Within about a
minute it appears on that person's **Attendance Info** page. That is the whole
point, and the best test.

**4. Windows itself** (optional). *Services* (Start → type `Services`) lists
**Wellsure Agent** as *Running*, startup type *Automatic (Delayed Start)*. *Event
Viewer → Windows Logs → Application* shows an entry from source
**WellsureAgent**, "Wellsure Agent … started".

---

## If something is not right

Run `status` (above) first: its last lines name the problem. Find it here.

| What you see | Most likely reason | What to do |
|---|---|---|
| *"This must be run as an administrator"* | PowerShell wasn't opened as administrator | Close it; Start → type `PowerShell` → right-click → **Run as administrator** |
| *"running scripts is disabled on this system"* | Step 4 was skipped | Do step 4 in the same window, then run `.\install.ps1` again |
| Windows says **"Windows protected your PC"**, or antivirus removes or blocks `wellsure-agent.exe` | The program is not digitally signed, so some security software is cautious about it | Click **More info → Run anyway** if Windows asks. If antivirus quarantined it, tell your IT person to **allow `C:\Program Files\Wellsure Agent`** (and the unzipped folder), then run `.\install.ps1` again |
| `The agent is NOT running` | The service stopped, or has not started | Type `Start-Service WellsureAgent`, wait a minute, run `status` again. If it stops again: `Get-Content "C:\ProgramData\Wellsure Agent\logs\agent.log" -Tail 50` and read the last lines to your supporter |
| `The server has never answered it` / `has not answered it for …` | A mistake in the HR system's address; no internet from this PC; or the agent key is wrong or was replaced | Check the PC can open the HR system's website in a browser. Check the address in `C:\ProgramData\Wellsure Agent\config.json` (starts with `https://`, no spaces). If the key may be wrong or was rotated in the app, run `.\set-key.ps1` and paste the **newest** key |
| `cannot be reached over the network` | The machine is off; its IP address has changed or was typed wrongly; it is on a different network; or something is blocking the connection | Check the machine is on and shows the network is connected. Check its IP address on its own menu. From this PC: `Test-NetConnection 192.168.29.213 -Port 4370` (use the real address) — it should say `TcpTestSucceeded : True`. If the address is wrong, run `.\install.ps1` again with the right one |
| `is a different machine from the one in config.json` | The IP address belongs to a different machine, or the serial was typed wrongly | Check the serial against the machine and the IP against that machine. Run `.\install.ps1` again with the right pair. **Nothing is read from a machine whose serial doesn't match** — that protects against sending one branch's punches under another |
| `refused the connection password (the comm key)` | The comm key is wrong | Run `.\install.ps1` again and give the right comm key |
| `is not assigned to this agent in the app` | In the app, the device isn't set to use this agent | *Admin Tools → Devices → Edit* the device: *Route* = **Sync agent**, and choose this agent |
| A warning that the **device clock is wrong** (in the app, or "clock is 12 min ahead" in `status`) | The machine's own clock has drifted. Every punch is recorded with the wrong time until it is fixed | Set it **on the machine itself**: *Menu → System (or Date/Time) → Date & Time*. The agent never changes the clock (see "Setting the machine's clock" below) |
| `N batch(es) of punches the server refused are set aside` | The server would not accept some punches, as they stood. They are **kept safely on this PC**, not in attendance yet | See "Punches the server refused" below |
| A warning that the device **has not been read for a while**, or **punches are at risk** | The PC was off, asleep, or off the network for a long time. The machine only remembers punches for a few days | Switch the PC on / fix the network. Run `status`. The agent catches up by itself. If this happens often, check the PC's sleep setting (below) |
| Step 7 said the **PC is set to sleep** | A sleeping PC reads nothing | *Settings → System → Power → Screen and sleep*: set "When plugged in, put my device to sleep after" to **Never** |
| *"These files are not what the release was built with"* (the install stops before changing anything) | The zip was damaged on the way (a bad download or copy), or a file in it was changed | **Do not install from that folder, and do not download or swap in any file yourself, `nssm.exe` above all.** Ask your supporter for a fresh copy of the zip and unzip that |
| Installed, but still not working after two minutes, and nothing above fits | — | Run `status` and `Get-Content "C:\ProgramData\Wellsure Agent\logs\agent.log" -Tail 100`, and read both to your supporter (or send them as text). Nothing is wrong that cannot be fixed from there |

---

## Everyday things

Open PowerShell **as administrator** for all of these.

| To… | Type |
|---|---|
| **See if it is working** | `& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" status` |
| **Stop it** (instant; changes nothing on the machine; punches are not lost — they wait on the machine and are picked up when it starts again) | `Stop-Service WellsureAgent` |
| **Start it again** | `Start-Service WellsureAgent` |
| **Restart it** | `Restart-Service WellsureAgent` |
| **Change the machine's IP address, or add a second machine** | In the unzipped folder: `.\install.ps1` (it keeps what you don't change; press Enter at the key prompt to keep the stored key) |
| **Give it a new agent key** (after *Rotate key* in the app — the old key stops working immediately) | In the unzipped folder: `.\set-key.ps1`, then paste the new key |
| **Upgrade** | Unzip the new version into a **new** folder, open PowerShell as administrator there, and run `.\upgrade.ps1`. It keeps your settings and any waiting punches, and puts the old version back by itself if the new one doesn't work |
| **Uninstall** | In the unzipped folder: `.\uninstall.ps1`. It removes the service, the program and the account, and keeps `C:\ProgramData\Wellsure Agent` (settings, log, any punches not yet sent). Add `-RemoveData` to delete that folder too. It warns first if punches haven't been sent yet |
| **Move to a new PC** | Install on the new PC as above, then uninstall on the old one. Nothing is lost: the new agent re-reads the machine and the HR system ignores any punch it already has |

### Punches the server refused

Very rarely, the HR system refuses a batch of punches *as it stands* (for
example, the batch is malformed). The agent never throws those away: it sets them
aside on this PC and HR sees a red warning in the app until someone deals with
them. To deal with them, in an administrator PowerShell:

1. **See what is there and why:**
   `& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" quarantine`
2. **Write them out as files the HR system can import:**
   `& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" quarantine --export C:\Temp\punches`
   Then, in the app: *Import Center → Punches (ATTLOG)*, choose the device, and
   upload each file in `C:\Temp\punches`. The import shows line by line what it
   accepts and what it rejects, and why.
3. **Once that is done:**
   `& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" quarantine --done`
   This moves them to a `handled` folder (still not deleted) and the warning
   clears by itself within a minute.

If you are unsure, stop after step 1 and read it to your supporter.

### Setting the machine's clock by hand

The agent only reads the time off the machine and warns HR if it is wrong; it
never sets it. If the app or `status` says the clock is wrong, set it **on the
machine**: *Menu → System (or Date/Time) → Date & Time*, set the correct date and
time, and save. The exact menu names vary by model. Within a minute or two the
warning clears by itself. Punches already recorded keep the time they were
recorded with; tell HR the period it was wrong, so they can review it.

---

## What the warnings in the app mean

On *Admin Home* and *Admin Tools → Devices*:

| Warning | Meaning |
|---|---|
| **Device clock is wrong** | The machine's clock is off by more than two minutes. Set it on the machine. |
| **Device not read for a while** | The agent hasn't read this machine for over half of the time the machine can remember. Check the PC. |
| **Punches at risk of being overwritten** | The same, past three quarters. Act today. |
| **Device log nearly full** | The machine's memory of punches is 90% full. When full it either overwrites the oldest or stops recording, depending on its setting. |
| **Punches the server refused are waiting** | See "Punches the server refused" above. |

---

## Reference

**Where things are**

| What | Where |
|---|---|
| The program | `C:\Program Files\Wellsure Agent\` |
| Settings (no passwords) | `C:\ProgramData\Wellsure Agent\config.json` |
| The log | `C:\ProgramData\Wellsure Agent\logs\agent.log` (rotated at 10 MB; the newest ten kept) |
| Punches waiting to be sent | `C:\ProgramData\Wellsure Agent\outbox\` (empty when all is well) |
| Punches the server refused | `C:\ProgramData\Wellsure Agent\outbox-rejected\` |
| The account it runs as | `WellsureAgentSvc` (no other use; open only to administrators) |
| Where the key and comm key are kept | Windows Credential Manager, under that account. Never in a file |

**About `nssm.exe`.** It is the small program that runs the agent as a Windows
service. It is **inside the zip**, and `install.ps1` checks every file in the
folder against `SHA256SUMS.txt` before it installs anything. **Never download
NSSM, or any other "service wrapper", yourself, and never replace the copy in
the zip, whatever a website or a search result says.** If `install.ps1` reports a
file that doesn't match, or says `nssm.exe` is missing, stop and ask for a fresh
copy of the zip.

**What it connects to:** the machine on port **4370** (on your network), and the
HR system over **HTTPS** (port 443). It listens for nothing, so no inbound
firewall rule is needed.

**Windows event log** (*Event Viewer → Windows Logs → Application*, source
`WellsureAgent`):

| ID | Meaning |
|---|---|
| 1 / 2 | The agent started / stopped |
| 3 | Installed |
| 10 / 11 / 12 | A machine hasn't been read for a while (warning) / punches at risk (error) / back to normal |
| 20 / 21 | A machine's log is nearly full / back below the mark |
| 30 / 31 | A machine's clock is wrong / right again |
| 40 | A batch of punches was refused by the server and set aside |
| 50 / 51 | The agent key was rejected / accepted again |
| 60 | A password could not be saved to Windows Credential Manager |

---

## For whoever is supporting this by phone

Ask, in this order:

1. "Open PowerShell as administrator and run the `status` command. Read me the
   last line." (`WORKING` — you're done. `NEEDS ATTENTION` — next.)
2. "Read me the line that says what the problem is." Match it to the table above.
3. If it's the server not answering: "Can you open the HR system's website in a
   browser on that PC?" Then: has the key been rotated? (`set-key.ps1`)
4. If it's the machine: "Does the machine show the network connected? What IP
   does it show?" Then: `Test-NetConnection <ip> -Port 4370`.
5. Still stuck: "Read me the last 20 lines of the log."
   `Get-Content "C:\ProgramData\Wellsure Agent\logs\agent.log" -Tail 20`

**Have the release zip ready before the day, not on it.** The zip is built by CI and kept
as a CI artifact for 90 days; keep your own copy of it (and its `SHA256SUMS.txt`) somewhere
you control. **Do not rebuild it on the day.** If it ever has to be rebuilt and `nssm.cc`
(where NSSM is downloaded from, and checked against a pinned hash) is unreachable, **do not
improvise**: use the copy cached from an earlier build, or stop and decide deliberately to
switch to WinSW. Never fetch a service wrapper from anywhere else.

**Connection day only:** run `diagnose` first. If the machine has a comm key,
first type `$env:WELLSURE_COMMKEY_AEXY225060969 = "123456"` (its serial and its comm
key; this lasts only until the window is closed), then
`& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" diagnose`, and note the
machine's log count and capacity, firmware and clock offset. Then, while the agent
does its first full read, have someone punch repeatedly and check **each punch is
accepted at once, with no "busy" or "working…" message**. If reading ever blocks
punching, run `Stop-Service WellsureAgent` straight away (instant; changes nothing
on the machine) and call.
