// Time Tracker — Quick Settings tile for the Time Tracker app.
// Click the tile to start/stop the timer of the current project; the arrow opens a menu
// with the three most recently used projects. All data stays in the app: the tile only
// talks to it over D-Bus (the app is started on demand and exits again when idle).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const APP_ID = 'io.github.sharjeelmazhar.TimeTracker';
const OBJECT_PATH = '/io/github/sharjeelmazhar/TimeTracker';

const TimerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="${APP_ID}.Timer">
    <method name="GetState"><arg type="s" direction="out" name="state"/></method>
    <method name="Toggle"/>
    <method name="Start"><arg type="s" direction="in" name="project_id"/></method>
    <method name="Stop"/>
    <signal name="Changed"><arg type="s" name="state"/></signal>
  </interface>
</node>`);

const nowSec = () => Math.floor(Date.now() / 1000);
const startOfDay = () => Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
const pad = n => String(n).padStart(2, '0');

// 3725 -> "1:02:05"
function fmtClock(sec) {
    return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}

// 3725 -> "1h 02m"
function fmtDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec / 60) % 60;
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

function openApp() {
    Shell.AppSystem.get_default().lookup_app(`${APP_ID}.desktop`)?.activate();
    Main.overview.hide();
    Main.panel.closeQuickSettings();
}

const TimeTrackerToggle = GObject.registerClass(
class TimeTrackerToggle extends QuickMenuToggle {
    _init(gicon) {
        super._init({
            title: 'Time Tracker',
            gicon,
            toggleMode: false,
            menuButtonAccessibleName: 'Choose a project',
        });

        // state as sent by the app: {running, at, current, todaySeconds, recent, day}
        this._state = null;
        this._tickId = 0;
        this._cancellable = new Gio.Cancellable();

        this.menu.setHeader(gicon, 'Time Tracker', 'Pick a project to start its timer');
        this._projectSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._projectSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Open Time Tracker', () => openApp());

        this.connect('clicked', () => this._onClicked());
        this.connect('destroy', () => this._onDestroy());

        this._proxy = new TimerProxy(Gio.DBus.session, APP_ID, OBJECT_PATH, (_proxy, error) => {
            if (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`Time Tracker: ${error.message}`);
                return;
            }
            this._changedId = this._proxy.connectSignal('Changed',
                (_p, _sender, [state]) => this._setState(state));
            this.refresh();
        }, this._cancellable);

        this._sync();
    }

    // Ask the app for its state. This starts the app in the background if needed; on
    // login that is also what lets it close a session cut short by a shutdown.
    refresh() {
        this._proxy.GetStateRemote((result, error) => {
            if (error)
                console.warn(`Time Tracker: ${error.message}`);
            else
                this._setState(result[0]);
        });
    }

    // The app only changes state when it is running, and then it signals us; the one
    // thing that goes stale on its own is "today" when the date changes.
    refreshIfStale() {
        if (!this._state || this._state.day !== startOfDay())
            this.refresh();
    }

    // Count the seconds only while the menu is on screen.
    setTicking(ticking) {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (!ticking)
            return;
        this._sync();
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setState(json) {
        try {
            this._state = JSON.parse(json);
        } catch (e) {
            console.warn(`Time Tracker: bad state from the app: ${e.message}`);
            return;
        }
        this._syncProjects();
        this._sync();
    }

    _onClicked() {
        if (!this._state?.current) {
            openApp();
            return;
        }
        // show the new state right away; the app's Changed signal confirms it
        this._state.todaySeconds = this._today();
        this._state.at = nowSec();
        this._state.running = !this._state.running;
        this._sync();
        this._proxy.ToggleRemote((_result, error) => {
            if (error) {
                console.warn(`Time Tracker: ${error.message}`);
                this.refresh();
            }
        });
    }

    _syncProjects() {
        this._projectSection.removeAll();
        const {recent, current} = this._state;
        for (const project of recent) {
            const item = new PopupMenu.PopupMenuItem(project.name);
            item.add_child(new St.Label({
                text: project.topic,
                opacity: 150,
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            item.setOrnament(project.id === current?.id
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
            item.connect('activate', () => {
                this._proxy.StartRemote(project.id, (_result, error) => {
                    if (error)
                        console.warn(`Time Tracker: ${error.message}`);
                });
            });
            this._projectSection.addMenuItem(item);
        }
    }

    // seconds worked today on the current project, counting the running session up to now
    _today() {
        const {todaySeconds, running, at} = this._state;
        return todaySeconds + (running ? Math.max(0, nowSec() - at) : 0);
    }

    _sync() {
        const state = this._state;
        if (!state?.current) {
            this.set({
                title: 'Time Tracker',
                subtitle: state ? 'Add a project' : null,
                checked: false,
                menuEnabled: false,
            });
            return;
        }

        const today = this._today();
        let subtitle;
        if (state.running)
            subtitle = fmtClock(today);
        else
            subtitle = today >= 60 ? `${fmtDuration(today)} today` : 'No time today';
        this.set({
            title: state.current.name,
            subtitle,
            checked: state.running,
            menuEnabled: true,
        });
    }

    _onDestroy() {
        this._cancellable.cancel();
        this.setTicking(false);
        if (this._changedId)
            this._proxy.disconnectSignal(this._changedId);
        this._changedId = 0;
    }
});

const TimeTrackerIndicator = GObject.registerClass(
class TimeTrackerIndicator extends SystemIndicator {
    _init(gicon) {
        super._init();
        // a small stopwatch in the top bar while the timer runs
        this._indicator = this._addIndicator();
        this._indicator.gicon = gicon;
        this.toggle = new TimeTrackerToggle(gicon);
        this.toggle.bind_property('checked', this._indicator, 'visible', GObject.BindingFlags.SYNC_CREATE);
        this.quickSettingsItems.push(this.toggle);
    }
});

export default class TimeTrackerExtension extends Extension {
    enable() {
        const gicon = Gio.icon_new_for_string(`${this.path}/icons/time-tracker-symbolic.svg`);
        this._indicator = new TimeTrackerIndicator(gicon);
        const qs = Main.panel.statusArea.quickSettings;
        qs.addExternalIndicator(this._indicator);

        this._menuId = qs.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._indicator.toggle.refreshIfStale();
            this._indicator.toggle.setTicking(open);
        });
    }

    disable() {
        if (this._menuId) {
            Main.panel.statusArea.quickSettings.menu.disconnect(this._menuId);
            this._menuId = null;
        }
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
