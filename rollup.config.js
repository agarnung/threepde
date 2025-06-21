import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/assets/js/bundle.min.js',
    format: 'es', // Use ES modules
    sourcemap: true
  },
  plugins: [
    nodeResolve(),
    commonjs()
  ],
  external: ['three'] // Keep Three.js as external since we are using CDN
};