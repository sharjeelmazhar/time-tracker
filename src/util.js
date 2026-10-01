// Formatting and date helpers shared by the whole app. No GTK in here.

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

// unix seconds -> "2026-10-01"
export function fmtDate(sec) {
    const d = new Date(sec * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// unix seconds -> "09:05"
export function fmtTime(sec) {
    const d = new Date(sec * 1000);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// unix seconds -> "Today" / "Yesterday" / "Mon, 28 Sep"
export function fmtDayLabel(sec) {
    const day = startOfDay(new Date(sec * 1000));
    const today = startOfDay();
    if (day === today)
        return 'Today';
    if (day === startOfDay(new Date((today - 1) * 1000)))
        return 'Yesterday';
    const d = new Date(sec * 1000);
    const opts = {weekday: 'short', day: 'numeric', month: 'short'};
    if (d.getFullYear() !== new Date().getFullYear())
        opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
}

// "2026-10-01", "9:05" -> unix seconds, or null if either part is malformed
export function parseDateTime(dateStr, timeStr) {
    const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr.trim());
    const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
    if (!dm || !tm)
        return null;
    const [y, mo, da] = dm.slice(1).map(Number);
    const [h, mi] = tm.slice(1).map(Number);
    if (h > 23 || mi > 59)
        return null;
    const d = new Date(y, mo - 1, da, h, mi, 0, 0);
    if (d.getMonth() !== mo - 1 || d.getDate() !== da)
        return null;
    return Math.floor(d.getTime() / 1000);
}
