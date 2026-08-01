export default {
  '*': 'prettier --check --ignore-unknown',
  '*.{astro,cjs,cts,js,jsx,mjs,mts,ts,tsx}': 'eslint',
};
