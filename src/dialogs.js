import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {APP_ID, AUTHOR, AUTHOR_URL, REPO_URL, SRC_DIR, VERSION} from './config.js';
import {dateHint, fmtDate, fmtTime, nowSec, parseDateTime, systemFormats, timeHint} from './util.js';

// Cancel on the left, the confirming button on the right, like every GNOME form dialog.
function formHeader(dialog, saveLabel) {
    const cancel = new Gtk.Button({label: 'Cancel'});
    cancel.connect('clicked', () => dialog.close());
    const save = new Gtk.Button({label: saveLabel, cssClasses: ['suggested-action']});
    const header = new Adw.HeaderBar({showStartTitleButtons: false, showEndTitleButtons: false});
    header.pack_start(cancel);
    header.pack_end(save);
    return [header, save];
}

function formBody(header, groups) {
    const page = new Adw.PreferencesPage();
    for (const group of groups)
        page.add(group);
    const view = new Adw.ToolbarView({content: page});
    view.add_top_bar(header);
    return view;
}

// Create a project, or edit one when `project` is given.
export const ProjectDialog = GObject.registerClass(
class ProjectDialog extends Adw.Dialog {
    constructor(store, project = null, topic = null) {
        super({title: project ? 'Edit Project' : 'New Project', contentWidth: 440, contentHeight: 540});
        this._store = store;
        this._project = project;
        this._topics = store.topics();

        const [header, save] = formHeader(this, project ? 'Save' : 'Add');
        this._saveButton = save;
        save.connect('clicked', () => this._onSave());

        // The topic comes first, because it is the bigger thing: existing topics, with
        // "New topic…" as the last choice.
        this._topicCombo = new Adw.ComboRow({
            title: 'Topic',
            subtitle: 'Where the work comes from',
            model: Gtk.StringList.new([...this._topics, 'New topic…']),
            visible: this._topics.length > 0,
        });
        this._topicEntry = new Adw.EntryRow({title: 'New topic, like Upwork or Personal'});
        this._topicEntry.connect('entry-activated', () => this._onSave());
        const preset = this._topics.indexOf(project?.topic ?? topic);
        if (preset >= 0)
            this._topicCombo.selected = preset;

        this._name = new Adw.EntryRow({title: 'Project name, like Shopify store redesign', text: project?.name ?? ''});
        this._name.connect('entry-activated', () => this._onSave());

        const about = new Adw.PreferencesGroup({
            description: 'A topic holds your projects: “Upwork” is a topic, and each job you do there is a project inside it.',
        });
        about.add(this._topicCombo);
        about.add(this._topicEntry);
        about.add(this._name);

        this._paid = new Adw.SwitchRow({
            title: 'Paid project',
            subtitle: 'Work out earnings from an hourly rate',
            active: project?.billable ?? false,
        });
        this._rate = new Adw.SpinRow({
            title: `Hourly rate (${store.settings.currency.trim() || 'money'})`,
            adjustment: new Gtk.Adjustment({lower: 0, upper: 1000000, stepIncrement: 1, pageIncrement: 10}),
            digits: 2,
            value: project?.rate ?? 0,
        });
        this._paid.bind_property('active', this._rate, 'visible', GObject.BindingFlags.SYNC_CREATE);

        const money = new Adw.PreferencesGroup();
        money.add(this._paid);
        money.add(this._rate);

        this.set_child(formBody(header, [about, money]));
        this.focusWidget = this._topics.length ? this._name : this._topicEntry;

        this._name.connect('changed', () => this._sync());
        this._topicEntry.connect('changed', () => this._sync());
        this._topicCombo.connect('notify::selected', () => this._sync());
        this._sync();
    }

    get _isNewTopic() {
        return this._topicCombo.selected >= this._topics.length;
    }

    get _topic() {
        return this._isNewTopic ? this._topicEntry.text.trim() : this._topics[this._topicCombo.selected];
    }

    _sync() {
        this._topicEntry.visible = this._isNewTopic;
        this._saveButton.sensitive = this._name.text.trim() !== '' && this._topic !== '';
    }

    _onSave() {
        if (!this._saveButton.sensitive)
            return;
        const fields = {
            name: this._name.text.trim(),
            topic: this._topic,
            billable: this._paid.active,
            rate: this._rate.value,
        };
        if (this._project)
            this._store.updateProject(this._project.id, fields);
        else
            this._store.addProject(fields);
        this.close();
    }
});

