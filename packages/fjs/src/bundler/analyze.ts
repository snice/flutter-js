// fjs build --analyze — where the bytes went.
//
// The number that decides startup cost on a phone is the size of each
// .fjsbundle, and the number that decides whether a page split paid off is
// how much of the app sits in shared.js. Both come out of esbuild's
// metafile, which the build only asks for when this flag is on.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Metafile } from 'esbuild';
import type { BuildResult } from './build.js';

/** Inputs smaller than this share of an output are rolled into "other". */
const MIN_SHARE = 0.02;
const MAX_ROWS = 6;

interface Artifact {
  label: string;
  jsPath: string;
  bytecodePath?: string;
  metafile?: Metafile;
}

export function printAnalysis(res: BuildResult, outDir: string): void {
  const root = process.cwd();
  const artifacts: Artifact[] = [];
  if (res.sharedPath) {
    artifacts.push({
      label: 'shared.js',
      jsPath: res.sharedPath,
      bytecodePath: res.sharedBytecodePath,
      metafile: res.metafiles?.[res.sharedPath],
    });
  }
  artifacts.push({
    label: path.relative(path.resolve(outDir), res.jsPath) || path.basename(res.jsPath),
    jsPath: res.jsPath,
    bytecodePath: res.bytecodePath,
    metafile: res.metafiles?.[res.jsPath],
  });
  for (const [chunk, file] of Object.entries(res.pageChunks ?? {})) {
    artifacts.push({
      label: path.relative(path.resolve(outDir), file),
      jsPath: file,
      bytecodePath: res.pageBytecodeChunks?.[chunk],
      metafile: res.metafiles?.[file],
    });
  }

  // a split web build emits chunks nobody named: pick them out of the
  // metafile so they are not silently missing from the report
  for (const artifact of [...artifacts]) {
    if (!artifact.metafile) continue;
    for (const output of Object.keys(artifact.metafile.outputs)) {
      if (output.endsWith('.map')) continue;
      const abs = path.resolve(root, output);
      if (artifacts.some((a) => path.resolve(a.jsPath) === abs)) continue;
      artifacts.push({
        label: path.relative(path.resolve(outDir), abs),
        jsPath: abs,
        metafile: artifact.metafile,
      });
    }
  }

  console.log(`\nanalyze — ${path.relative(root, path.resolve(outDir)) || outDir}`);

  let totalJs = 0;
  let totalGz = 0;
  let totalCode = 0;
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact.jsPath)) continue;
    const js = fs.readFileSync(artifact.jsPath);
    const gz = zlib.gzipSync(js).length;
    const code = artifact.bytecodePath && fs.existsSync(artifact.bytecodePath)
      ? fs.statSync(artifact.bytecodePath).size
      : undefined;
    totalJs += js.length;
    totalGz += gz;
    totalCode += code ?? 0;

    console.log(
      `\n${artifact.label}  ${human(js.length)}  gz ${human(gz)}${
        code === undefined ? '' : `  bytecode ${human(code)}`
      }`,
    );
    for (const [name, bytes] of breakdown(artifact, js.length)) {
      console.log(
        `  ${trim(name).padEnd(38)} ${human(bytes).padStart(9)}  ${percent(bytes / js.length)}`,
      );
    }
  }

  console.log(
    `\ntotal  ${human(totalJs)}  gz ${human(totalGz)}${
      totalCode > 0 ? `  bytecode ${human(totalCode)}` : ''
    }`,
  );
  if (!artifacts.some((a) => a.metafile)) {
    console.log('(no module breakdown: this build mode does not emit a metafile)');
  }
}

/** Per-package contributions to one output, largest first. Sizes are the
 * bytes each input contributed *to this output*, not the size of the module
 * on disk. Everything below the threshold — plus whatever the bundler adds
 * on top of the inputs (the IIFE wrapper, its helpers) — lands in "other",
 * so the column always adds up to the file. */
function breakdown(artifact: Artifact, fileBytes: number): Array<[string, number]> {
  const metafile = artifact.metafile;
  if (!metafile) return [];
  const output = metafile.outputs[normalize(artifact.jsPath)];
  if (!output) return [];

  const groups = new Map<string, number>();
  let attributed = 0;
  for (const [input, info] of Object.entries(output.inputs)) {
    const name = group(input);
    groups.set(name, (groups.get(name) ?? 0) + info.bytesInOutput);
    attributed += info.bytesInOutput;
  }

  const rows: Array<[string, number]> = [];
  let other = Math.max(fileBytes - attributed, 0);
  for (const [name, bytes] of [...groups].sort((a, b) => b[1] - a[1])) {
    if (rows.length < MAX_ROWS && bytes / fileBytes >= MIN_SHARE) rows.push([name, bytes]);
    else other += bytes;
  }
  if (other > 0) rows.push(['other', other]);
  return rows;
}

/** Keeps the tail: the end of a path says more than its root. */
function trim(name: string, width = 38): string {
  return name.length <= width ? name : '…' + name.slice(name.length - width + 1);
}

/** node_modules paths collapse to the package; project files stay whole —
 * "vue" is the useful unit on one side, "src/pages/index.vue" on the other. */
function group(input: string): string {
  const marker = input.lastIndexOf('node_modules/');
  if (marker >= 0) {
    const rest = input.slice(marker + 'node_modules/'.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  return input;
}

/** Metafile keys are cwd-relative with forward slashes. */
function normalize(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`.padStart(6);
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
