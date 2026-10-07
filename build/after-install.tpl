#!/bin/bash
# AutoPacX Debian/RPM post-install script.
#
# Passed to fpm as --after-install by electron-builder. It mirrors the default
# electron-builder template (binary symlink, chrome-sandbox permissions,
# MIME/desktop/AppArmor registration) and additionally installs the polkit
# policy and refreshes the icon cache, matching the original
# scripts/create-debian-package.sh postinst.
#
# ${executable} and ${sanitizedProductName} are substituted by electron-builder
# before the script is written; do NOT use shell `${...}` syntax below, since
# any other macro name would abort the build.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install the polkit policy so pkexec maps the app's privileged actions to a
# named, user-readable prompt instead of the generic
# org.freedesktop.policykit.exec.
POLICY_SOURCE='/opt/${sanitizedProductName}/resources/org.autopacx.policy'
POLICY_TARGET='/usr/share/polkit-1/actions/org.autopacx.policy'
if [ -f "$POLICY_SOURCE" ]; then
    mkdir -p /usr/share/polkit-1/actions
    cp -f "$POLICY_SOURCE" "$POLICY_TARGET" || true
    chmod 0644 "$POLICY_TARGET" || true
fi

# Install the root-owned privileged helper. The polkit policy above binds the
# single action to this one program, so pkexec can never run a generic shell.
# It must be root:root 0755, otherwise pkexec refuses to run it.
HELPER_SOURCE='/opt/${sanitizedProductName}/resources/autopacx-helper'
HELPER_TARGET='/usr/lib/autopacx/autopacx-helper'
if [ -f "$HELPER_SOURCE" ]; then
    mkdir -p /usr/lib/autopacx
    install -m 0755 -o root -g root "$HELPER_SOURCE" "$HELPER_TARGET" || \
        { cp -f "$HELPER_SOURCE" "$HELPER_TARGET" && chmod 0755 "$HELPER_TARGET" && chown root:root "$HELPER_TARGET"; } || true
fi

# Refresh the icon cache so the newly installed icon is picked up.
if [ -d /usr/share/icons/hicolor ]; then
    touch /usr/share/icons/hicolor
    if command -v update-icon-caches >/dev/null 2>&1; then
        update-icon-caches /usr/share/icons/hicolor || true
    elif command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
    fi
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

exit 0
