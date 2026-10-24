import type { Config } from 'jest'

/** Default timeout — generous enough for LLM API calls + tool execution. */
export const JEST_TEST_TIMEOUT = 3 * 60 * 1_000 // 3 minutes

const reporters: Config['reporters'] = ['default']

if (process.env.CI) {
  reporters.push('github-actions')
}

export default async (): Promise<Config> => {
  return {
    clearMocks: true,
    displayName: 'fwk-llmautojest',
    moduleNameMapper: {
      '^@agent/(.*)$': '<rootDir>/src/agent/$1',
      '^@judge/(.*)$': '<rootDir>/src/judge/$1',
      '^@fixtures/(.*)$': '<rootDir>/src/fixtures/$1',
      '^@support/(.*)$': '<rootDir>/src/support/$1',
      '^@settings$': '<rootDir>/src/settings'
    },
    testPathIgnorePatterns: [
      '<rootDir>/jest.config.ts',
      '<rootDir>/node_modules/',
      '<rootDir>/dist/'
    ],
    resetMocks: true,
    resetModules: true,
    setupFilesAfterEnv: ['./jest-setup.ts'],
    testTimeout: JEST_TEST_TIMEOUT,
    transform: {
      '\\.ts$': '@swc/jest'
    },
    verbose: true,
    reporters
  }
}
