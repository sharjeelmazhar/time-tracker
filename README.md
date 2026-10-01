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
- **Backup**: pick a folder and a copy of your history is kept there after every change.
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
`v1.0.0` to GitHub builds the `.deb` and attaches it to a release.

To try the app without installing it, run `./run`.

## Your data

Everything is kept in `~/.local/share/timetracker/data.json`.

To keep your history across a reinstall, choose a **Backup folder** in Preferences, on
another drive or in a folder that syncs to the cloud. Time Tracker rewrites
`timetracker-backup.json` there after every change. On the new system, install the app and
use **Preferences ▸ Restore from a Backup…** to load that file.

## How it fits together

| Path | What it is |
| --- | --- |
| `src/` | The libadwaita app. It is also the background service that owns the data. |
| `extension/` | The GNOME Shell extension that provides the Quick Settings tile. |
| `data/` | Desktop entry, D-Bus service file, launcher and icons. |
| `build-deb.sh` | Packages all of the above into a `.deb`. |

The tile never touches the data file. It calls the app over D-Bus
(`io.github.sharjeelmazhar.TimeTracker.Timer`: `GetState`, `Toggle`, `Start`, `Stop`, and
a `Changed` signal). The app is started on demand, stays in the background while a timer
runs, and exits a few seconds after it is no longer needed.

## Licence

MIT
