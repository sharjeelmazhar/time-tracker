// The application doubles as a small D-Bus service: the Quick Settings tile starts and
// stops the timer through it, so the app process is the only one that touches the data.
// It is D-Bus activated, stays alive in the background while a timer runs, and exits a
// few seconds after the window is closed when nothing is running.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {APP_ID, SRC_DIR} from './config.js';
import {AboutDialog, PreferencesDialog} from './dialogs.js';
import {HEARTBEAT_SECONDS, Store} from './store.js';
import {fmtTime, startOfDay} from './util.js';
import {Window} from './window.js';

const EXTENSION_UUID = 'time-tracker@sharjeelmazhar.github.io';
const IDLE_MS = 20000;
const BACKUP_NAME = 'timetracker-backup.json';

const TIMER_IFACE = `
<node>
  <interface name="${APP_ID}.Timer">
    <method name="GetState"><arg type="s" direction="out" name="state"/></method>
    <method name="Toggle"/>
    <method name="Start"><arg type="s" direction="in" name="project_id"/></method>
    <method name="Stop"/>
    <signal name="Changed"><arg type="s" name="state"/></signal>
  </interface>
</node>`;

// The pink wash: the window background is tinted with the system accent colour, so it
// matches the Quick Settings tile whatever accent is picked in Settings ▸ Appearance.
// Light mode starts from pure white, which keeps the tint a clean blush instead of a grey-pink.
const tint = (base, amount) => `:root {
    --window-bg-color: color-mix(in srgb, var(--accent-bg-color) ${amount}%, ${base});
    --dialog-bg-color: color-mix(in srgb, var(--accent-bg-color) ${amount}%, ${base});
}`;
const TINT_LIGHT = tint('#ffffff', 9);
const TINT_DARK = tint('#222226', 7);

