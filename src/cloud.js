// Online backup: the history is kept as one file in a secret GitHub gist. It needs
// nothing but a GitHub account and a personal access token that may only touch gists.
// The token lives in the login keyring, never in data.json (which is what gets backed up).

import GLib from 'gi://GLib';
import Secret from 'gi://Secret?version=1';
import Soup from 'gi://Soup?version=3.0';

import {APP_ID} from './config.js';

// overridable so the tests can talk to a local server instead of GitHub
const API = GLib.getenv('TIMETRACKER_GITHUB_API') ?? 'https://api.github.com';
const FILE_NAME = 'timetracker-backup.json';
const DESCRIPTION = 'Time Tracker backup';
// the page where the token is made, with the one permission it needs already ticked
export const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Time%20Tracker%20backup';

const SCHEMA = new Secret.Schema(APP_ID, Secret.SchemaFlags.NONE, {service: Secret.SchemaAttributeType.STRING});
const ATTRIBUTES = {service: 'github'};

export function saveToken(token) {
    Secret.password_store_sync(SCHEMA, ATTRIBUTES, Secret.COLLECTION_DEFAULT,
        'Time Tracker online backup (GitHub token)', token, null);
}

// the stored token, or null
export function loadToken() {
    try {
        return Secret.password_lookup_sync(SCHEMA, ATTRIBUTES, null);
    } catch (e) {
        console.warn(`Time Tracker: could not read the keyring: ${e.message}`);
        return null;
    }
}

export function clearToken() {
    try {
        Secret.password_clear_sync(SCHEMA, ATTRIBUTES, null);
    } catch (e) {
        console.warn(`Time Tracker: could not clear the keyring: ${e.message}`);
    }
}

let session = null;

// One request; resolves to the parsed JSON reply (or text, for a non-API `url`).
// Rejects with an Error whose message can be shown to the user.
function request(method, url, token, body = null) {
    session ??= new Soup.Session({userAgent: 'TimeTracker', timeout: 30});
    const isApi = url.startsWith('/');
    const message = Soup.Message.new(method, isApi ? `${API}${url}` : url);
    if (isApi) {
        message.requestHeaders.append('Authorization', `Bearer ${token}`);
        message.requestHeaders.append('Accept', 'application/vnd.github+json');
    }
    if (body) {
        message.set_request_body_from_bytes('application/json',
            new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
    }

    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
            let text;
            try {
                text = new TextDecoder().decode(session.send_and_read_finish(result).get_data());
            } catch (e) {
                reject(new Error(`GitHub could not be reached (${e.message})`));
                return;
            }
            const status = message.statusCode;
            if (status === 401)
                reject(new Error('GitHub did not accept the token'));
            else if (status === 403 || status === 404)
                reject(new Error('The token is not allowed to use gists, or the backup was deleted'));
            else if (status < 200 || status >= 300)
                reject(new Error(`GitHub answered with error ${status}`));
            else
                resolve(isApi ? JSON.parse(text) : text);
        });
    });
}

const fileBody = text => ({files: {[FILE_NAME]: {content: text}}});

async function contentOf(gist) {
    const file = gist.files?.[FILE_NAME];
    if (!file)
        throw new Error('The online backup no longer has the history file in it');
    // GitHub cuts large files short in the API reply and points at the full one
    return file.truncated ? request('GET', file.raw_url, null) : file.content;
}

// Look through the account's gists for a backup: resolves to its id, or null.
export async function findBackup(token) {
    for (let page = 1; page <= 10; page++) {
        const gists = await request('GET', `/gists?per_page=100&page=${page}`, token);
        const found = gists.find(gist => gist.files?.[FILE_NAME]);
        if (found)
            return found.id;
        if (gists.length < 100)
            break;
    }
    return null;
}

// Resolves to the id of the new secret gist.
export async function createBackup(token, text) {
    const gist = await request('POST', '/gists', token, {description: DESCRIPTION, public: false, ...fileBody(text)});
    return gist.id;
}

export async function updateBackup(token, id, text) {
    await request('PATCH', `/gists/${id}`, token, fileBody(text));
}

// Resolves to the backup's text.
export async function readBackup(token, id) {
    return contentOf(await request('GET', `/gists/${id}`, token));
}