// Add time by hand, or correct a session when `entry` is given (the timer was left
// running over lunch, or never started).
export const SessionDialog = GObject.registerClass(
class SessionDialog extends Adw.Dialog {
    constructor(store, projectId, entry = null) {
        super({title: entry ? 'Edit Session' : 'Add Time', contentWidth: 400, contentHeight: entry ? 400 : 310});
        this._store = store;
        this._projectId = projectId;
        this._entry = entry;
        this._isRunning = !!entry && entry.end === null;

        const [header, save] = formHeader(this, entry ? 'Save' : 'Add');
        save.connect('clicked', () => this._onSave());

        const start = entry?.start ?? nowSec() - 3600;
        const end = entry?.end ?? nowSec();
        this._date = new Adw.EntryRow({title: `Date (${dateHint()})`, text: fmtDate(start)});
        this._start = new Adw.EntryRow({title: `Started at (like ${timeHint()})`, text: fmtTime(start)});
        this._end = new Adw.EntryRow({title: `Stopped at (like ${timeHint()})`, text: fmtTime(end), visible: !this._isRunning});
        this._rows = [this._date, this._start, this._end];

        const times = new Adw.PreferencesGroup({
            description: this._isRunning ? 'This session is still running.' : '',
        });
        for (const row of this._rows) {
            row.connect('entry-activated', () => this._onSave());
            row.connect('changed', () => row.remove_css_class('error'));
            times.add(row);
        }
        const groups = [times];

        if (entry) {
            const remove = new Adw.ButtonRow({title: 'Delete Session'});
            remove.add_css_class('destructive-action');
            remove.connect('activated', () => {
                this._store.deleteEntry(entry.id);
                this.close();
            });
            const danger = new Adw.PreferencesGroup();
            danger.add(remove);
            groups.push(danger);
        }

        this.set_child(formBody(header, groups));
        this.focusWidget = this._start;
    }

    _onSave() {
        const start = parseDateTime(this._date.text, this._start.text);
        let end = this._isRunning ? null : parseDateTime(this._date.text, this._end.text);

        const bad = [];
        // 13:00 is a valid time on either clock, so this checks the date alone
        if (parseDateTime(this._date.text, '13:00') === null)
            bad.push(this._date);
        else if (start === null || start > nowSec())
            bad.push(this._start);
        if (!this._isRunning && !bad.includes(this._date)) {
            // stopping "before" starting means the session ran past midnight
            if (end !== null && start !== null && end < start)
                end += 86400;
            if (end === null || end === start || end > nowSec())
                bad.push(this._end);
        }
        if (bad.length) {
            for (const row of bad)
                row.add_css_class('error');
            return;
        }

        if (this._entry)
            this._store.updateEntry(this._entry.id, {start, end});
        else
            this._store.addEntry(this._projectId, start, end);
        this.close();
    }
});

