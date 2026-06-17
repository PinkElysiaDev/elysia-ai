module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    es2022: true,
    node: true,
  },
  ignorePatterns: [
    'lib/**',
    'node_modules/**',
    '.turbo/**',
    '*.tsbuildinfo',
  ],
  rules: {
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-var': 'error',
    'prefer-const': 'warn',
  },
}
