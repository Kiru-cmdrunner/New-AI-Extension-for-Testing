import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  createError,
  createErrorFromException,
  logError,
  isRecoverable,
  isAIError,
  isStorageError,
} from '../src/infrastructure/error-handler';

describe('Error Handler', () => {

  describe('createError', () => {
    it('creates an error with all required fields', () => {
      const error = createError(ErrorCode.AI_TIMEOUT, 'AI timed out', 'AIObserver');
      expect(error.code).toBe(ErrorCode.AI_TIMEOUT);
      expect(error.message).toBe('AI timed out');
      expect(error.component).toBe('AIObserver');
      expect(error.recoverable).toBe(true);
    });

    it('includes context when provided', () => {
      const error = createError('CUSTOM', 'msg', 'Comp', { stepId: 'step-001' });
      expect(error.context?.stepId).toBe('step-001');
    });

    it('omits context when not provided', () => {
      const error = createError('CUSTOM', 'msg', 'Comp');
      expect(error.context).toBeUndefined();
    });

    it('marks recoverable codes as recoverable', () => {
      expect(createError(ErrorCode.AI_TIMEOUT, 'msg', 'C').recoverable).toBe(true);
      expect(createError(ErrorCode.AI_RATE_LIMIT, 'msg', 'C').recoverable).toBe(true);
      expect(createError(ErrorCode.SW_RESTART_DETECTED, 'msg', 'C').recoverable).toBe(true);
      expect(createError(ErrorCode.NAVIGATION_DEBOUNCE, 'msg', 'C').recoverable).toBe(true);
    });

    it('marks non-recoverable codes as not recoverable', () => {
      expect(createError(ErrorCode.ELEMENT_NOT_FOUND, 'msg', 'C').recoverable).toBe(false);
      expect(createError(ErrorCode.GENERATION_FAILED, 'msg', 'C').recoverable).toBe(false);
      expect(createError(ErrorCode.LOCATOR_RESOLUTION_FAILED, 'msg', 'C').recoverable).toBe(false);
    });
  });

  describe('createErrorFromException', () => {
    it('creates error from Error instance', () => {
      const err = new Error('Something went wrong');
      const error = createErrorFromException(err, 'TestComponent');
      expect(error.message).toBe('Something went wrong');
      expect(error.component).toBe('TestComponent');
      expect(error.context?.name).toBe('Error');
    });

    it('creates error from non-Error value', () => {
      const error = createErrorFromException('string error', 'TestComponent');
      expect(error.message).toBe('string error');
    });

    it('uses fallback code', () => {
      const error = createErrorFromException(new Error('test'), 'C', ErrorCode.STORAGE_WRITE_FAILED);
      expect(error.code).toBe(ErrorCode.STORAGE_WRITE_FAILED);
    });

    it('defaults to GENERATION_FAILED code', () => {
      const error = createErrorFromException(new Error('test'), 'C');
      expect(error.code).toBe(ErrorCode.GENERATION_FAILED);
    });
  });

  describe('logError', () => {
    it('logs and returns the error', () => {
      const error = createError('TEST', 'test message', 'TestComp');
      const result = logError(error);
      expect(result).toBe(error);
    });
  });

  describe('isRecoverable', () => {
    it('returns true for recoverable errors', () => {
      const error = createError(ErrorCode.AI_TIMEOUT, 'msg', 'C');
      expect(isRecoverable(error)).toBe(true);
    });

    it('returns false for non-recoverable errors', () => {
      const error = createError(ErrorCode.GENERATION_FAILED, 'msg', 'C');
      expect(isRecoverable(error)).toBe(false);
    });
  });

  describe('isAIError', () => {
    it('returns true for AI-prefixed codes', () => {
      expect(isAIError(createError(ErrorCode.AI_TIMEOUT, 'm', 'C'))).toBe(true);
      expect(isAIError(createError(ErrorCode.AI_RATE_LIMIT, 'm', 'C'))).toBe(true);
      expect(isAIError(createError(ErrorCode.AI_INVALID_RESPONSE, 'm', 'C'))).toBe(true);
      expect(isAIError(createError(ErrorCode.AI_NOT_CONFIGURED, 'm', 'C'))).toBe(true);
    });

    it('returns false for non-AI codes', () => {
      expect(isAIError(createError(ErrorCode.GENERATION_FAILED, 'm', 'C'))).toBe(false);
      expect(isAIError(createError(ErrorCode.STORAGE_WRITE_FAILED, 'm', 'C'))).toBe(false);
    });
  });

  describe('isStorageError', () => {
    it('returns true for STORAGE-prefixed codes', () => {
      expect(isStorageError(createError(ErrorCode.STORAGE_QUOTA_EXCEEDED, 'm', 'C'))).toBe(true);
      expect(isStorageError(createError(ErrorCode.STORAGE_READ_FAILED, 'm', 'C'))).toBe(true);
      expect(isStorageError(createError(ErrorCode.STORAGE_WRITE_FAILED, 'm', 'C'))).toBe(true);
    });

    it('returns false for non-storage codes', () => {
      expect(isStorageError(createError(ErrorCode.AI_TIMEOUT, 'm', 'C'))).toBe(false);
    });
  });

  describe('ErrorCode constants', () => {
    it('has recording error codes', () => {
      expect(ErrorCode.RECORDING_NOT_ACTIVE).toBeTruthy();
      expect(ErrorCode.ELEMENT_NOT_FOUND).toBeTruthy();
      expect(ErrorCode.IDENTITY_EXTRACTION_FAILED).toBeTruthy();
    });

    it('has generation error codes', () => {
      expect(ErrorCode.GENERATION_FAILED).toBeTruthy();
      expect(ErrorCode.LOCATOR_RESOLUTION_FAILED).toBeTruthy();
    });

    it('has AI error codes', () => {
      expect(ErrorCode.AI_TIMEOUT).toBeTruthy();
      expect(ErrorCode.AI_RATE_LIMIT).toBeTruthy();
      expect(ErrorCode.AI_INVALID_RESPONSE).toBeTruthy();
    });

    it('has storage error codes', () => {
      expect(ErrorCode.STORAGE_QUOTA_EXCEEDED).toBeTruthy();
    });
  });
});
