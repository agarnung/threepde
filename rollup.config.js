// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/main.js',  // Ajusta según tu archivo principal
  output: {
    file: 'dist/assets/js/bundle.min.js',
    format: 'iife',       // Bundle en formato autoejecutable para navegador
    name: 'App',
    sourcemap: true
  },
  plugins: [
    resolve(),
    commonjs()
  ]
};
