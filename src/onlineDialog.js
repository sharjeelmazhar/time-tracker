import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {createBackup, findBackup, readBackup, TOKEN_URL} from './cloud.js';

// Connect the app to a GitHub account for the online backup. If the account already
// holds a backup (a reinstall, a second computer), offer to bring it in.
export const OnlineBackupDialog = GObject.registerClass(
class OnlineBackupDialog extends Adw.Dialog {
    constructor(store) {
        super({title: 'Online Backup', contentWidth: 460, contentHeight: 520});
        this._store = store;
        this._app = Gio.Application.get_default();

        const cancel = new Gtk.Button({label: 'Cancel'});
        cancel.connect('clicked', () => this.close());
        this._connect = new Gtk.Button({label: 'Connect', cssClasses: ['suggested-action'], sensitive: false});
        this._connect.connect('clicked', () => this._onConnect().catch(e => this._fail(e)));
        const header = new Adw.HeaderBar({showStartTitleButtons: false, showEndTitleButtons: false});
        header.pack_start(cancel);
        header.pack_end(this._connect);

        const open = new Adw.ButtonRow({title: 'Open the Token Page on GitHub', endIconName: 'adw-external-link-symbolic'});
        open.connect('activated', () => new Gtk.UriLauncher({uri: TOKEN_URL}).launch(this.get_root(), null, null));
        this._token = new Adw.PasswordEntryRow({title: 'Token'});
        this._token.connect('changed', () => this._sync());
        this._token.connect('entry-activated', () => this._connect.activate());

        const group = new Adw.PreferencesGroup({
            description:
                'Your history is saved to your own GitHub account, as a secret gist that is ' +
                'updated after every change.\n\n' +
                '1. Open the token page below and sign in to GitHub.\n' +
                '2. Keep only “gist” ticked, set Expiration to “No expiration”, and press ' +
                'Generate token.\n' +
                '3. Copy the token and paste it here.\n\n' +
                'A secret gist is not listed anywhere, but anyone you give its link to can read it.',
        });
        group.add(open);
        group.add(this._token);
        const page = new Adw.PreferencesPage();
        page.add(group);

        this._toasts = new Adw.ToastOverlay({child: page});
        const view = new Adw.ToolbarView({content: this._toasts});
        view.add_top_bar(header);
        this.set_child(view);
        this.focusWidget = this._token;
    }

    _sync() {
        this._connect.sensitive = !this._busy && this._token.text.trim() !== '';
    }

    _fail(error) {
        this._busy = false;
        this._sync();
        this._toasts.add_toast(new Adw.Toast({title: error.message}));
    }

    async _onConnect() {
        const token = this._token.text.trim();
        this._busy = true;
        this._sync();

        const id = await findBackup(token);
        if (!id) {
            this._app.connectOnline(token, await createBackup(token, this._store.serialize()));
            this.close();
            return;
        }

        // The account already has a backup: which history wins?
        const text = await readBackup(token, id);
        let summary = null;
        try {
            summary = this._store.checkBackup(text);
        } catch {
            // unreadable: all that can be done with it is to replace it
        }
        const isEmptyHere = this._store.projects.length === 0;
        const dialog = new Adw.AlertDialog({
            heading: 'Online Backup Found',
            body: summary
                ? `Your GitHub account already has a backup with ${summary}.`
                : 'Your GitHub account already has a backup, but it cannot be read.',
        });
        dialog.add_response('cancel', 'Cancel');
        if (!isEmptyHere || !summary) {
            dialog.add_response('replace', 'Replace It With This Computer’s History');
            dialog.set_response_appearance('replace', Adw.ResponseAppearance.DESTRUCTIVE);
        }
        if (summary) {
            dialog.add_response('restore', 'Bring It to This Computer');
            dialog.set_response_appearance('restore', Adw.ResponseAppearance.SUGGESTED);
        }
        dialog.connect('response', (_dialog, response) => {
            if (response === 'cancel') {
                this._busy = false;
                this._sync();
                return;
            }
            // restoring first means the upload that follows the connection writes back
            // what was just read; replacing lets that same upload overwrite the backup
            if (response === 'restore')
                this._store.restore(text);
            this._app.connectOnline(token, id);
            this.close();
        });
        dialog.present(this);
    }
});
