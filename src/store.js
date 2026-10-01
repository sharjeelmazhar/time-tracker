// All data lives in one JSON file: ~/.local/share/timetracker/data.json
// The app process is the only writer; the Quick Settings tile goes through D-Bus.

import GLib from 'gi://GLib';

import {nowSec, startOfDay} from './util.js';

const VERSION = 1;
// If the app was not alive for this long while a timer was running, the computer was
// off or asleep: the session is ended at the last moment we know it was awake.
export const HEARTBEAT_SECONDS = 30;
const STALE_SECONDS = 150;

const emptyData = () => ({
    version: VERSION,
    settings: {
        currency: '$', timeFormat: 'system', dateFormat: 'system',
        extensionSetupDone: false, backupFolder: '', gistId: '',
    },
    currentProjectId: null,
    projects: [],
    entries: [],
});

export class Store {
    constructor(dir = null) {
        this._dir = dir ?? GLib.getenv('TIMETRACKER_DATA_DIR') ??
            GLib.build_filenamev([GLib.get_user_data_dir(), 'timetracker']);
        this._path = GLib.build_filenamev([this._dir, 'data.json']);
        this._heartbeatPath = GLib.build_filenamev([this._dir, 'heartbeat']);
        this._listeners = new Set();
        this._load();
    }

    get path() {
        return this._path;
    }

    // --- persistence -------------------------------------------------------------------

    _load() {
        GLib.mkdir_with_parents(this._dir, 0o700);
        this.data = emptyData();
        if (!GLib.file_test(this._path, GLib.FileTest.EXISTS))
            return;
        try {
            const [, bytes] = GLib.file_get_contents(this._path);
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            this.data = {...emptyData(), ...parsed, settings: {...emptyData().settings, ...parsed.settings}};
            // the file was readable: keep it as the backup of the last good state
            GLib.file_set_contents(`${this._path}.bak`, bytes);
        } catch (e) {
            // never overwrite a file we could not read
            const aside = `${this._path}.unreadable-${nowSec()}`;
            GLib.rename(this._path, aside);
            console.error(`Time Tracker: could not read ${this._path} (${e.message}); moved to ${aside}`);
        }
    }

    // --- backup -----------------------------------------------------------------------

    serialize() {
        return JSON.stringify(this.data, null, 1);
    }

