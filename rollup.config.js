import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const production = process.env.BUILD === 'production';

export default [
  {
    input: 'src/content.js',
    output: {
      file: 'dist/content.js',
      format: 'iife',
      sourcemap: !production
    },
    plugins: [
      resolve(),
      commonjs()
    ]
  }
];
