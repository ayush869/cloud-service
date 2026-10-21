/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  testEnvironment: 'node',
};

module.exports = {
  testTimeout: 60000,
  projects: [
    { ...base, displayName: 'unit', rootDir: '.', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/integration/**/*.e2e-spec.ts', '<rootDir>/test/security/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts'],
    },
  ],
};
