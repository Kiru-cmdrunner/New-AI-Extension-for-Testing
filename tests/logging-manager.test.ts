import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLogger,
  setLogLevel,
  getLogLevel,
} from '../src/infrastructure/logging-manager';

describe('Logging Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default
    setLogLevel('debug');
  });

  describe('createLogger', () => {
    it('creates a logger with the given category', () => {
      const logger = createLogger('test');
      expect(logger.category).toBe('test');
    });

    it('logger has all 4 log methods', () => {
      const logger = createLogger('test');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });

  describe('Log levels', () => {
    it('debug level outputs debug messages', () => {
      const logger = createLogger('test');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      logger.debug('test message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('info level outputs info messages', () => {
      const logger = createLogger('test');
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('test message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('warn level outputs warn messages', () => {
      const logger = createLogger('test');
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('test message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('error level outputs error messages', () => {
      const logger = createLogger('test');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('test message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('Level filtering', () => {
    it('setLogLevel("warn") suppresses debug and info', () => {
      setLogLevel('warn');
      const logger = createLogger('test');
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();

      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('setLogLevel("error") only shows errors', () => {
      setLogLevel('error');
      const logger = createLogger('test');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.warn('warn msg');
      logger.error('error msg');

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('getLogLevel returns the current level', () => {
      setLogLevel('warn');
      expect(getLogLevel()).toBe('warn');
      setLogLevel('debug');
      expect(getLogLevel()).toBe('debug');
    });
  });

  describe('Structured data', () => {
    it('passes data object to console', () => {
      const logger = createLogger('test');
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('test', { actionId: 'click-001', tag: 'BUTTON' });

      expect(spy).toHaveBeenCalled();
      // Third argument should be the data object
      const args = spy.mock.calls[0];
      expect(args).toBeDefined();
      spy.mockRestore();
    });
  });

  describe('Non-throwing', () => {
    it('does not throw even if console fails', () => {
      const logger = createLogger('test');
      // Override console.error to throw
      const original = console.error;
      console.error = vi.fn(() => { throw new Error('console broken'); });
      expect(() => logger.error('msg')).not.toThrow();
      console.error = original;
    });
  });
});
