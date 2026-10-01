# Time Tracker

A project timer for Ubuntu with a Quick Settings tile. Start and stop the timer from the
top-right menu, switch between your three most recent projects from the tile's arrow, and
open the app to see how long you worked and, for paid projects, how much you earned.

- **Topics and projects**: group projects under a topic such as "Upwork" or "Personal".
- **Paid or not**: switch on "Paid project" and set an hourly rate to see earnings; leave
  it off and the project only counts hours.
- **Totals**: today, this week (Monday to Sunday) and this month for the project you are
  on, and an **All projects** page that adds up time and money across everything.
- **Sessions**: every start/stop is listed by day and can be edited, added by hand or deleted.
- **Finish a project** to move it out of the way; reopen it any time.
- **Export** a project's sessions as CSV.
- **Currencies**: a default currency, and a different one for any project that needs it.
  Totals never add different currencies together.
- **Backup**: online in your own GitHub account, or in a folder you pick. Either copy is
  updated after every change.
- **Date and time format**: follows your system by default (12 or 24-hour clock, date
  order), and can be changed in Preferences, for example to Day/Month/Year.
- Follows the system light/dark style and accent colour.

If the computer sleeps or shuts down while a timer is running, the session ends at that
moment rather than counting the hours it was off.

## Install

```sh
wget https://github.com/sharjeelmazhar/time-tracker/releases/latest/download/timetracker.deb
sudo apt install ./timetracker.deb
```

Or download `timetracker.deb` from the [releases page](https://github.com/sharjeelmazhar/time-tracker/releases)
and open it.

Installing it also adds Time Tracker's own apt repository, so later versions arrive with
the rest of your updates (`sudo apt update && sudo apt upgrade`).

Open **Time Tracker** once from the app grid. That switches the Quick Settings tile on;
GNOME only notices newly installed extensions at login, so log out and back in if the
app asks you to.

Needs Ubuntu 25.04 or newer (GNOME Shell 48+, libadwaita 1.7+). Built and tested on
Ubuntu 26.04 with GNOME Shell 50.

## Build the .deb yourself

```sh
./build-deb.sh          # writes dist/timetracker_<version>_all.deb
```

There is nothing to compile: the app and the tile are plain GJS. Pushing a tag like
`v1.0.0` to GitHub builds the `.deb`, attaches it to a release and publishes it in the apt
repository. The repository is signed with a key whose secret half is the `APT_SIGNING_KEY`
secret of the GitHub repo; the public half is `data/timetracker-archive-keyring.gpg`.

To try the app without installing it, run `./run`.

## Your data

Everything is kept in `~/.local/share/timetracker/data.json`.

To keep your history across a reinstall, set up a backup in Preferences:

- **Online backup** saves it as a secret gist in your GitHub account. Press **Connect…**
  and follow the three steps to make a token that may only touch gists. The token is kept
  in your login keyring. On a new system, connect again with a token and the app offers
  to bring the backup in.
- **Backup folder** writes `timetracker-backup.json` to a folder you choose, such as one on
  another drive. On the new system, use **Restore from a Backup File…**.

Both are copies, not two-way sync: the computer you are working on is always the source.

## How it fits together

| Path | What it is |
| --- | --- |
| `src/` | The libadwaita app. It is also the background service that owns the data. |
| `extension/` | The GNOME Shell extension that provides the Quick Settings tile. |
| `data/` | Desktop entry, D-Bus service file, launcher and icons. |
| `build-deb.sh` | Packages all of the above into a `.deb`. |
| `build-apt-repo.sh` | Builds the signed apt repository that is published on GitHub Pages. |

The tile never touches the data file. It calls the app over D-Bus
(`io.github.sharjeelmazhar.TimeTracker.Timer`: `GetState`, `Toggle`, `Start`, `Stop`, and
a `Changed` signal). The app is started on demand, stays in the background while a timer
runs, and exits a few seconds after it is no longer needed.

## Licence

MIT
