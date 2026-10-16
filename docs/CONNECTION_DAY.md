# Connection day: connecting the real attendance machine

> ## Read this first: what the program can and cannot do to the machine
>
> The program that is installed on the office PC (the "agent") **only reads** from the attendance machine. It asks the machine
> a short, fixed list of questions (what is your serial number, how many punches do you hold, what time is it, give me the
> punches) and it cannot send anything else.
>
> - **It cannot change anything on the machine.** It cannot add, edit or remove a person or a fingerprint, face or vein, and it cannot change a setting.
> - **It cannot clear the machine's log.** It cannot delete a punch, and the punches stay on the machine after they are copied.
> - **It cannot alter the machine's clock.** It reads the time and tells HR if it is wrong; setting it right is done by a person, on the machine's own menu.
> - **It cannot stop anyone punching.** It cannot pause, lock or switch off the machine, and people punch exactly as before. greytHR keeps reading the machine as before.
>
> This is not only a promise. The program has no instruction in it that changes the machine, it refuses to send any request that is not on the fixed list, and the automated tests fail if it ever tried. **The one thing that could still go wrong is the machine being slow to answer while it is read, and that is what Step 5 watches for: if punching is ever slow or refused, stop the program (`Stop-Service WellsureAgent`, instant, and it changes nothing on the machine).**
>
> Whoever is standing next to the machine on the day, and whoever approves this, can rely on that.

This is the procedure for the day the attendance machine (the biometric device) is connected to the HR system for the
first time. It is written for **someone standing in the office who is not the person who built the system**. You do not
need to be a developer. You do need to be able to follow steps in order, read what the screen says, and phone someone
when a step does not do what this page says it will.

It has four parts: the rules that keep everyone safe; what must be ready **before** the day; the day itself, step by
step, with what *working* looks like and what to do when it isn't; and what to check afterwards.

Related pages (this one tells you *when*; those tell you *how*):
- [`biometric-agent/INSTALL.md`](../biometric-agent/INSTALL.md): installing, checking, upgrading and removing the small program on the office PC, with a table of every message it can print.
- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md): what the servers need before the real device is connected (the "Phase 1.5 go-live checklist").
- [`docs/plans/PHASE_2.md`](plans/PHASE_2.md) §11: exactly what has been proven with a simulator, and what is taken on faith until today.

---

## Part 0. The rules

1. **Nothing on this page can damage the machine, and nothing you do here should interrupt anyone punching.** The program
   only *reads* the machine. It cannot clear it, change its clock, pause it, add or remove people. greytHR keeps reading
   the machine exactly as before: **greytHR is not switched off today, and nothing here depends on it being off.**
2. **If punching is ever slow, refused, or shows a "busy" or "working…" message on the machine, stop the program at
   once** and phone for help. In an administrator PowerShell window:
   `Stop-Service WellsureAgent`
   Stopping is instant and changes nothing on the machine. Punches made meanwhile are not lost: the machine keeps them
   and the program picks them up when it is started again. Employees must never be the ones to find a problem.
3. **Stopping halfway is always safe.** Every step below can be repeated. If you are unsure, stop at the step you are on,
   write down what the screen said (a photo is fine), and phone.
4. **Never** do any of these, whatever a website, a search result or a helpful colleague says:
   - clear the machine's log or "delete all records" on it, or add or remove people on it;
   - change the machine's clock without telling the person supporting you first (it also affects greytHR);
   - download NSSM or any other "service wrapper" yourself, or replace any file in the zip. The installer checks every
     file against a list and refuses a folder that does not match. If it refuses, ask for a fresh copy of the zip;
   - type the machine's comm key or the agent key into an email, a chat, a document or this repository. They go into the
     installer's hidden prompts only.
5. **Write down what you see** (the table in Step 6). Some of it is unknown until today and decides settings afterwards.

---

## Part 1. Before the day

All of this is done **in advance**, by someone with an HR Admin or Super Admin login and the technical person who has
the release zip. If an item is not ticked, do not start the day: reschedule. A half-ready day wastes the one thing that
cannot be rehearsed, which is the real machine.

