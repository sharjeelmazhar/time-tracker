import GLib from 'gi://GLib';

export const APP_ID = 'io.github.sharjeelmazhar.TimeTracker';
export const VERSION = '1.1.0';
export const AUTHOR = 'Sharjeel M. Rajput';
export const AUTHOR_URL = 'https://github.com/sharjeelmazhar';
export const REPO_URL = 'https://github.com/sharjeelmazhar/time-tracker';

// where the app's own files are, installed (/usr/share/timetracker) or not
export const SRC_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
