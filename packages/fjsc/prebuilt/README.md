# prebuilt

Drop zone for the binaries the `Build fjsc binaries` GitHub Actions workflow
produces, one directory per target:

```
prebuilt/linux-x64/fjsc
prebuilt/linux-arm64/fjsc
prebuilt/win32-x64/fjsc.exe
```

**Not committed** — everything here except this README is gitignored. Download
the workflow's `fjsc-prebuilt` artifact, unzip it into `packages/fjsc/`, run
`node packages/fjsc/build.mjs --all`, publish, and the files can go away.

`build.mjs` packages these instead of compiling when they are present. macOS
targets are normally absent — a macOS dev machine compiles those itself.

Re-run the workflow whenever `packages/flutter_fjs/native/` changes: a `fjsc`
built from different QuickJS-ng sources than the runtime embeds produces bundles
the engine refuses to load.
