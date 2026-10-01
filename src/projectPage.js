import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {ProjectDialog, SessionDialog} from './dialogs.js';
import {
    earned, fmtDate, fmtDayLabel, fmtDuration, fmtMoney, fmtTime, fmtWork, nowSec,
    startOfDay, startOfMonth, startOfWeek
} from './util.js';

// how many sessions are listed before "Show All Sessions" is needed
const SESSIONS_SHOWN = 60;

const csvField = value => `"${String(value).replaceAll('"', '""')}"`;

// Everything about one project: totals, earnings and every session, editable.
export const ProjectPage = GObject.registerClass(
class ProjectPage extends Adw.NavigationPage {
    constructor(store, projectId) {
        super({title: store.getProject(projectId)?.name ?? ''});
        this._store = store;
        this._id = projectId;
        this._showAll = false;

        const actions = new Gio.SimpleActionGroup();
        for (const [name, callback] of [
            ['edit', () => new ProjectDialog(store, this._project).present(this)],
            ['add-time', () => new SessionDialog(store, this._id).present(this)],
            ['export', () => this._export()],
            ['toggle-finished', () => store.updateProject(this._id, {finished: !this._project.finished})],
            ['delete', () => this._confirmDelete()],
        ]) {
            const action = new Gio.SimpleAction({name});
            action.connect('activate', callback);
            actions.add_action(action);
        }
        this.insert_action_group('project', actions);

        this._menuButton = new Gtk.MenuButton({iconName: 'view-more-symbolic', tooltipText: 'Project Menu'});
        const header = new Adw.HeaderBar();
        header.pack_end(this._menuButton);

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 24,
            marginTop: 12, marginBottom: 32, marginStart: 12, marginEnd: 12,
        });
        content.append(this._buildTotalCard());
        content.append(this._buildSummary());
        this._sessions = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24});
        content.append(this._sessions);

        const view = new Adw.ToolbarView({
            content: new Gtk.ScrolledWindow({
                hscrollbarPolicy: Gtk.PolicyType.NEVER,
                child: new Adw.Clamp({maximumSize: 560, child: content}),
            }),
        });
        view.add_top_bar(header);
        this.set_child(view);

        this.refresh();
    }

    get _project() {
        return this._store.getProject(this._id);
    }

    _buildTotalCard() {
        this._topic = new Gtk.Label({cssClasses: ['caption-heading', 'dim-label']});
        this._total = new Gtk.Label({cssClasses: ['timer-display']});
        this._earned = new Gtk.Label({cssClasses: ['title-4', 'accent']});
        this._rate = new Gtk.Label({cssClasses: ['caption', 'dim-label']});
        this._buttonContent = new Adw.ButtonContent();
        this._button = new Gtk.Button({
            child: this._buttonContent,
            halign: Gtk.Align.CENTER,
            marginTop: 12,
            cssClasses: ['pill'],
        });
        this._button.connect('clicked', () => {
            if (this._isRunning)
                this._store.stop();
            else
                this._store.start(this._id);
        });

        this._card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            cssClasses: ['card', 'timer-card'],
        });
        for (const widget of [this._topic, this._total, this._earned, this._rate, this._button])
            this._card.append(widget);
        return this._card;
    }

    _buildSummary() {
        const group = new Adw.PreferencesGroup();
        this._periods = [
            ['Today', startOfDay],
            ['This week', startOfWeek],
            ['This month', startOfMonth],
        ].map(([title, since]) => {
            const label = new Gtk.Label({cssClasses: ['numeric']});
            const row = new Adw.ActionRow({title});
            row.add_suffix(label);
            group.add(row);
            return {since, label};
        });
        return group;
    }

    get _isRunning() {
        return this._store.running?.projectId === this._id;
    }

    // Returns false when the project no longer exists and the page should close.
    refresh() {
        const store = this._store;
        const project = this._project;
        if (!project)
            return false;

        this.title = project.name;
        this._topic.label = project.finished ? `${project.topic} · Finished` : project.topic;
        this._earned.visible = this._rate.visible = project.billable;
        this._rate.label = `${fmtMoney(project.rate, store.currencyOf(project))} per hour`;
        this._button.visible = !project.finished;
        this._buttonContent.set({
            iconName: this._isRunning ? 'media-playback-stop-symbolic' : 'media-playback-start-symbolic',
            label: this._isRunning ? 'Stop' : 'Start',
        });
        if (this._isRunning) {
            this._card.add_css_class('running');
            this._button.remove_css_class('suggested-action');
        } else {
            this._card.remove_css_class('running');
            this._button.add_css_class('suggested-action');
        }

        const menu = new Gio.Menu();
        const edit = new Gio.Menu();
        edit.append('Edit Project', 'project.edit');
        edit.append('Add Time…', 'project.add-time');
        edit.append('Export as CSV…', 'project.export');
        const state = new Gio.Menu();
        state.append(project.finished ? 'Reopen Project' : 'Mark as Finished', 'project.toggle-finished');
        state.append('Delete Project…', 'project.delete');
        menu.append_section(null, edit);
        menu.append_section(null, state);
        this._menuButton.menuModel = menu;

        this._rebuildSessions();
        this.tick();
        return true;
    }

    _rebuildSessions() {
        const store = this._store;
        let child;
        while ((child = this._sessions.get_first_child()))
            this._sessions.remove(child);
        this._updateRunningSession = null;

        const all = store.entriesFor(this._id);
        if (!all.length) {
            this._sessions.append(new Gtk.Label({
                label: 'No time tracked yet',
                cssClasses: ['dim-label'],
                marginTop: 12,
            }));
            return;
        }

        const shown = this._showAll ? all : all.slice(0, SESSIONS_SHOWN);
        const days = new Map();
        for (const entry of shown) {
            const day = startOfDay(new Date(entry.start * 1000));
            if (!days.has(day))
                days.set(day, []);
            days.get(day).push(entry);
        }

        const length = entry => (entry.end ?? nowSec()) - entry.start;
        for (const [day, entries] of days) {
            const dayTotal = new Gtk.Label({cssClasses: ['dim-label', 'numeric']});
            const group = new Adw.PreferencesGroup({title: fmtDayLabel(day), headerSuffix: dayTotal});
            const updateDay = () => (dayTotal.label = fmtDuration(entries.reduce((sum, e) => sum + length(e), 0)));
            updateDay();

            for (const entry of entries) {
                const duration = new Gtk.Label({cssClasses: ['numeric']});
                const row = new Adw.ActionRow({
                    title: `${fmtTime(entry.start)} – ${entry.end ? fmtTime(entry.end) : 'now'}`,
                    activatable: true,
                    tooltipText: 'Edit Session',
                });
                row.add_suffix(duration);
                row.add_suffix(new Gtk.Image({iconName: 'document-edit-symbolic', cssClasses: ['dim-label']}));
                row.connect('activated', () => new SessionDialog(store, this._id, entry).present(this));
                group.add(row);

                const update = () => (duration.label = fmtDuration(length(entry)));
                update();
                if (entry.end === null) {
                    row.add_css_class('running-session');
                    this._updateRunningSession = () => {
                        update();
                        updateDay();
                    };
                }
            }
            this._sessions.append(group);
        }

        if (all.length > shown.length) {
            const more = new Adw.ButtonRow({title: `Show All ${all.length} Sessions`});
            more.connect('activated', () => {
                this._showAll = true;
                this._rebuildSessions();
            });
            const group = new Adw.PreferencesGroup();
            group.add(more);
            this._sessions.append(group);
        }
    }

    // Update only the numbers that move while the timer runs.
    tick() {
        const store = this._store;
        const project = this._project;
        if (!project)
            return;
        const total = store.seconds(this._id);
        this._total.label = fmtDuration(total);
        this._earned.label = `${fmtMoney(earned(total, project.rate), store.currencyOf(project))} earned`;
        for (const {since, label} of this._periods)
            label.label = fmtWork(store.seconds(this._id, since()), project, store.currencyOf(project));
        this._updateRunningSession?.();
    }

    _confirmDelete() {
        const dialog = new Adw.AlertDialog({
            heading: 'Delete Project?',
            body: `“${this._project.name}” and all of its tracked time will be permanently deleted.`,
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('delete', 'Delete');
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'delete')
                this._store.deleteProject(this._id);
        });
        dialog.present(this);
    }

    _export() {
        const store = this._store;
        const project = this._project;
        const header = ['Date', 'Started', 'Stopped', 'Hours'];
        if (project.billable)
            header.push(`Amount (${store.currencyOf(project).trim()})`);
        const lines = [header.map(csvField).join(',')];
        for (const entry of store.entriesFor(this._id).reverse()) {
            const sec = (entry.end ?? nowSec()) - entry.start;
            const fields = [fmtDate(entry.start), fmtTime(entry.start), fmtTime(entry.end ?? nowSec()), (sec / 3600).toFixed(2)];
            if (project.billable)
                fields.push(earned(sec, project.rate).toFixed(2));
            lines.push(fields.map(csvField).join(','));
        }

        const chooser = new Gtk.FileDialog({title: 'Export as CSV', initialName: `${project.name}.csv`});
        chooser.save(this.get_root(), null, (_chooser, result) => {
            let file;
            try {
                file = chooser.save_finish(result);
            } catch {
                return; // cancelled
            }
            try {
                file.replace_contents(new TextEncoder().encode(`${lines.join('\n')}\n`),
                    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this.get_root().toast(`Exported to ${file.get_basename()}`);
            } catch (e) {
                this.get_root().toast(`Could not export: ${e.message}`);
            }
        });
    }
});
