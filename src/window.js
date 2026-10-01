import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

import {ProjectDialog} from './dialogs.js';
import {OverviewPage} from './overviewPage.js';
import {ProjectPage} from './projectPage.js';
import {earned, fmtClock, fmtDuration, fmtEarnings, fmtMoney, startOfDay, startOfMonth, startOfWeek, fmtWork} from './util.js';

const TICK_MS = 500;

// The first page: the timer and recent totals of the current project, then every project by topic.
const HomePage = GObject.registerClass(
class HomePage extends Adw.NavigationPage {
    constructor(store, openProject, openOverview) {
        super({title: 'Time Tracker', tag: 'home'});
        this._store = store;
        this._openProject = openProject;

        const menu = new Gio.Menu();
        menu.append('Preferences', 'app.preferences');
        menu.append('About Time Tracker', 'app.about');

        const header = new Adw.HeaderBar();
        header.pack_start(new Gtk.Button({
            iconName: 'list-add-symbolic',
            tooltipText: 'New Project',
            actionName: 'win.new-project',
        }));
        header.pack_end(new Gtk.MenuButton({
            iconName: 'open-menu-symbolic',
            tooltipText: 'Main Menu',
            primary: true,
            menuModel: menu,
        }));

        this._banner = new Adw.Banner({buttonLabel: 'Dismiss'});
        this._banner.connect('button-clicked', () => (this._banner.revealed = false));

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 24,
            marginTop: 12, marginBottom: 32, marginStart: 12, marginEnd: 12,
        });
        content.append(this._buildTimerCard());
        content.append(this._buildStats());

        // the way to the totals across all projects
        this._overviewRow = new Adw.ActionRow({title: 'All projects', activatable: true});
        this._overviewRow.add_suffix(new Gtk.Image({iconName: 'go-next-symbolic', cssClasses: ['dim-label']}));
        this._overviewRow.connect('activated', () => openOverview());
        const overview = new Adw.PreferencesGroup();
        overview.add(this._overviewRow);
        content.append(overview);
        this._groups = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24});
        content.append(this._groups);

        const newProject = new Gtk.Button({
            label: 'New Project',
            halign: Gtk.Align.CENTER,
            actionName: 'win.new-project',
            cssClasses: ['pill', 'suggested-action'],
        });
        this._stack = new Gtk.Stack();
        this._stack.add_named(new Adw.StatusPage({
            iconName: 'io.github.sharjeelmazhar.TimeTracker-symbolic',
            title: 'Track Your Time',
            description: 'Add a project, then start the timer here or from the Quick Settings tile.',
            child: newProject,
        }), 'empty');
        this._stack.add_named(new Gtk.ScrolledWindow({
            hscrollbarPolicy: Gtk.PolicyType.NEVER,
            child: new Adw.Clamp({maximumSize: 560, child: content}),
        }), 'content');

        const view = new Adw.ToolbarView({content: this._stack});
        view.add_top_bar(header);
        view.add_top_bar(this._banner);
        this.set_child(view);

        this.refresh();
    }

    showBanner(title) {
        this._banner.set({title, revealed: true});
    }

    _buildTimerCard() {
        this._timerTopic = new Gtk.Label({cssClasses: ['caption-heading', 'dim-label']});
        this._timerName = new Gtk.Label({cssClasses: ['title-3'], ellipsize: Pango.EllipsizeMode.END});
        this._timerClock = new Gtk.Label({cssClasses: ['timer-display']});
        this._timerButtonContent = new Adw.ButtonContent();
        this._timerButton = new Gtk.Button({
            child: this._timerButtonContent,
            halign: Gtk.Align.CENTER,
            marginTop: 12,
            cssClasses: ['pill'],
        });
        this._timerButton.connect('clicked', () => this._store.toggle());

        this._timerCard = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            cssClasses: ['card', 'timer-card'],
        });
        this._timerCard.append(this._timerTopic);
        this._timerCard.append(this._timerName);
        this._timerCard.append(this._timerClock);
        this._timerCard.append(new Gtk.Label({label: 'today', cssClasses: ['caption', 'dim-label']}));
        this._timerCard.append(this._timerButton);
        return this._timerCard;
    }

    _buildStats() {
        const box = new Gtk.Box({spacing: 12, homogeneous: true});
        this._stats = [
            ['Today', startOfDay],
            ['This week', startOfWeek],
            ['This month', startOfMonth],
        ].map(([title, since]) => {
            const time = new Gtk.Label({cssClasses: ['stat-value']});
            const money = new Gtk.Label({cssClasses: ['caption', 'accent']});
            const card = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2,
                cssClasses: ['card', 'stat'],
            });
            card.append(new Gtk.Label({label: title, cssClasses: ['caption', 'dim-label']}));
            card.append(time);
            card.append(money);
            box.append(card);
            return {since, time, money};
        });
        return box;
    }

    _projectRow(project) {
        const store = this._store;
        const isRunning = store.running?.projectId === project.id;
        const row = new Adw.ActionRow({title: project.name, useMarkup: false, activatable: true});
        row.connect('activated', () => this._openProject(project.id));

        if (!project.finished) {
            const button = new Gtk.Button({
                iconName: isRunning ? 'media-playback-stop-symbolic' : 'media-playback-start-symbolic',
                tooltipText: isRunning ? 'Stop Timer' : 'Start Timer',
                valign: Gtk.Align.CENTER,
                cssClasses: ['circular', isRunning ? 'suggested-action' : 'flat'],
            });
            button.connect('clicked', () => (isRunning ? store.stop() : store.start(project.id)));
            row.add_suffix(button);
        }
        row.add_suffix(new Gtk.Image({iconName: 'go-next-symbolic', cssClasses: ['dim-label']}));

        const update = () => (row.subtitle = fmtWork(store.seconds(project.id), project, store.currencyOf(project)));
        update();
        if (isRunning)
            this._updateRunningRow = update;
        return row;
    }

    // Rebuild everything that depends on the data.
    refresh() {
        const store = this._store;
        this._stack.visibleChildName = store.projects.length ? 'content' : 'empty';

        const current = store.currentProject;
        const isRunning = !!store.running;
        this._timerTopic.label = current?.topic ?? '';
        this._timerName.label = current?.name ?? 'No active project';
        this._timerButton.sensitive = !!current;
        this._timerButtonContent.set({
            iconName: isRunning ? 'media-playback-stop-symbolic' : 'media-playback-start-symbolic',
            label: isRunning ? 'Stop' : 'Start',
        });
        if (isRunning) {
            this._timerCard.add_css_class('running');
            this._timerButton.remove_css_class('suggested-action');
        } else {
            this._timerCard.remove_css_class('running');
            this._timerButton.add_css_class('suggested-action');
        }

        let child;
        while ((child = this._groups.get_first_child()))
            this._groups.remove(child);
        this._updateRunningRow = null;

        const active = store.recentProjects();
        for (const topic of store.topics()) {
            const projects = active.filter(p => p.topic === topic);
            if (!projects.length)
                continue;
            const add = new Gtk.Button({
                iconName: 'list-add-symbolic',
                tooltipText: `New Project in ${topic}`,
                valign: Gtk.Align.CENTER,
                cssClasses: ['flat'],
            });
            add.connect('clicked', () => new ProjectDialog(store, null, topic).present(this.get_root()));
            const group = new Adw.PreferencesGroup({title: GLib.markup_escape_text(topic, -1), headerSuffix: add});
            for (const project of projects)
                group.add(this._projectRow(project));
            this._groups.append(group);
        }

        const finished = store.projects.filter(p => p.finished);
        if (finished.length) {
            const expander = new Adw.ExpanderRow({
                title: 'Finished',
                subtitle: finished.length === 1 ? '1 project' : `${finished.length} projects`,
            });
            for (const project of finished)
                expander.add_row(this._projectRow(project));
            const group = new Adw.PreferencesGroup();
            group.add(expander);
            this._groups.append(group);
        }

        this.tick();
    }

    // Update only the numbers that move while the timer runs.
    tick() {
        const store = this._store;
        const current = store.currentProject;
        this._timerClock.label = fmtClock(current ? store.seconds(current.id, startOfDay()) : 0);
        // the three boxes are about the current project only; "All projects" adds everything up
        for (const {since, time, money} of this._stats) {
            const seconds = current ? store.seconds(current.id, since()) : 0;
            time.label = fmtDuration(seconds);
            money.visible = !!current?.billable;
            if (current?.billable)
                money.label = fmtMoney(earned(seconds, current.rate), store.currencyOf(current));
        }
        const everything = fmtDuration(store.seconds());
        this._overviewRow.subtitle = store.projects.some(p => p.billable)
            ? `${everything} · ${fmtEarnings(store.earnings(), store.settings.currency)} in total`
            : `${everything} in total`;
        this._updateRunningRow?.();
    }
});

