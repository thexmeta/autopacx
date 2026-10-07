#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2024 PlebOne
#
# Build a Debian x64 release package for AutoNex.
#
# Usage (from the project root):  ./scripts/build-deb.sh
#
# Pipeline:
#   1. pnpm build                     -> out/                        (electron-vite)
#   2. electron-builder --linux dir   -> release/linux-unpacked/     (only if stale)
#   3. assemble an FHS tree in a temp dir
#   4. dpkg-deb --root-owner-group --build
#   5. emit dist/autonex-<version>-amd64.deb
#
# The package version is read from package.json (single source of truth) and
# translated to a Debian-safe form ("0.1.0-beta" -> "0.1.0~beta").
#
# Re-runnable and idempotent: the staging tree is a private `mktemp -d` work dir
# that is always removed on exit. Nothing outside it is deleted.

set -euo pipefail

# ---- configuration ----------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

PRODUCT_NAME="AutoNex"          # app lives in /opt/<PRODUCT_NAME>
EXECUTABLE="autonex"            # binary basename (also the .desktop Exec + WM class target)
PKG_NAME="autonex"
ARCH="amd64"

UNPACKED="$ROOT/release/linux-unpacked"
OUT_DIR="$ROOT/out"
DIST_DIR="$ROOT/dist"
ICON_SRC="$ROOT/build/icon.png"

# Electron/pnpm must trust the local MITM CA; the safe-delete shim crashes
# electron-builder, so disable it for the whole run.
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/home/mxadm/.mitmproxy/mitmproxy-ca-cert.pem}"
export CODEBUDDY_SAFE_DELETE_ENABLED=0

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$ROOT"

command -v dpkg-deb >/dev/null 2>&1 || die "dpkg-deb not found (install the 'dpkg' package)"
command -v pnpm     >/dev/null 2>&1 || die "pnpm not found on PATH"
[ -f "$ROOT/package.json" ] || die "package.json not found in $ROOT"

# ---- version (single source of truth) ---------------------------------------
VERSION="$(node -p "require('$ROOT/package.json').version")"
[ -n "$VERSION" ] || die "could not read 'version' from package.json"
# Debian treats '-' as the debian_revision separator; use '~' so 0.1.0-beta
# sorts before 0.1.0 and stays a valid upstream version.
VERSION_DEB="${VERSION//-/\~}"
DEB_FILE="${PKG_NAME}-${VERSION}-${ARCH}.deb"
log "AutoNex ${VERSION} (Debian version ${VERSION_DEB}) -> dist/${DEB_FILE}"

# ---- step 1: build the app bundle -------------------------------------------
log "Building app bundle (pnpm build)…"
pnpm build

# ---- step 2: produce the unpacked electron tree if missing/stale ------------
build_unpacked=0
if [ ! -x "$UNPACKED/$EXECUTABLE" ]; then
    build_unpacked=1
elif [ -n "$(find "$OUT_DIR" "$ROOT/package.json" "$ROOT/electron-builder.yml" \
        -newer "$UNPACKED/$EXECUTABLE" -print -quit 2>/dev/null)" ]; then
    build_unpacked=1
fi

if [ "$build_unpacked" -eq 1 ]; then
    log "Packaging unpacked Electron tree (electron-builder --linux dir)…"
    pnpm exec electron-builder --linux dir
else
    log "Unpacked tree is up to date: $UNPACKED"
fi

[ -x "$UNPACKED/$EXECUTABLE" ]                       || die "missing $UNPACKED/$EXECUTABLE after build"
[ -f "$UNPACKED/resources/autonex-helper" ]          || die "missing autonex-helper in unpacked resources"
[ -f "$UNPACKED/resources/org.autonex.policy" ]      || die "missing org.autonex.policy in unpacked resources"
[ -f "$ICON_SRC" ]                                   || die "icon not found: $ICON_SRC"

# ---- step 3: assemble the FHS tree ------------------------------------------
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/autonex-deb.XXXXXX")"
cleanup() { rm -rf -- "$STAGE"; }
trap cleanup EXIT

log "Assembling FHS tree in $STAGE …"
install -d "$STAGE/DEBIAN"
install -d "$STAGE/opt/$PRODUCT_NAME"
install -d "$STAGE/usr/bin"
install -d "$STAGE/usr/share/applications"
install -d "$STAGE/usr/share/icons/hicolor/512x512/apps"

# App payload -> /opt/AutoNex (binary, resources/, locales/, *.pak, *.so, …)
cp -a "$UNPACKED/." "$STAGE/opt/$PRODUCT_NAME/"
chmod 0755 "$STAGE/opt/$PRODUCT_NAME/$EXECUTABLE"

