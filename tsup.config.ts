import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  // TypeScript 7 broke rollup-plugin-dts (same issue the main temporal-fmt
  // package hits — see its tsup.config.ts comment). Declarations come from
  // a plain `tsc --declaration` pass in the build script instead.
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'esnext',
  // No shebang banner — ESM modules can't start with `#!`. The package's
  // `bin` field points at dist/cli.js; npm's bin-linking mechanism adds
  // the shebang when symlinking the bin, so `npx temporal-fmt-codemod`
  // works. Direct `node dist/cli.js` works too because Node treats the
  // first line as a comment if it starts with `#!`.
});
