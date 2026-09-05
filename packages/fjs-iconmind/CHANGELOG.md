# @ufjs/iconmind

## 0.1.3

- First release. `<icon-mind>` renders an [IconMind](https://iconmind.dev) icon
  on both the Flutter host and the web, from the same `@iconmind/icons` set.
  Version 0.1.3 to line up with the rest of the fjs packages; nothing before it
  was published.
- A worked example of what an fjs module is: a JS API, a Vue component, a
  Flutter widget and its autolink entry in one package, plus a `prepare` hook
  that stages the icon data the widget reads.
- The icon's colour comes from its computed style, so `color` on the tag or
  anything it inherits from applies.
- The Flutter side reads its icon data through `FjsEngine.devUri` / `devFetch`,
  which means the dev server in development and the bundled asset in release,
  with no `FJS_DEV` dart-define and no `HttpClient` of its own. Needs
  `flutter_fjs` >= 0.1.3.

## Requirements

- `@ufjs/cli` >= 0.1.3 and `flutter_fjs` >= 0.1.3.