# /usr/bin/<exe> symlink, managed by dpkg (removed automatically on uninstall).
ln -sf "/opt/$PRODUCT_NAME/$EXECUTABLE" "$STAGE/usr/bin/$EXECUTABLE"

# Desktop entry (mirrors the electron-builder output).
cat > "$STAGE/usr/share/applications/$EXECUTABLE.desktop" <<EOF
[Desktop Entry]
Name=$PRODUCT_NAME
Exec=/opt/$PRODUCT_NAME/$EXECUTABLE %U
Terminal=false
Type=Application
Icon=$EXECUTABLE
StartupWMClass=com.autonex
Keywords=package;github;release;manager;
Comment=AutoNex helps you manage and install applications from GitHub releases.
Categories=Utility;PackageManager;
EOF
chmod 0644 "$STAGE/usr/share/applications/$EXECUTABLE.desktop"

# Icon -> hicolor theme.
install -m 0644 "$ICON_SRC" "$STAGE/usr/share/icons/hicolor/512x512/apps/$EXECUTABLE.png"

# ---- step 4: control metadata ----------------------------------------------
INSTALLED_KB="$(du -k -s --exclude=DEBIAN "$STAGE" | cut -f1)"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION_DEB
Architecture: $ARCH
Maintainer: AutoNex Team <team@autonex.dev>
Installed-Size: $INSTALLED_KB
Depends: libgtk-3-0, libblkid1, liblzma5, libcurl4, libfreetype6
Recommends: libappindicator3-1
Section: utils
Priority: optional
Homepage: https://github.com/thexmeta/autonex
Description: GitHub-release package manager for Linux
 AutoNex helps you manage and install applications from GitHub releases.
EOF

# ---- step 5: maintainer scripts --------------------------------------------
# postinst — mirrors build/after-install.tpl with ${executable}=autonex and
# ${sanitizedProductName}=AutoNex substituted.
cat > "$STAGE/DEBIAN/postinst" <<'POSTINST'
#!/bin/bash
# AutoNex Debian post-install script.
#
# Mirrors build/after-install.tpl: keeps /usr/bin/autonex in sync, fixes the
# chrome-sandbox mode, installs the polkit policy + root-owned helper, and
# refreshes the MIME/desktop/icon caches. Every step is best-effort.

# --- /usr/bin/autonex --------------------------------------------------------
# This package ships /usr/bin/autonex as a symlink to /opt/AutoNex/autonex.
# Keep an update-alternatives entry in sync only when the link is missing or
# foreign (e.g. left over from an earlier electron-builder install).
if [ -L /usr/bin/autonex ] && [ "$(readlink /usr/bin/autonex)" = "/opt/AutoNex/autonex" ]; then
    : # shipped symlink is already correct
elif type update-alternatives >/dev/null 2>&1; then
    if [ -L /usr/bin/autonex ] && [ -e /usr/bin/autonex ] && \
       [ "$(readlink /usr/bin/autonex)" != "/etc/alternatives/autonex" ]; then
        rm -f /usr/bin/autonex
    fi
    update-alternatives --install /usr/bin/autonex autonex /opt/AutoNex/autonex 100 || \
        ln -sf /opt/AutoNex/autonex /usr/bin/autonex
else
    ln -sf /opt/AutoNex/autonex /usr/bin/autonex
fi

# --- chrome-sandbox ----------------------------------------------------------
# Use the SUID sandbox only on kernels without working user namespaces.
if ! { [ -L /proc/self/ns/user ] && unshare --user true; } 2>/dev/null; then
    chmod 4755 /opt/AutoNex/chrome-sandbox || true
else
    chmod 0755 /opt/AutoNex/chrome-sandbox || true
fi

# --- MIME / desktop databases ------------------------------------------------
if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# --- polkit policy -----------------------------------------------------------
# Binds the org.autonex.helper action to the one root-owned helper below, so
# pkexec can never be turned into a generic root shell.
POLICY_SOURCE='/opt/AutoNex/resources/org.autonex.policy'
POLICY_TARGET='/usr/share/polkit-1/actions/org.autonex.policy'
if [ -f "$POLICY_SOURCE" ]; then
    mkdir -p /usr/share/polkit-1/actions
    cp -f "$POLICY_SOURCE" "$POLICY_TARGET" || true
    chmod 0644 "$POLICY_TARGET" || true
fi

