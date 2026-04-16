import type { Config } from 'jest'
import { resolve } from 'path'

/** Default timeout — generous enough for LLM API calls + tool execution. */
export const JEST_TEST_TIMEOUT = 3 * 60 * 1_000 // 3 minutes

const reporters: Config['reporters'] = ['default']

if (process.env.CI) {
  reporters.push('github-actions')
}

export default async (): Promise<Config> => {
  return {
    clearMocks: true,
    displayName: 'fmw-llmmautojest',
    moduleNameMapper: {
      '^@agent/(.*)$': resolve(__dirname, './src/agent/$1'),
      '^@judge/(.*)$': resolve(__dirname, './src/judge/$1'),
      '^@fixtures/(.*)$': resolve(__dirname, './src/fixtures/$1'),
      '^@support/(.*)$': resolve(__dirname, './src/support/$1'),
      '^@settings$': resolve(__dirname, './src/settings')
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