export const PreferencesDialog = GObject.registerClass(
class PreferencesDialog extends Adw.PreferencesDialog {
    constructor(store) {
        super();
        this._store = store;

        const currency = new Adw.EntryRow({title: 'Currency symbol', text: store.settings.currency});
        currency.connect('changed', () => store.setSetting('currency', currency.text));
        const earnings = new Adw.PreferencesGroup({
            title: 'Earnings',
            description: 'Shown in front of amounts on paid projects.',
        });
        earnings.add(currency);

        // each option is [stored value, label]; the subtitle says what "same as system" means now
        const choice = (title, key, systemName, options) => {
            const row = new Adw.ComboRow({
                title,
                subtitle: `System uses ${systemName}`,
                model: Gtk.StringList.new(options.map(([, label]) => label)),
            });
            row.selected = Math.max(0, options.findIndex(([value]) => value === store.settings[key]));
            row.connect('notify::selected', () => store.setSetting(key, options[row.selected][0]));
            return row;
        };
        const system = systemFormats();
        const dates = [['dmy', 'Day/Month/Year'], ['mdy', 'Month/Day/Year'], ['ymd', 'Year-Month-Day']];
        const times = [['12h', '12-hour'], ['24h', '24-hour']];
        const nameOf = (options, value) => options.find(([v]) => v === value)[1];
        const formats = new Adw.PreferencesGroup({title: 'Date and Time'});
        formats.add(choice('Date format', 'dateFormat', nameOf(dates, system.date),
            [['system', 'Same as system'], ...dates]));
        formats.add(choice('Time format', 'timeFormat', nameOf(times, system.time),
            [['system', 'Same as system'], ...times]));

        const flatButton = (iconName, tooltipText, callback) => {
            const button = new Gtk.Button({iconName, tooltipText, valign: Gtk.Align.CENTER, cssClasses: ['flat']});
            button.connect('clicked', callback);
            return button;
        };

        // a copy of the history, rewritten after every change
        this._backupRow = new Adw.ActionRow({title: 'Backup folder', subtitleLines: 2});
        this._forget = flatButton('edit-clear-symbolic', 'Stop Backing Up', () => this._setBackupFolder(''));
        this._backupRow.add_suffix(this._forget);
        this._backupRow.add_suffix(flatButton('folder-open-symbolic', 'Choose Folder', () => this._chooseBackupFolder()));
        const restore = new Adw.ButtonRow({title: 'Restore from a Backup…'});
        restore.connect('activated', () => this._chooseRestoreFile());
        const backup = new Adw.PreferencesGroup({
            title: 'Backup',
            description: 'Keep a copy of your history somewhere that survives a reinstall, such as ' +
                'another drive or a folder that syncs to the cloud. It is updated after every change.',
        });
        backup.add(this._backupRow);
        backup.add(restore);

        const local = new Adw.ActionRow({
            title: 'On this computer',
            subtitle: GLib.path_get_dirname(store.path).replace(GLib.get_home_dir(), '~'),
        });
        local.add_suffix(flatButton('folder-open-symbolic', 'Open Folder', () =>
            new Gtk.FileLauncher({file: Gio.File.new_for_path(store.path)})
                .open_containing_folder(this.get_root(), null, null)));
        backup.add(local);

        const page = new Adw.PreferencesPage();
        page.add(earnings);
        page.add(formats);
        page.add(backup);
        this.add(page);
        this._syncBackupRow();
    }

    _syncBackupRow() {
        const folder = this._store.settings.backupFolder;
        const error = Gio.Application.get_default()?.backupError;
        this._forget.visible = !!folder;
        if (!folder)
            this._backupRow.subtitle = 'Not set';
        else if (error)
            this._backupRow.subtitle = `Could not write the backup: ${error}`;
        else
            this._backupRow.subtitle = Gio.File.new_for_uri(folder).get_parse_name().replace(GLib.get_home_dir(), '~');
    }

    _setBackupFolder(uri) {
        this._store.setSetting('backupFolder', uri);
        this._syncBackupRow();
    }

    _chooseBackupFolder() {
        const chooser = new Gtk.FileDialog({title: 'Choose a Backup Folder'});
        chooser.select_folder(this.get_root(), null, (_chooser, result) => {
            try {
                this._setBackupFolder(chooser.select_folder_finish(result).get_uri());
            } catch {
                // cancelled
            }
        });
    }

    _chooseRestoreFile() {
        const chooser = new Gtk.FileDialog({title: 'Choose a Backup'});
        chooser.open(this.get_root(), null, (_chooser, result) => {
            let text;
            try {
                const [, bytes] = chooser.open_finish(result).load_contents(null);
                text = new TextDecoder().decode(bytes);
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this.add_toast(new Adw.Toast({title: `Could not read the file: ${e.message}`}));
                return;
            }
            this._confirmRestore(text);
        });
    }

    _confirmRestore(text) {
        let summary;
        try {
            summary = this._store.checkBackup(text);
        } catch {
            this.add_toast(new Adw.Toast({title: 'That file is not a Time Tracker backup'}));
            return;
        }
        const dialog = new Adw.AlertDialog({
            heading: 'Replace Your History?',
            body: `The backup has ${summary}. Everything currently in Time Tracker will be replaced by it.`,
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('restore', 'Restore');
        dialog.set_response_appearance('restore', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'restore')
                return;
            this._store.restore(text);
            this.add_toast(new Adw.Toast({title: 'History restored'}));
        });
        dialog.present(this);
    }
});

// Not Adw.AboutDialog: the author's name is a link here, with the GitHub page one click away.
export const AboutDialog = GObject.registerClass(
class AboutDialog extends Adw.Dialog {
    constructor() {
        super({title: 'About Time Tracker', contentWidth: 360});

        const github = new Gtk.Box({spacing: 8});
        github.append(new Gtk.Image({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${SRC_DIR}/icons/github-symbolic.svg`)),
        }));
        github.append(new Gtk.Label({label: 'View on GitHub'}));
        const button = new Gtk.Button({child: github, halign: Gtk.Align.CENTER, marginTop: 18, cssClasses: ['pill']});
        button.connect('clicked', () => new Gtk.UriLauncher({uri: REPO_URL}).launch(this.get_root(), null, null));

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            marginTop: 6, marginBottom: 32, marginStart: 24, marginEnd: 24,
        });
        box.append(new Gtk.Image({iconName: APP_ID, pixelSize: 112, cssClasses: ['icon-dropshadow']}));
        box.append(new Gtk.Label({label: 'Time Tracker', cssClasses: ['title-1'], marginTop: 6}));
        box.append(new Gtk.Label({
            useMarkup: true,
            label: `by <a href="${AUTHOR_URL}">${GLib.markup_escape_text(AUTHOR, -1)}</a>`,
        }));
        box.append(new Gtk.Label({label: `Version ${VERSION}`, cssClasses: ['dim-label', 'caption']}));
        box.append(new Gtk.Label({
            label: 'Track the time you spend on your projects, paid or personal.',
            wrap: true,
            justify: Gtk.Justification.CENTER,
            marginTop: 12,
        }));
        box.append(button);
        box.append(new Gtk.Label({
            label: 'Free software, under the MIT licence',
            cssClasses: ['dim-label', 'caption'],
            marginTop: 12,
        }));

        const view = new Adw.ToolbarView({content: box});
        view.add_top_bar(new Adw.HeaderBar({showTitle: false}));
        this.set_child(view);
    }
});
