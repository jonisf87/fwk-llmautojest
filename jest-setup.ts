// Configure Jest to retry failed tests (handles transient LLM API errors)
jest.retryTimes(2, { logErrorsBeforeRetry: true })
