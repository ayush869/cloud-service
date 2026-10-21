/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }] },
  testEnvironment: 'node',
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', rootDir: '.', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/{integration,security}/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts'],
      testTimeout: 60000,
    },
  ],
};
