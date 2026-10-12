# S2 health checks and repairs

Open **Settings → Health check → R packages**. The **S2 spherical geometry
engine** result checks loading, a known spherical distance (about 111.195 metres
across 0.001 degrees at the equator), three 100-metre point buffers, their area,
validity and containment. It uses synthetic geometries and never reads project
objects. S2 failures include the original loader or engine message.

If the check fails, select **s2** under **Review package repairs**, save your
project and approve the repair. The backend stops to release loaded libraries,
which clears its in-memory objects. After installation, diagnostics run in a
fresh Rscript with the selected R and its normal startup profile. Approve the
offered R restart to reconnect. An installer warning or an unchanged broken
copy cannot count as an engine passing.

| OS | Automatic package repair | If prerequisites or binaries are missing |
| --- | --- | --- |
| Linux | CRAN source build with `S2_FORCE_BUNDLED_ABSEIL=true` | Install a C++17 compiler, make, CMake, pkg-config and OpenSSL headers, then retry. The review includes commands for Debian/Ubuntu, Fedora/RHEL, Arch and openSUSE. |
| Windows | Compatible CRAN binary for the selected R | Use supported CRAN R with a compatible binary, or manually build from source with the Rtools version matching R. Rtools provides OpenSSL and Abseil for R 4.3 onwards. |
| macOS | Compatible CRAN binary for the selected R and architecture | CRAN R is the binary route. For source-only R, install Xcode Command Line Tools (`xcode-select --install`) and `brew install cmake pkg-config openssl`, then manually build with bundled Abseil. |

The Windows/macOS repair explicitly requests a binary and never silently starts
a source build. Linux bundles Abseil to avoid linking to a system Abseil shared
library that may disappear after an OS update. System prerequisite installation
is shown as instructions; package repair does not invoke sudo or install system
tools. Upstream documents its [system dependencies](https://r-spatial.github.io/s2/)
and the [bundled-Abseil build option](https://github.com/r-spatial/s2/blob/main/configure).

For a manual source build on Linux or macOS, use the repair library printed by
the health check rather than assuming `.libPaths()[1]` is the right destination:

```r
# Replace this with the writable S2 repair library shown by Health check.
repair_library <- "/path/to/your/R/library"
Sys.setenv(S2_FORCE_BUNDLED_ABSEIL = "true")
install.packages("s2", lib = repair_library,
                 repos = "https://cloud.r-project.org", type = "source")
Sys.unsetenv("S2_FORCE_BUNDLED_ABSEIL")
```

On Windows, a manual source build uses the same `install.packages()` command
after installing [matching Rtools](https://cran.r-project.org/bin/windows/Rtools/);
the Unix bundled-Abseil setting is unnecessary. Restart R and rerun diagnostics
after any manual repair. If a CRAN binary is unavailable for the selected R,
review the installer output instead of repeating an unsuccessful binary repair.

S2 normally replaces its active writable copy. If that copy is protected, an
earlier writable library can override it. A lower-priority user library cannot
fix a broken copy selected by a custom `.Rprofile`; configure the library order
in **Packages**, restart R and recheck. Repairs never delete protected copies or
silently rewrite an R profile.

Regression tests cover loader failures, a loaded engine returning an incorrect
distance, Windows/macOS binary routing, Linux environment restoration, missing
build tools and active-library priority. `Rscript scripts/check-s2-repair.R`
downloads and builds CRAN S2 in a disposable `/tmp` library on Linux, checks a
fresh-process failure-to-success transition and verifies the normal S2 binary
is unchanged. After `npm run build`, `node scripts/check-s2-health-ui.mjs`
checks real package diagnostics and captures the engine result in an isolated
built-app profile without approving installations or making AI requests.
Live Windows/macOS installation checks need those machines.

Verified on Linux on 11 October 2026: the real CRAN source repair changed a
broken disposable S2 copy into a passing fresh-process engine, while the normal
S2 binary's checksum stayed unchanged. The built app displayed the engine as
Ready and selected the active custom library as its repair destination. The
40 focused health tests, TypeScript check and production build passed; lint
reported zero errors and the existing 37 warnings. Windows/macOS binary routing
was tested with simulated installers; live installs remain for those machines.