### 1.1 The people

| Role | Who | What they do |
|---|---|---|
| **At the office PC** | You | Follows Part 2 |
| **At the machine** | Three volunteers who normally punch there | Punch when asked, in Step 5 and Step 7 |
| **At a computer with the HR system open** | HR Admin (or Super Admin) | Watches the screens in Steps 5–8; knows how to sign in |
| **On the phone** | The person who built the system | Answers anything this page does not |

### 1.2 The checklist

Tick each one. "Ready" is defined so that two different people would agree.

**The HR system (the servers)**
- [ ] The HR system is deployed and **opens in a browser from the office PC over `https://`**. (Open the address on that PC and sign in. This is the one thing the program cannot work around.)
- [ ] The **scheduler and the worker** are both running as their own tasks. Without the scheduler no device alert ever fires and nothing recomputes overnight. (`docs/DEPLOYMENT.md`, Phase 1.5 checklist items 3 and 4.)
- [ ] Email for alerts works (SES verified), or you accept that alerts are on screen only for now. (Checklist item 3.)
- [ ] **ADMS push stays off.** Today uses the sync-agent route only. (Checklist item 1 is for push, which this day does not use.)

**The app's records of the machine (Admin Tools → Devices)**
- [ ] **A sync agent exists:** *Admin Tools → Devices → Sync agents → Add agent*, named after the PC (for example "C-10 office PC"). The key is **shown once**: copy it to a private note now (not to email), because it cannot be shown again. If it is lost, use *Rotate key*.
- [ ] **The device is registered:** *Devices → Add device*: the serial number (`AEXY225060969`, read from the machine's own menu, not from this page), the branch it is at (it must be a branch marked as having a machine), *How punches arrive* = **Sync agent**, the sync agent above, the LAN address, the timezone **Asia/Kolkata (+330)**, and **Simulated switched off**.
- [ ] **"Sync punches from" is set to today's date.** The program never sends a punch dated before this, so the first read does not send the machine's whole history. (It can be moved earlier on purpose later; the system ignores a punch it already has.)
- [ ] The device's log capacity is left at the cautious default (3 days, 20,000 records) until Step 6 tells you the real number.

**The people**
- [ ] **Every person who punches at this machine has their device user ID recorded** on their employee record (*Employee → Attendance capture*: the ID they punch with, set to "Biometric device"). The enrolled IDs on the machine run from 2 to about 126.
  Do **not** guess at an ID: a wrong mapping gives one person another's attendance. The machine's own user list (on its menu) is the source; HR's list of who has which ID is the check.
- [ ] Branches that have **no** machine are marked so (*Organisation Setup*): their people are marked in the muster by hand, as agreed, and the system must not raise "no device" warnings for them.
- [ ] The list on *Admin Tools → Devices* headed "People at branches with a machine but no device user ID" is empty, or you know why each name is on it.

**The rule values** (*Workforce → Attendance → Attendance Settings*)
- [ ] The shifts, the full-day and half-day hours and the grace minutes are HR's confirmed values, not the cautious placeholders. If they are still placeholders, today's punches are still recorded and shown correctly as punches, but days cannot be finalised and the reports warn that they use unconfirmed values. That is acceptable for day one; say so to HR beforehand.

**The office PC**
- [ ] A Windows 10, Windows 11 or Windows Server PC that is **switched on all the time** and set never to sleep, on the same network as the machine (`192.168.29.x`), able to reach the HR system over HTTPS. A spare office PC is fine.
- [ ] You can open PowerShell on it **as an administrator** (you have an administrator's login, or the administrator is present).
- [ ] If the PC has antivirus or application-control software, the IT person knows the program is **not digitally signed** and has said they will allow `C:\Program Files\Wellsure Agent`.

**The release**
- [ ] **The zip was built before the day and you have your own copy** of it, with its `SHA256SUMS.txt`, somewhere you control (a USB stick is fine). **Do not rebuild it on the day.** If a rebuild is ever needed and `nssm.cc` cannot be reached, do not improvise: use the copy cached from an earlier build, or stop and decide with the builder whether to switch to another service wrapper.
- [ ] You have the secrets on a private note, to be typed only into the installer's hidden prompts: **the agent key** (above), and **the machine's comm key** (on the machine: *Menu → Comm → Comm Key*; 0 or blank means none).

**greytHR, for the comparison**
- [ ] Someone can open greytHR's view of today's punches for this machine, to compare against in Step 8. greytHR stays on.

---

## Part 2. The day, step by step

Each step says what to do, **what working looks like**, and **what to do if it doesn't**. Do not skip ahead: each step proves something the next one relies on.

### Step 1. Can the PC see the HR system and the machine?

On the office PC:
1. Open a browser and go to the HR system's address. Sign in with any login. **Working:** the home page appears.
2. Open PowerShell (a normal one will do for this) and type, using the machine's real address:
   `Test-NetConnection 192.168.29.213 -Port 4370`
   **Working:** the result says `TcpTestSucceeded : True`.

| If | Then |
|---|---|
| The HR system will not open | Not a machine problem. Check this PC's internet and any proxy or firewall; ask IT. **Stop here: do not continue.** |
| `TcpTestSucceeded : False` | The machine is off, its address is not what you were told, the PC is on a different network, or something blocks port 4370. Check the machine shows "network connected" and read its IP from its own menu (*Menu → Comm → IP Address*). If the address is different, use the real one from here on, and tell the builder. **Do not continue until this says True.** |

### Step 2. Unzip the release

Copy the zip to the PC, right-click it → **Extract All…**. Do not run anything from inside the zip. **Working:** a folder such as `wellsure-agent-0.2.0` containing `install.ps1`, `wellsure-agent.exe` and `nssm.exe`.

If Windows says "Windows protected your PC" or antivirus removes a file: see the table in `INSTALL.md` ("If something is not right"). It is the unsigned program, and the IT person's allow-rule is the fix.

### Step 3. Open PowerShell as an administrator, in that folder

Start → type `PowerShell` → right-click → **Run as administrator** → Yes. The title bar must say **Administrator**. Then type `cd ` (with the space), drag the unzipped folder into the window, press Enter. Then:

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
Get-ChildItem -Recurse | Unblock-File
```

(The first lasts only for this window.) **Working:** no red text.

### Step 4. A look at the machine before installing anything (recommended)

This reads the machine once and prints what it says. It installs nothing and sends nothing to the HR system. Make a file called `C:\Temp\config-check.json` with Notepad (create the `C:\Temp` folder if it is not there; keep this file **out of** the unzipped folder), containing exactly this (using the real address and serial; the HR system's address is only a placeholder here, and `"secrets": "env"` makes this one-off read take the comm key from this window rather than from Windows):

```
{ "apiUrl": "https://the-hr-system-address", "pollSeconds": 30, "secrets": "env", "devices": [ { "serial": "AEXY225060969", "host": "192.168.29.213", "port": 4370 } ] }
```

If the machine has a comm key (not 0), set it for this window only (using the serial, and the comm key in place of 123456):
`$env:WELLSURE_COMMKEY_AEXY225060969 = "123456"`

Then:
`.\wellsure-agent.exe diagnose --config C:\Temp\config-check.json`

**Working:** it prints the machine's serial (matching), its firmware, how many punches it holds, its capacity if it reports one, and its clock, and ends without an error. **Write these down (Step 6).**

| If it says | Then |
|---|---|
| it cannot be reached | Go back to Step 1. |
| the comm key was refused | The comm key is wrong. Re-read it from the machine's menu. |
| a different serial | The address belongs to another machine. Do not install; tell the builder. |
| something about the protocol, a timeout or an unexpected reply | **Stop and phone.** This is the one place a code change might still be needed (the machine's firmware may speak the protocol slightly differently from the documentation). Send them the whole text. Nothing has been installed and nothing has changed. |

Close the PowerShell window afterwards (this also forgets the comm key from the window), delete `C:\Temp\config-check.json`, and open a fresh administrator PowerShell in the unzipped folder again (as in Step 3) for Step 5.

### Step 5. Install, with people ready to punch

**Before pressing Enter on the installer:** the three volunteers are at the machine and the HR Admin has *Workforce → Attendance → Who Is In?* open, and one volunteer's own *Attendance Info* page open on their phone or a computer.

Run `.\install.ps1` and answer its questions as `INSTALL.md` describes (the HR system's address, the agent key, the serial, the IP, the comm key). The key and comm key are hidden as you type; that is normal.

The moment the installer reaches its last step (it starts the program, which begins its **first full read of the machine**, the slowest one), **have the volunteers punch, one after another, repeatedly, for about five minutes**, and watch their faces, not the screen:

- **Working:** every punch is accepted at once, with the machine's usual beep and message. Nobody sees "busy", "working…" or a delay.
- **Not working:** any punch is slow, refused or shows a busy message. **Run `Stop-Service WellsureAgent` straight away and phone.** (Rule 2. This is the failure employees would notice immediately.)

The installer ends with **`WORKING.`** in green (it waits up to two minutes to prove it). If it ends **`INSTALLED, BUT NOT WORKING YET.`**, the lines above say what; find them in `INSTALL.md` and fix that one thing: you do not start again.

### Step 6. Write down what the machine told you

Fill this in (a photo of a notebook is fine) and send it to the builder. They decide the device's settings from it.

| What | From | Your note |
|---|---|---|
| The machine's **model name** | The label on the unit, or *Menu → System Info* | |
| **Firmware version** | `diagnose` | |
| **Punches the machine holds now** | `diagnose` | |
| **Its log capacity**, and whether it overwrites the oldest when full, or stops | `diagnose` if it reports it, otherwise *Menu → System → Data Mgt / Storage* | |
| **Its clock** versus the real time | `diagnose` / `status` ("n s ahead") | |
| **How long the first read took** | The agent log: `Get-Content "C:\ProgramData\Wellsure Agent\logs\agent.log" -Tail 40` | |
| The PC's **Windows version**, and whether antivirus said anything | The PC | |

If the capacity is known, the HR Admin sets it on the device (*Admin Tools → Devices → Edit*: "Log holds about (days)" and "(records)"). **If the program is ever off for longer than the machine can hold, punches are lost: it is the one real data-loss risk.** Until the capacity is known the system warns at half and alarms at three quarters of a pessimistic three days.

### Step 7. Does a punch reach the screen? (the whole point)

Ask a volunteer to punch **once**, and note the time.

**Working:** within **about 30 to 35 seconds** (the program looks at the machine every 30 seconds) the punch appears:
- on that person's **Attendance Info** page, for today, without refreshing the page;
- on *Who Is In?* for HR;
- in *Workforce → Attendance → Employee Swipes*, with the device's name, the person's ID and the time exactly as the machine recorded it.

(The "within 5 seconds" figure belongs to the push route, which is not used today. About half a minute on this route was accepted in advance: the difference that matters is the same day instead of month end.)

| If the punch… | Then |
|---|---|
| …does not appear after two minutes, and *Employee Swipes* does not show it either | On the PC run `& "C:\Program Files\Wellsure Agent\wellsure-agent.exe" status` and read the last line (`WORKING` or `NEEDS ATTENTION`) and the line that names the problem. Match it in `INSTALL.md`. |
| …is in *Employee Swipes* but under "matching nobody" (the *unmapped* filter) | The person's device user ID is not recorded, or recorded wrongly. Not a program fault: *Admin Tools → Devices → Unmapped*, or *Workforce → Attendance → Attendance Exception → Unmapped device IDs*, map it to the right person. Their earlier punches fill in and the day is worked out again. |
| …is in *Employee Swipes* under the right person but the screen shows nothing | Check *Attendance Info* is on today, and that the person's attendance capture is "Biometric device". Then ask the builder: this is the real-time link, which was proven on the simulator. |
| …shows a **time that is wrong** by minutes or hours | The machine's clock is wrong, or its timezone is not +330. Do **not** change the machine yet: tell the builder, who will say whether to set it. A punch flagged "implausible" waits for HR's decision, it is never silently trusted. |

### Step 8. Watch the first hour, then compare with greytHR

For the first hour (the HR Admin, while you stay near the PC):
1. *Admin Tools → Devices* shows the device **Read OK**, "last read" within the last minute, **Clock: exact** or a few seconds, and no red or orange banner. The *Incidents* tab has nothing open.
2. The agent log shows no repeated read timeouts or retried chunks: `Get-Content "C:\ProgramData\Wellsure Agent\logs\agent.log" -Tail 50`. A few are normal at the first full read; **repeated ones mean the machine is slow to serve its log**, and the poll interval or chunk size is the setting to change: tell the builder.
3. Ask people to keep punching as they arrive and leave. Nobody should notice anything.

Then, before relying on any of it, **compare a morning's punches with greytHR's view of the same machine**: *Employee Swipes* for the morning (with *Export to Excel* if you want a file) next to greytHR's. The same people, the same times, the same count. Differences are information, not alarms: note each one (who, what time, which side shows it).

**Today is not the day to finalise anything, switch anything off, or correct anything in bulk.** greytHR stays the record until HR and the builder have agreed it has earned the right to be.

---

## Part 3. If you have to stop

You can always back out, completely, without touching the machine or greytHR:

1. `Stop-Service WellsureAgent` (instant).
2. If it is to be removed: in the unzipped folder, `.\uninstall.ps1`. It keeps `C:\ProgramData\Wellsure Agent` (settings, log, any punches not yet sent) unless you add `-RemoveData`.
3. Punches already received stay in the HR system (they can never be edited or deleted, by design) and are shown in *Employee Swipes*. They do no harm: no one's pay depends on them yet.
4. The machine and greytHR carry on exactly as before.

To start again later, run the installer again; it is safe to run as often as you like.

---

## Part 4. The next day, and the first week

**The next morning** (HR Admin):
- *Workforce → Attendance → Attendance Muster* for yesterday: the people who punched show a status; nobody who punched is missing. The overnight recompute (02:00) ran: if yesterday's days are still "provisional", ask the builder whether the scheduler is running.
- *Workforce → Attendance → Attendance Exception*: the counts. **Unmapped device IDs** should be near zero after the first day: each one is someone whose ID is not recorded, or a visitor or test punch. **Clock-flagged** should be zero. **Missing punch** is expected for people who forgot, and is what *Regularizations* is for.
- *Admin Tools → Devices → Incidents*: nothing open, and the notices (bell and email) did not fire in the night.

**Through the first week:**
- Compare each day with greytHR. Write each difference down.
- Watch the **Volume** tab on *Devices*: punches per day by route should look like a normal working week. A gap during working hours is a silent device or a silent program, and the system should already have raised an incident for it.
- Leave greytHR running. Payroll runs in parallel for two or three months before cut-over; attendance and leave go first.

**Then** the open questions in `docs/PROGRESS.md` that today's findings answer (the device model, whether it supports push, its capacity) can be closed, and the settings that follow from them made.

---

## What today does and does not prove

Proven before today, on the simulator and in tests: everything from the moment a punch reaches the HR system (parsing, duplicates, mapping, the rules, manual entry, corrections, overrides, finalisation, the reports, the screens, the alerts, real-time updates), and the program's own logic (cursor, outbox, backoff, the Windows service on a clean machine).

**Proven only today, and what this page is for:** that the real machine speaks the protocol the way the driver expects; that reading it never disturbs punching; its real log capacity and clock behaviour; whether it supports push; the office PC and network (antivirus, firewall, sleep, reboot, the uplink); and the real time from a punch to the screen. The full list, with how each is contained, is `docs/plans/PHASE_2.md` §11.
