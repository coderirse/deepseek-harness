# Agent Note: Linux Desktop release target

Status: implemented

English | [中文](2026-10-02-linux-desktop-release-target.zh.md)

The [packaging and update decision](2026-08-25-electron-desktop-packaging-and-updates.md) owns the release pipeline this note extends to Linux.

## Problem

The Desktop application shipped for `mac-arm64`, `mac-x64`, and `win-x64` only. The harness core (sandbox chain, subprocess management, terminals, native addons, primary runtime) already treats Linux as a first-class platform, so the gap was confined to the Electron shell: packaging targets, platform guards in the main process, CLI registration, update feeds, and the desktop account identity.

## Decision

`linux-x64` and `linux-arm64` are Desktop release targets. Packaging runs on a Linux host of the same architecture, matching the existing Windows host gate; no cross-arch Linux build exists.

One Linux run emits an AppImage, a deb, and an rpm. The AppImage is the only auto-update channel: electron-updater's Linux updater is the AppImageUpdater, and the channel metadata is `nightly-linux.yml`. A deb or rpm install disables the in-application updater through the `APPIMAGE` environment gate, and package managers own those updates. Linux artifacts are unsigned in this release; the feed's SHA-512 metadata carries integrity, the deb/rpm `maintainer` header is operator-owned through `DSH_DESKTOP_LINUX_MAINTAINER`, and GPG or repository signing is deferred. A packaging run verifies electron-builder's AppImage `app-update.yml` instead of rewriting it.

The Linux shell uses the system title bar, ships no tray, and closes its main window through the ordinary quit flow: a hidden window without a tray or Dock is unreachable. The `dsh` command registers at `~/.local/bin/dsh` without elevation, sharing the macOS symlink, receipt, and backup mechanics; an AppImage install offers no registration because its temporary mount disappears at exit, so the command remains a deb and rpm integration. The account identity chain sends `desktop-linux` for Linux desktop sessions (`x-client-platform: desktop-linux`); Platform-server acceptance of the new value is an external release dependency, and until it is confirmed the deployment keeps Linux desktop releases unpublished rather than reverting the identity.

The desktop payload keeps the WASM LibreOffice engine on Linux until a native `libreoffice-kit-linux-*` ships (the engine packages are still unpublished), and keeps the bundled Landlock launcher as the sandbox fallback behind Bubblewrap; the asar unpack list names `landlock-run` explicitly because the static launcher has no distinguishing file suffix.

The shipped `@deepseek-ai/libreoffice-kit` entry mis-detects installed engines inside an ASAR archive: Electron's ASAR-integrated `lstatSync` reports a bogus stat or throws for missing archive paths regardless of `throwIfNoEntry`, so the kit's `installedPackageExists` probe treats the unpublished Linux engine as present and abandons the WASM fallback. `patches/@deepseek-ai__libreoffice-kit.patch` makes that probe confirm the package manifest with a read, which the archive layer reports as absent reliably; the patch is local to the probe and removable when the kit fixes its detection or ships the Linux engines. Because the runtime install runs from a staging directory outside the repository, where pnpm cannot see the root workspace, `prepare:dsh` copies every workspace patch into the staged project and declares them in its own `pnpm-workspace.yaml`; without that, the isolated install silently skips all patches.

## Alternatives considered

Publishing only the AppImage (the vestigial electron-builder hint) was rejected because distribution channels that require system integration, like deb and rpm, serve users package managers cannot reach through AppImage alone; the cost is a second, unupdated install form whose existence the updater gate must handle honestly. Reusing the web identity (`desktopPlatform: null`) for the first Linux release avoids the Platform-server dependency but permanently misattributes Linux desktop usage, so the identity ships with the release rather than after it. A tray with close-to-hide would have matched Windows, but without a menu-bar indicator convention across Linux desktops the hidden window is unreachable; close-to-quit keeps every exit path visible. A native LibreOffice engine kit for Linux would remove the WASM fallback, but no such build exists today and the fallback is functional.

## Consequences

- Fixed download names gain `desktop/dsh-latest-linux-<arch>.AppImage`; upload plans carry AppImage, blockmap, deb, and rpm artifacts.
- `DesktopPackageTargetName`, update targets, and the credential `desktopPlatform` union all include `linux`; consumers that switch on the old unions had to widen.
- Linux close-to-quit is user-visible behavior that differs from Windows hide-to-tray and macOS hide-to-Dock.
