import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // satellite.js 7.1 exports optional Node/WASM worker backends from its public
  // barrel. Vite scans workers before tree-shaking unused exports. Keep the
  // package's unmodified JS SGP4 exports and omit only that optional export.
  optimizeDeps: { exclude: ['satellite.js'] },
  plugins: [{
    name: 'satellite-js-pure-js', enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/node_modules/satellite.js/dist/index.js')) return;
      const wasmExport = "export * from './wasm/index.js';";
      if (!code.includes(wasmExport)) this.error('Review the pinned satellite.js JS-only build adapter after dependency changes.');
      return { code: code.replace(wasmExport, ''), map: null };
    },
  }],
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },
});
