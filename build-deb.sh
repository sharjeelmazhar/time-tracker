#!/bin/sh
# Build dist/timetracker_<version>_all.deb. Needs nothing beyond dpkg-deb, which every Ubuntu has.
set -eu
cd "$(dirname "$(readlink -f "$0")")"

PKG=timetracker
APP_ID=io.github.sharjeelmazhar.TimeTracker
UUID=time-tracker@sharjeelmazhar.github.io
VERSION=$(sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" src/config.js)
[ -n "$VERSION" ] || { echo "could not read VERSION from src/config.js" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ROOT=$STAGE/root

install -Dm755 data/timetracker "$ROOT/usr/bin/timetracker"
install -Dm644 -t "$ROOT/usr/share/$PKG" src/*.js src/style.css
install -Dm644 -t "$ROOT/usr/share/applications" "data/$APP_ID.desktop"
install -Dm644 -t "$ROOT/usr/share/dbus-1/services" "data/$APP_ID.service"
install -Dm644 -t "$ROOT/usr/share/icons/hicolor/scalable/apps" "data/icons/$APP_ID.svg"
install -Dm644 -t "$ROOT/usr/share/icons/hicolor/symbolic/apps" "data/icons/$APP_ID-symbolic.svg"
install -Dm644 -t "$ROOT/usr/share/gnome-shell/extensions/$UUID" "extension/$UUID/extension.js" "extension/$UUID/metadata.json"
install -Dm644 -t "$ROOT/usr/share/gnome-shell/extensions/$UUID/icons" "extension/$UUID/icons/time-tracker-symbolic.svg"
install -Dm644 -t "$ROOT/usr/share/$PKG/icons" src/icons/*.svg
install -Dm644 LICENSE "$ROOT/usr/share/doc/$PKG/copyright"
# the app's own apt repository, so that "apt upgrade" brings new versions
install -Dm644 -t "$ROOT/usr/share/keyrings" data/timetracker-archive-keyring.gpg
install -Dm644 -t "$ROOT/etc/apt/sources.list.d" data/timetracker.sources

install -d "$ROOT/DEBIAN"
cat > "$ROOT/DEBIAN/control" <<CONTROL
Package: $PKG
Version: $VERSION
Section: utils
Priority: optional
Architecture: all
Depends: gjs (>= 1.80), gir1.2-gtk-4.0 (>= 4.16), gir1.2-adw-1 (>= 1.7), gir1.2-soup-3.0, gir1.2-secret-1
Recommends: gnome-shell (>= 48)
Installed-Size: $(du -sk --exclude=DEBIAN "$ROOT" | cut -f1)
Maintainer: Sharjeel M. Rajput <sharjeelmazhar@gmail.com>
Homepage: https://github.com/sharjeelmazhar/time-tracker
Description: Track the time you spend on your projects
 Time Tracker keeps a timer per project, grouped by topic, and works out
 earnings for projects with an hourly rate. A Quick Settings tile starts
 and stops the timer and switches between the three most recent projects
 without opening the app.
CONTROL
echo /etc/apt/sources.list.d/timetracker.sources > "$ROOT/DEBIAN/conffiles"

mkdir -p dist
dpkg-deb --root-owner-group --build "$ROOT" "dist/${PKG}_${VERSION}_all.deb"