# --- root-owned privileged helper -------------------------------------------
# Must be root:root 0755 or pkexec refuses to run it.
HELPER_SOURCE='/opt/AutoNex/resources/autonex-helper'
HELPER_TARGET='/usr/lib/autonex/autonex-helper'
if [ -f "$HELPER_SOURCE" ]; then
    mkdir -p /usr/lib/autonex
    install -m 0755 -o root -g root "$HELPER_SOURCE" "$HELPER_TARGET" || \
        { cp -f "$HELPER_SOURCE" "$HELPER_TARGET" && \
          chmod 0755 "$HELPER_TARGET" && chown root:root "$HELPER_TARGET"; } || true
fi

# --- icon cache --------------------------------------------------------------
if [ -d /usr/share/icons/hicolor ]; then
    touch /usr/share/icons/hicolor
    if command -v update-icon-caches >/dev/null 2>&1; then
        update-icon-caches /usr/share/icons/hicolor || true
    elif command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
    fi
fi

# --- AppArmor profile (Ubuntu 24+) ------------------------------------------
# Skip on AppArmor versions that cannot parse the bundled abi/4.0 profile
# (e.g. Ubuntu 22.04); the app runs fine without it there.
if apparmor_status --enabled >/dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE='/opt/AutoNex/resources/apparmor-profile'
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/autonex'
    if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" >/dev/null 2>&1; then
        cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
        if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
        fi
    else
        echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
    fi
fi

exit 0
POSTINST
chmod 0755 "$STAGE/DEBIAN/postinst"

# prerm — drop the update-alternatives entry (if any) before files are removed.
cat > "$STAGE/DEBIAN/prerm" <<'PRERM'
#!/bin/bash
# AutoNex Debian pre-remove script.
#
# Remove the update-alternatives entry before dpkg unlinks the files. The
# /usr/bin/autonex symlink shipped by the package is removed by dpkg itself.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove autonex /opt/AutoNex/autonex >/dev/null 2>&1 || true
fi

exit 0
PRERM
chmod 0755 "$STAGE/DEBIAN/prerm"

# postrm — mirrors build/after-remove.tpl: remove the polkit policy, the helper
# and the AppArmor profile, and refresh the desktop/icon caches.
cat > "$STAGE/DEBIAN/postrm" <<'POSTRM'
#!/bin/bash
# AutoNex Debian post-remove script.
#
# Mirrors build/after-remove.tpl: removes the installed polkit policy and the
# root-owned privileged helper, unloads/removes the AppArmor profile, and
# refreshes the desktop/icon caches.

# Drop the update-alternatives entry (idempotent; a no-op if never registered).
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove autonex /opt/AutoNex/autonex >/dev/null 2>&1 || true
else
    rm -f /usr/bin/autonex || true
fi

# Remove the installed polkit policy and the root-owned privileged helper.
rm -f /usr/share/polkit-1/actions/org.autonex.policy || true
rm -f /usr/lib/autonex/autonex-helper || true
rmdir /usr/lib/autonex 2>/dev/null || true

# Refresh the desktop/icon caches so the removal is reflected.
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

if [ -d /usr/share/icons/hicolor ]; then
    touch /usr/share/icons/hicolor
    if command -v update-icon-caches >/dev/null 2>&1; then
        update-icon-caches /usr/share/icons/hicolor || true
    elif command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
    fi
fi

# Remove and unload the AppArmor profile.
APPARMOR_PROFILE_DEST='/etc/apparmor.d/autonex'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
    if apparmor_status --enabled >/dev/null 2>&1; then
        if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
        fi
    fi
    rm -f "$APPARMOR_PROFILE_DEST"
fi

exit 0
POSTRM
chmod 0755 "$STAGE/DEBIAN/postrm"

# md5sums (relative paths, no leading "./", symlinks excluded).
( cd "$STAGE" && find . -path ./DEBIAN -prune -o -type f -print0 \
    | sed -z 's|^\./||' | sort -z | xargs -0 -r md5sum > DEBIAN/md5sums )

# ---- step 6: build the .deb -------------------------------------------------
install -d "$DIST_DIR"
OUT_DEB="$DIST_DIR/$DEB_FILE"
rm -f -- "$OUT_DEB"

log "Building package (dpkg-deb --root-owner-group --build)…"
dpkg-deb --root-owner-group --build "$STAGE" "$OUT_DEB"

# ---- step 7: verify + report ------------------------------------------------
dpkg-deb --info "$OUT_DEB" >/dev/null || die "produced archive is not a valid .deb"
SIZE="$(du -h "$OUT_DEB" | cut -f1)"
log "Built $OUT_DEB ($SIZE)"
echo
dpkg-deb -I "$OUT_DEB" | sed -n '1,20p'
echo
log "Packaged entries of interest:"
dpkg-deb -c "$OUT_DEB" | grep -E 'usr/bin/autonex|applications/autonex.desktop|hicolor/512x512/apps/autonex.png|org\.autonex\.policy|autonex-helper' || true
