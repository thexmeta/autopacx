#!/bin/bash
# AutoPacX Debian/RPM post-remove script.
#
# Passed to fpm as --after-remove by electron-builder. It mirrors the default
# electron-builder template (binary symlink removal, AppArmor profile removal)
# and additionally removes the installed polkit policy and privileged helper and
# refreshes the desktop/icon caches.
#
# ${executable} and ${sanitizedProductName} are substituted by electron-builder
# before the script is written; do NOT use shell `${...}` syntax below.

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

# Remove the installed polkit policy and the root-owned privileged helper.
rm -f /usr/share/polkit-1/actions/org.autopacx.policy || true
rm -f /usr/lib/autopacx/autopacx-helper || true
rmdir /usr/lib/autopacx 2>/dev/null || true

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

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

exit 0