export const Application = GObject.registerClass(
class Application extends Adw.Application {
    constructor() {
        super({applicationId: APP_ID, flags: Gio.ApplicationFlags.DEFAULT_FLAGS});
        this.set_inactivity_timeout(IDLE_MS);
        this._timerService = Gio.DBusExportedObject.wrapJSObject(TIMER_IFACE, this);
        this._held = false;
        this._beatId = 0;
        this._backupId = 0;
        this.backupError = null;
    }

    vfunc_dbus_register(connection, objectPath) {
        if (!super.vfunc_dbus_register(connection, objectPath))
            return false;
        this._timerService.export(connection, objectPath);
        return true;
    }

    vfunc_dbus_unregister(connection, objectPath) {
        this._timerService.unexport_from_connection(connection);
        super.vfunc_dbus_unregister(connection, objectPath);
    }

    vfunc_startup() {
        super.vfunc_startup();

        this.store = new Store();
        this._day = startOfDay();
        this._notifyIfStopped(this.store.reconcile());
        this.store.subscribe(() => this._onStoreChanged());
        this._syncHold();

        this._loadStyles();
        this._addAction('preferences', () => new PreferencesDialog(this.store).present(this.activeWindow));
        this._addAction('about', () => new AboutDialog().present(this.activeWindow));
        this._addAction('quit', () => this.activeWindow?.close(), ['<Control>q']);
        this.set_accels_for_action('win.new-project', ['<Control>n']);
    }

    vfunc_activate() {
        let window = this.activeWindow;
        if (!window) {
            window = new Window(this, this.store);
            this._setupExtension(window);
        }
        window.present();
    }

    _addAction(name, callback, accels = null) {
        const action = new Gio.SimpleAction({name});
        action.connect('activate', callback);
        this.add_action(action);
        if (accels)
            this.set_accels_for_action(`app.${name}`, accels);
    }

    _loadStyles() {
        const display = Gdk.Display.get_default();
        const base = new Gtk.CssProvider();
        base.load_from_path(GLib.build_filenamev([SRC_DIR, 'style.css']));
        Gtk.StyleContext.add_provider_for_display(display, base, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        const colors = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(display, colors, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        const sync = () => colors.load_from_string(this.styleManager.dark ? TINT_DARK : TINT_LIGHT);
        this.styleManager.connect('notify::dark', sync);
        sync();
    }

    // --- timer lifetime ----------------------------------------------------------------

    _onStoreChanged() {
        this._syncHold();
        this._emitChanged();
        this._scheduleBackup();
    }

    // --- backup -----------------------------------------------------------------------

    // Changes come in bursts (typing the currency, stop then start), so wait for a pause.
    _scheduleBackup() {
        if (!this.store.settings.backupFolder || this._backupId)
            return;
        this.hold();
        this._backupId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._backupId = 0;
            this._writeBackup();
            return GLib.SOURCE_REMOVE;
        });
    }

    _writeBackup() {
        const folder = this.store.settings.backupFolder;
        if (!folder) {
            this.release();
            return;
        }
        const file = Gio.File.new_for_uri(folder).get_child(BACKUP_NAME);
        const bytes = new GLib.Bytes(new TextEncoder().encode(this.store.serialize()));
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
            (_file, result) => {
                try {
                    file.replace_contents_finish(result);
                    this.backupError = null;
                } catch (e) {
                    // shown in Preferences, next to the folder
                    this.backupError = e.message;
                    console.warn(`Time Tracker: backup to ${file.get_parse_name()} failed: ${e.message}`);
                }
                this.release();
            });
    }

    _emitChanged() {
        this._timerService.emit_signal('Changed',
            new GLib.Variant('(s)', [JSON.stringify(this.store.snapshot())]));
    }

    // stay alive (and keep the heartbeat going) exactly while a timer is running
    _syncHold() {
        const running = !!this.store.running;
        if (running === this._held)
            return;
        this._held = running;
        if (running) {
            this.hold();
            this._beatId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, HEARTBEAT_SECONDS, () => {
                this._beat();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            GLib.source_remove(this._beatId);
            this._beatId = 0;
            this.release();
        }
    }

    _beat() {
        // after a suspend this fires late, and reconcile() ends the session where it really ended
        this._notifyIfStopped(this.store.reconcile());
        if (this._day !== startOfDay()) {
            this._day = startOfDay();
            this._emitChanged();
        }
    }

    _notifyIfStopped(project) {
        if (!project)
            return;
        const last = this.store.entriesFor(project.id)[0];
        const notification = new Gio.Notification();
        notification.set_title('Timer stopped');
        notification.set_body(last?.end
            ? `“${project.name}” was stopped at ${fmtTime(last.end)}, when the computer went to sleep or shut down.`
            : `“${project.name}” was stopped because the computer went to sleep or shut down.`);
        this.send_notification('timer-stopped', notification);
    }

    // restart the idle countdown, so a burst of tile clicks keeps one process around
    _touch() {
        this.hold();
        this.release();
    }

    // --- D-Bus methods (io.github.sharjeelmazhar.TimeTracker.Timer) ---------------------

    GetState() {
        this._touch();
        return JSON.stringify(this.store.snapshot());
    }

    Toggle() {
        this._touch();
        this.store.toggle();
    }

    Start(projectId) {
        this._touch();
        this.store.start(projectId);
    }

    Stop() {
        this._touch();
        this.store.stop();
    }

    // --- Quick Settings tile -----------------------------------------------------------

    // The tile ships as a GNOME Shell extension. The first time the app is opened, switch
    // it on; the shell only discovers newly installed extensions at login, so say so.
    _setupExtension(window) {
        if (this.store.settings.extensionSetupDone)
            return;
        const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];
        const installed = dirs.some(dir => GLib.file_test(
            GLib.build_filenamev([dir, 'gnome-shell', 'extensions', EXTENSION_UUID, 'metadata.json']),
            GLib.FileTest.EXISTS));
        if (!installed || !Gio.SettingsSchemaSource.get_default().lookup('org.gnome.shell', true))
            return;

        const settings = new Gio.Settings({schemaId: 'org.gnome.shell'});
        const enabled = settings.get_strv('enabled-extensions');
        if (!enabled.includes(EXTENSION_UUID))
            settings.set_strv('enabled-extensions', [...enabled, EXTENSION_UUID]);
        this.store.setSetting('extensionSetupDone', true);

        Gio.DBus.session.call(
            'org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions',
            'org.gnome.Shell.Extensions', 'GetExtensionInfo',
            new GLib.Variant('(s)', [EXTENSION_UUID]), new GLib.VariantType('(a{sv})'),
            Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try {
                    const [info] = connection.call_finish(result).deepUnpack();
                    if (Object.keys(info).length === 0)
                        window.showBanner('Log out and back in to get the Quick Settings tile');
                } catch (e) {
                    console.warn(`Time Tracker: could not query GNOME Shell: ${e.message}`);
                }
            });
    }
});
