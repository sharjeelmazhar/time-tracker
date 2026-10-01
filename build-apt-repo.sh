#!/bin/sh
# Build a signed apt repository holding dist/timetracker_<version>_all.deb in ./site.
# The release workflow publishes it on GitHub Pages; the .deb installs a source entry
# pointing there, so "sudo apt upgrade" picks up new versions.
# Signs with the secret key in gpg's keyring (in CI: the APT_SIGNING_KEY secret).
set -eu
cd "$(dirname "$(readlink -f "$0")")"

rm -rf site
mkdir site
cp dist/timetracker_*_all.deb site/
cd site

dpkg-scanpackages --multiversion . > Packages 2>/dev/null
gzip -9 -k Packages

# apt checks the package list against these sizes and hashes, and the signature covers them
{
    echo "Origin: Time Tracker"
    echo "Label: Time Tracker"
    echo "Suite: stable"
    echo "Date: $(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S UTC')"
    echo "SHA256:"
    for file in Packages Packages.gz; do
        echo " $(sha256sum "$file" | cut -d' ' -f1) $(stat -c %s "$file") $file"
    done
} > Release

gpg --batch --yes --clearsign --output InRelease Release
gpg --batch --yes --armor --detach-sign --output Release.gpg Release

cat > index.html <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>Time Tracker apt repository</title>
<p>This is the apt repository of <a href="https://github.com/sharjeelmazhar/time-tracker">Time Tracker</a>.
Install the app from its <a href="https://github.com/sharjeelmazhar/time-tracker/releases/latest">latest release</a>;
it adds this repository so that updates arrive with <code>sudo apt upgrade</code>.</p>
HTML