    // Throws unless `text` is a backup; returns a short description of what is in it.
    checkBackup(text) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.entries))
            throw new Error('not a Time Tracker backup');
        const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        return `${count(parsed.projects.length, 'project')} and ${count(parsed.entries.length, 'session')}`;
    }

    // Replace everything with the contents of a backup.
    restore(text) {
        this.checkBackup(text);
        const parsed = JSON.parse(text);
        // what belongs to this computer rather than to the history stays as it is
        const {extensionSetupDone, backupFolder, gistId} = this.data.settings;
        this.data = {
            ...emptyData(), ...parsed,
            settings: {...emptyData().settings, ...parsed.settings, extensionSetupDone, backupFolder, gistId},
        };
        // a timer that was running when the backup was written is not running here
        this.data.entries = this.data.entries.filter(e => e.end !== null);
        this._changed();
    }

    _save() {
        // file_set_contents writes a temp file and renames it, so a crash cannot truncate the data
        GLib.file_set_contents(this._path, this.serialize());
    }

    _changed() {
        this._save();
        for (const cb of this._listeners)
            cb();
    }

    subscribe(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    // --- settings ----------------------------------------------------------------------

    get settings() {
        return this.data.settings;
    }

    setSetting(key, value) {
        if (this.data.settings[key] === value)
            return;
        this.data.settings[key] = value;
        this._changed();
    }

    // --- projects ----------------------------------------------------------------------

    get projects() {
        return this.data.projects;
    }

    getProject(id) {
        return this.data.projects.find(p => p.id === id) ?? null;
    }

    // topic names in use, alphabetically
    topics() {
        return [...new Set(this.data.projects.map(p => p.topic))]
            .sort((a, b) => a.localeCompare(b));
    }

    // `currency` is a symbol, or '' to use the default from Preferences
    addProject({name, topic, billable, rate, currency = ''}) {
        const project = {
            id: GLib.uuid_string_random(),
            name, topic, billable, rate, currency,
            finished: false,
            createdAt: nowSec(),
            lastUsed: nowSec(),
        };
        this.data.projects.push(project);
        this.data.currentProjectId ??= project.id;
        this._changed();
        return project;
    }

    updateProject(id, fields) {
        const project = this.getProject(id);
        if (!project)
            return;
        Object.assign(project, fields);
        if (project.finished && this.running?.projectId === id)
            this._stopRunning(nowSec());
        this._changed();
    }

    deleteProject(id) {
        this.data.projects = this.data.projects.filter(p => p.id !== id);
        this.data.entries = this.data.entries.filter(e => e.projectId !== id);
        if (this.data.currentProjectId === id)
            this.data.currentProjectId = null;
        this._changed();
    }

    // unfinished projects, most recently used first
    recentProjects(n = Infinity) {
        const current = this.data.currentProjectId;
        return this.data.projects
            .filter(p => !p.finished)
            .sort((a, b) => b.lastUsed - a.lastUsed || (b.id === current) - (a.id === current))
            .slice(0, n);
    }

    // the project the big button and the tile act on
    get currentProject() {
        const current = this.getProject(this.data.currentProjectId);
        if (current && !current.finished)
            return current;
        return this.recentProjects(1)[0] ?? null;
    }

    // --- timer -------------------------------------------------------------------------

    // the running entry, or null
    get running() {
        return this.data.entries.find(e => e.end === null) ?? null;
    }

    _stopRunning(at) {
        const entry = this.running;
        if (!entry)
            return;
        entry.end = Math.max(at, entry.start);
        // an accidental double click is not a session
        if (entry.end === entry.start)
            this.data.entries = this.data.entries.filter(e => e !== entry);
    }

    start(projectId) {
        const project = this.getProject(projectId);
        if (!project || project.finished || this.running?.projectId === projectId)
            return;
        const now = nowSec();
        this._stopRunning(now);
        this.data.entries.push({id: GLib.uuid_string_random(), projectId, start: now, end: null});
        project.lastUsed = now;
        this.data.currentProjectId = projectId;
        this.heartbeat();
        this._changed();
    }

    stop(at = nowSec()) {
        if (!this.running)
            return;
        this._stopRunning(at);
        this._changed();
    }

    toggle() {
        if (this.running)
            this.stop();
        else if (this.currentProject)
            this.start(this.currentProject.id);
    }

    // --- heartbeat ---------------------------------------------------------------------

    heartbeat() {
        this._lastBeat = nowSec();
        try {
            GLib.file_set_contents(this._heartbeatPath, String(this._lastBeat));
        } catch (e) {
            console.error(`Time Tracker: heartbeat failed: ${e.message}`);
        }
    }

    _readBeat() {
        if (this._lastBeat)
            return this._lastBeat;
        try {
            const [, bytes] = GLib.file_get_contents(this._heartbeatPath);
            return Number(new TextDecoder().decode(bytes)) || 0;
        } catch {
            return 0;
        }
    }

    // Call on startup and on every beat. If a timer is running but nobody was awake to
    // beat, end the session at the last beat. Returns the project that was stopped, if any.
    reconcile() {
        const entry = this.running;
        if (!entry)
            return null;
        const last = this._readBeat();
        if (nowSec() - last <= STALE_SECONDS) {
            this.heartbeat();
            return null;
        }
        const project = this.getProject(entry.projectId);
        this.stop(Math.max(last, entry.start));
        return project;
    }

    // --- entries -----------------------------------------------------------------------

    // newest first
    entriesFor(projectId) {
        return this.data.entries
            .filter(e => e.projectId === projectId)
            .sort((a, b) => b.start - a.start);
    }

    addEntry(projectId, start, end) {
        this.data.entries.push({id: GLib.uuid_string_random(), projectId, start, end});
        this._changed();
    }

    updateEntry(id, fields) {
        const entry = this.data.entries.find(e => e.id === id);
        if (!entry)
            return;
        Object.assign(entry, fields);
        this._changed();
    }

    deleteEntry(id) {
        this.data.entries = this.data.entries.filter(e => e.id !== id);
        this._changed();
    }

    // --- totals ------------------------------------------------------------------------

    // Seconds worked on a project (null = all projects) between two instants.
    // A running session counts up to now.
    seconds(projectId = null, from = 0, to = Infinity) {
        const now = nowSec();
        let total = 0;
        for (const e of this.data.entries) {
            if (projectId && e.projectId !== projectId)
                continue;
            const overlap = Math.min(e.end ?? now, to) - Math.max(e.start, from);
            if (overlap > 0)
                total += overlap;
        }
        return total;
    }

    // the symbol a project is paid in
    currencyOf(project) {
        return project.currency || this.data.settings.currency;
    }

    // Money earned on the paid ones among `projects` between two instants, as a Map of
    // currency symbol -> amount, because projects need not be paid in the same currency.
    earnings(projects = this.data.projects, from = 0, to = Infinity) {
        const totals = new Map();
        for (const p of projects.filter(project => project.billable)) {
            const currency = this.currencyOf(p).trim();
            totals.set(currency, (totals.get(currency) ?? 0) + this.seconds(p.id, from, to) / 3600 * p.rate);
        }
        return totals;
    }

    // What the Quick Settings tile needs to draw itself.
    snapshot() {
        const running = this.running;
        const current = this.currentProject;
        const brief = p => ({id: p.id, name: p.name, topic: p.topic});
        return {
            running: !!running,
            at: nowSec(),
            current: current ? brief(current) : null,
            todaySeconds: current ? this.seconds(current.id, startOfDay()) : 0,
            recent: this.recentProjects(3).map(brief),
            day: startOfDay(),
        };
    }
}