export const Window = GObject.registerClass(
class Window extends Adw.ApplicationWindow {
    constructor(app, store) {
        super({
            application: app,
            title: 'Time Tracker',
            defaultWidth: 460, defaultHeight: 780,
            widthRequest: 360, heightRequest: 420,
        });
        this._store = store;

        this._nav = new Adw.NavigationView();
        this._home = new HomePage(store,
            id => this._nav.push(new ProjectPage(store, id)),
            () => this._nav.push(new OverviewPage(store)));
        this._nav.add(this._home);
        this._toasts = new Adw.ToastOverlay({child: this._nav});
        this.set_content(this._toasts);

        const newProject = new Gio.SimpleAction({name: 'new-project'});
        newProject.connect('activate', () => new ProjectDialog(store).present(this));
        this.add_action(newProject);

        this._tickId = 0;
        this._unsubscribe = store.subscribe(() => this._refresh());
        this._syncTick();
        this.connect('close-request', () => {
            this._unsubscribe();
            if (this._tickId)
                GLib.source_remove(this._tickId);
            this._tickId = 0;
            return false;
        });
    }

    showBanner(title) {
        this._home.showBanner(title);
    }

    toast(title) {
        this._toasts.add_toast(new Adw.Toast({title}));
    }

    get _pages() {
        const stack = this._nav.navigationStack;
        return Array.from({length: stack.get_n_items()}, (_, i) => stack.get_item(i));
    }

    _refresh() {
        // a project page whose project was deleted asks to be closed by returning false
        if (this._pages.map(page => page.refresh()).includes(false))
            this._nav.pop_to_page(this._home);
        this._syncTick();
    }

    _syncTick() {
        const running = !!this._store.running;
        if (running && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this._pages.forEach(page => page.tick());
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!running && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }
});
