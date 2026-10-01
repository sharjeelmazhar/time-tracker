// Formatting and date helpers shared by the whole app. No GTK in here.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const nowSec = () => Math.floor(Date.now() / 1000);

const pad = n => String(n).padStart(2, '0');

// 3725 -> "1:02:05"
export function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}

// 3725 -> "1h 02m", 300 -> "5m", 20 -> "20s"
export function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60)
        return `${sec}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec / 60) % 60;
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

export function fmtMoney(amount, currency) {
    const n = amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return `${currency}${n}`;
}

export const earned = (sec, rate) => sec / 3600 * rate;

// "12h 30m", plus " · $375.00" on paid projects
export function fmtWork(sec, project, currency) {
    const time = fmtDuration(sec);
    return project.billable ? `${time} · ${fmtMoney(earned(sec, project.rate), currency)}` : time;
}

export function startOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

// weeks start on Monday
export function startOfWeek(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return Math.floor(d.getTime() / 1000);
}

export function startOfMonth(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return Math.floor(d.getTime() / 1000);
}

// --- dates and clock times, in the format the user chose --------------------------------

let timeFormat = '24h'; // '12h' | '24h'
let dateFormat = 'ymd'; // 'dmy' | 'mdy' | 'ymd'

// What the desktop uses: the clock setting from GNOME, the date order from the locale.
export function systemFormats() {
    let time = '24h';
    try {
        if (Gio.SettingsSchemaSource.get_default().lookup('org.gnome.desktop.interface', true))
            time = new Gio.Settings({schemaId: 'org.gnome.desktop.interface'}).get_string('clock-format');
    } catch {
        // not a GNOME desktop: keep 24h
    }
    // a date where day, month and year cannot be confused, written the locale's way
    const sample = GLib.DateTime.new_local(2026, 11, 22, 12, 0, 0).format('%x');
    const day = sample.indexOf('22');
    const month = sample.indexOf('11');
    const year = sample.indexOf('26');
    let date = 'dmy';
    if (year < day && year < month)
        date = 'ymd';
    else if (month < day)
        date = 'mdy';
    return {time: time === '12h' ? '12h' : '24h', date};
}

// Apply the Preferences choices; 'system' follows the desktop.
export function configureFormats(settings) {
    const system = systemFormats();
    timeFormat = settings.timeFormat === 'system' ? system.time : settings.timeFormat;
    dateFormat = settings.dateFormat === 'system' ? system.date : settings.dateFormat;
}

// "DD/MM/YYYY" and "3:54 PM": shown next to the fields where dates and times are typed
export const dateHint = (format = dateFormat) => ({dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY-MM-DD'})[format];
export const timeHint = (format = timeFormat) => (format === '12h' ? '3:54 PM' : '15:54');

// unix seconds -> "01/10/2026", "10/01/2026" or "2026-10-01"
export function fmtDate(sec) {
    const d = new Date(sec * 1000);
    const [day, month, year] = [pad(d.getDate()), pad(d.getMonth() + 1), d.getFullYear()];
    if (dateFormat === 'dmy')
        return `${day}/${month}/${year}`;
    if (dateFormat === 'mdy')
        return `${month}/${day}/${year}`;
    return `${year}-${month}-${day}`;
}

// unix seconds -> "3:54 PM" or "15:54"
export function fmtTime(sec) {
    const d = new Date(sec * 1000);
    if (timeFormat === '24h')
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

// unix seconds -> "Today" / "Yesterday" / "Mon, 28 Sep" (or "Mon, Sep 28")
export function fmtDayLabel(sec) {
    const day = startOfDay(new Date(sec * 1000));
    const today = startOfDay();
    if (day === today)
        return 'Today';
    if (day === startOfDay(new Date((today - 1) * 1000)))
        return 'Yesterday';
    const d = new Date(sec * 1000);
    const weekday = d.toLocaleDateString(undefined, {weekday: 'short'});
    const month = d.toLocaleDateString(undefined, {month: 'short'});
    const year = d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear();
    if (dateFormat === 'dmy')
        return `${weekday}, ${d.getDate()} ${month} ${year}`.trim();
    return `${weekday}, ${month} ${d.getDate()}${year ? `, ${year}` : ''}`;
}

// A date and a clock time as typed by the user -> unix seconds, or null if either is
// malformed. The date is read in the chosen order; the time may be "15:54" or "3:54 pm".
export function parseDateTime(dateStr, timeStr) {
    const parts = dateStr.trim().split(/[-/.]/).map(part => part.trim());
    if (parts.length !== 3 || !parts.every(part => /^\d{1,4}$/.test(part)))
        return null;
    const [a, b, c] = parts.map(Number);
    const [y, mo, da] = {dmy: [c, b, a], mdy: [c, a, b], ymd: [a, b, c]}[dateFormat];
    if (y < 1000)
        return null;

    const tm = /^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?$/i.exec(timeStr.trim());
    if (!tm)
        return null;
    let h = Number(tm[1]);
    const mi = Number(tm[2]);
    const half = tm[3]?.toLowerCase();
    if (half) {
        if (h < 1 || h > 12)
            return null;
        h = h % 12 + (half === 'p' ? 12 : 0);
    } else if (timeFormat === '12h' && h >= 1 && h <= 12) {
        // "3:54" on a 12-hour clock could be morning or afternoon: make the user say which
        return null;
    }
    if (h > 23 || mi > 59)
        return null;

    const d = new Date(y, mo - 1, da, h, mi, 0, 0);
    if (d.getMonth() !== mo - 1 || d.getDate() !== da)
        return null;
    return Math.floor(d.getTime() / 1000);
}
