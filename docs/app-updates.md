# Application updates

Packaged ouRGeo checks for a newer compatible installer shortly after startup.
If your installation is current, nothing appears. Offline checks and platforms
without a published compatible installer also stay quiet. Checking does not
hold up the workspace or R connection, and an update prompt waits for another
open dialog or drag operation to finish.

When an update is available:

1. Review the installed and available versions. **Release notes** opens the
   official version history.
2. Choose **Download update** to open the official download in your browser.
3. Once the download finishes, save your project and any other work you want to
   keep. The dialog provides **Save project…** and **Close ouRGeo…**. Closing
   follows the normal unsaved-project prompt; Cancel keeps the app open.
4. Follow the installation steps shown for your installer, then reopen ouRGeo.

The app opens the download page; it does not monitor browser downloads, run
installers, replace files or quit automatically. Your project files, settings
and R installation are separate from the application installer.

**Remind me next time**, the close button and Escape dismiss the prompt for this
session. **Skip this version** suppresses startup reminders for that version;
a newer release can still be offered. Failed preference saves remain visible
so a skip or opt-out is never falsely reported as saved.

## Settings

**Settings → Updates → Check for updates…** runs a manual check, including when
startup checks are disabled or a version is skipped. A current installation gets
a confirmation. A failed check explains how to retry or open the official page.

**Check for updates when ouRGeo starts** controls automatic checking. **Show
reminders again** clears a skipped version. Preferences apply to this computer,
survive restarts and are not stored in `.ourgeoproj` files.

Checking requests the public installer catalogue and, for a newer release,
checks installer availability with HEAD. No project files, chats or credentials
are sent. Startup checks run once per application session, rather than polling.

## Platform and release policy

The source release and downloadable application can have different versions.
Only active compatible installer links on the
[official download page](https://ourgeo.dev/ourgeo-download.html) count as
available updates. A newer source-only release does not cause a prompt, and
a locally newer build is never downgraded.

| Installation | Guided update |
| --- | --- |
| Linux AppImage | Download the new AppImage, make it executable, replace the previous file and update any shortcut. |
| Recognised Debian package installation | Download the `.deb` and use the system package installer or the displayed `apt` command. |
| Other Linux installation | Offer AppImage, without assuming a Debian package manager. |
| Windows | Download the `.exe` and run the installer after closing ouRGeo. |
| macOS | Offer a `.dmg` only when it is actively published; replace the app in Applications. |
| Architecture without a matching published build | No incompatible installer; manual checks explain availability. |
| Development checkout (`npm run dev`) | No startup check or installer prompt. Manual checks explain using the normal source update workflow. |

Existing unsuffixed website binaries are x64. Supporting ARM installers requires
explicit architecture metadata and matching assets; the app does not infer ARM
support from an AppImage's distribution compatibility. Windows and macOS native
verification is deferred until suitable machines are available.

## Publishing and maintenance

Publish binaries using the existing official download cards and exact
`ouRGeo-X.Y.Z.AppImage`, `.deb`, `.exe` or `.dmg` naming. Enable a card only when
its binary is available; placeholders and source notes are ignored. The checker
accepts only official `download.php?file=…` links, verifies availability with HEAD,
limits catalogue size to 1 MiB and times out after 12 seconds. A website markup
change that prevents identifying installers produces a recoverable manual-check
error and stays silent during startup.

The current distribution supports guided installation. Fully automatic in-app
installation would require a separate release-feed, signing and platform
installation design. This feature adds no updater dependency or installation
service. Implementation and verification evidence are in
[the validation report](app-updates-validation.md).
