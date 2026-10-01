import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {earned, fmtDuration, fmtMoney, fmtWork, startOfDay, startOfMonth, startOfWeek} from './util.js';

const PERIODS = [
    {name: 'today', label: 'Today', since: startOfDay},
    {name: 'week', label: 'Week', since: startOfWeek},
    {name: 'month', label: 'Month', since: startOfMonth},
    {name: 'all', label: 'All time', since: () => 0},
];

// Everything added up: time and money across all projects, for a chosen period.
export const OverviewPage = GObject.registerClass(
class OverviewPage extends Adw.NavigationPage {
    constructor(store) {
        super({title: 'All Projects'});
        this._store = store;

        this._period = new Adw.ToggleGroup({halign: Gtk.Align.CENTER, cssClasses: ['round']});
        for (const {name, label} of PERIODS)
            this._period.add(new Adw.Toggle({name, label}));
        this._period.activeName = 'month';
        this._period.connect('notify::active', () => this.refresh());

        this._time = new Gtk.Label({cssClasses: ['timer-display']});
        this._money = new Gtk.Label({cssClasses: ['title-4', 'accent']});
        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            cssClasses: ['card', 'timer-card'],
        });
        card.append(new Gtk.Label({label: 'All projects', cssClasses: ['caption-heading', 'dim-label']}));
        card.append(this._time);
        card.append(this._money);

        this._groups = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24});
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 24,
            marginTop: 12, marginBottom: 32, marginStart: 12, marginEnd: 12,
        });
        content.append(this._period);
        content.append(card);
        content.append(this._groups);

        const view = new Adw.ToolbarView({
            content: new Gtk.ScrolledWindow({
                hscrollbarPolicy: Gtk.PolicyType.NEVER,
                child: new Adw.Clamp({maximumSize: 560, child: content}),
            }),
        });
        view.add_top_bar(new Adw.HeaderBar());
        this.set_child(view);

        this.refresh();
    }

    get _since() {
        return PERIODS.find(p => p.name === this._period.activeName).since();
    }

    // "3h 20m", plus " · $90.00" when any of the projects is paid
    _sum(projects) {
        const store = this._store;
        const seconds = projects.reduce((sum, p) => sum + store.seconds(p.id, this._since), 0);
        if (!projects.some(p => p.billable))
            return fmtDuration(seconds);
        const money = projects
            .filter(p => p.billable)
            .reduce((sum, p) => sum + earned(store.seconds(p.id, this._since), p.rate), 0);
        return `${fmtDuration(seconds)} · ${fmtMoney(money, store.settings.currency)}`;
    }

    refresh() {
        const store = this._store;
        const runningId = store.running?.projectId;
        let child;
        while ((child = this._groups.get_first_child()))
            this._groups.remove(child);
        // labels that move while the timer runs
        this._updaters = [];

        for (const topic of store.topics()) {
            const projects = store.projects.filter(p => p.topic === topic &&
                (p.id === runningId || store.seconds(p.id, this._since) > 0));
            if (!projects.length)
                continue;

            const total = new Gtk.Label({cssClasses: ['dim-label', 'numeric']});
            this._updaters.push(() => (total.label = this._sum(projects)));
            const group = new Adw.PreferencesGroup({title: GLib.markup_escape_text(topic, -1), headerSuffix: total});
            for (const project of projects) {
                const amount = new Gtk.Label({cssClasses: ['numeric']});
                this._updaters.push(() => (amount.label =
                    fmtWork(store.seconds(project.id, this._since), project, store.settings.currency)));
                const row = new Adw.ActionRow({
                    title: project.name,
                    subtitle: project.finished ? 'Finished' : '',
                    useMarkup: false,
                });
                row.add_suffix(amount);
                group.add(row);
            }
            this._groups.append(group);
        }

        if (!this._groups.get_first_child()) {
            this._groups.append(new Gtk.Label({
                label: 'No time tracked in this period',
                cssClasses: ['dim-label'],
                marginTop: 12,
            }));
        }

        this.tick();
        return true;
    }

    tick() {
        const store = this._store;
        this._time.label = fmtDuration(store.seconds(null, this._since));
        this._money.visible = store.projects.some(p => p.billable);
        this._money.label = `${fmtMoney(store.money(this._since), store.settings.currency)} earned`;
        for (const update of this._updaters)
            update();
    }
});
