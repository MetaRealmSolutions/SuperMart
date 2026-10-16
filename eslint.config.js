const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'data/*', '.expo/*', 'electron/*'] },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Data-loading hooks intentionally set state from effects.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
