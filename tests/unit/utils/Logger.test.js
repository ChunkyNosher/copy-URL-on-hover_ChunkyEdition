/**
 * Unit tests for Logger utility
 * Tests Gap 7: Structured Logging implementation
 */

import Logger, { LogLevel, createLogger, setGlobalLogLevel } from '../../../src/utils/Logger.js';

describe('Logger', () => {
  let logger;
  let consoleErrorSpy;
  let consoleWarnSpy;
  let consoleInfoSpy;
  let consoleLogSpy;

  beforeEach(() => {
    logger = new Logger('TestComponent');
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('Constructor and Configuration', () => {
    test('should create logger with component name', () => {
      expect(logger.component).toBe('TestComponent');
    });

    test('should use default configuration', () => {
      expect(logger.config.level).toBe(LogLevel.WARN);
      expect(logger.config.enableTimestamp).toBe(true);
      expect(logger.config.enableContext).toBe(true);
      expect(logger.config.prefix).toBe('QuickTabs');
    });

    test('should accept custom configuration', () => {
      const customLogger = new Logger('Custom', {
        level: LogLevel.DEBUG,
        prefix: 'TestApp',
      });
      expect(customLogger.config.level).toBe(LogLevel.DEBUG);
      expect(customLogger.config.prefix).toBe('TestApp');
    });

    test('should create logger via factory function', () => {
      const factoryLogger = createLogger('FactoryComponent');
      expect(factoryLogger.component).toBe('FactoryComponent');
      expect(factoryLogger instanceof Logger).toBe(true);
    });
  });

  describe('Log Level Management', () => {
    test('should set log level', () => {
      logger.setLevel(LogLevel.DEBUG);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    test('should check if level should be logged', () => {
      logger.setLevel(LogLevel.WARN);
      expect(logger.shouldLog(LogLevel.ERROR)).toBe(true);
      expect(logger.shouldLog(LogLevel.WARN)).toBe(true);
      expect(logger.shouldLog(LogLevel.INFO)).toBe(false);
      expect(logger.shouldLog(LogLevel.DEBUG)).toBe(false);
    });

    test('should respect log level in error()', () => {
      logger.setLevel(LogLevel.WARN);
      logger.error('Test error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should respect log level in warn()', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('Test warning');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test('should skip info() when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.info('Test info');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    test('should skip debug() when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.debug('Test debug');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('should log all levels when level is DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.error('error');
      logger.warn('warn');
      logger.info('info');
      logger.debug('debug');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Message Formatting', () => {
    test('should format message with timestamp', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Test message');
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    test('should format message with level name', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Test message');
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('[DEBUG]');
    });

    test('should format message with prefix and component', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Test message');
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('[QuickTabs:TestComponent]');
    });

    test('should include message text', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Test message');
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('Test message');
    });

    test('should format message without timestamp when disabled', () => {
      const noTimestampLogger = new Logger('Test', { enableTimestamp: false, level: LogLevel.DEBUG });
      noTimestampLogger.debug('Test');
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Context Logging', () => {
    test('should log context data', () => {
      logger.setLevel(LogLevel.DEBUG);
      const context = { userId: '123', action: 'test' };
      logger.debug('Test with context', context);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test with context'),
        context
      );
    });

    test('should skip context when empty', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Test without context');
      expect(consoleLogSpy.mock.calls[0].length).toBe(1);
    });

    test('should skip context when disabled', () => {
      const noContextLogger = new Logger('Test', {
        enableContext: false,
        level: LogLevel.DEBUG,
      });
      noContextLogger.debug('Test', { data: 'value' });
      expect(consoleLogSpy.mock.calls[0].length).toBe(1);
    });
  });

  describe('Performance Timing', () => {
    test('should start and end timer', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.startTimer('test-operation');
      expect(logger.timers.has('test-operation')).toBe(true);
      const duration = logger.endTimer('test-operation');
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(logger.timers.has('test-operation')).toBe(false);
    });

    test('should log timer completion', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.startTimer('test-op');
      logger.endTimer('test-op', 'Operation completed');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Operation completed'),
        expect.objectContaining({
          duration: expect.stringMatching(/\d+\.\d{2}ms/),
          durationMs: expect.any(Number),
        })
      );
    });

    test('should warn on slow operations (>100ms)', async () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.startTimer('slow-op');
      await new Promise((resolve) => setTimeout(resolve, 110));
      logger.endTimer('slow-op');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SLOW'),
        expect.objectContaining({
          durationMs: expect.any(Number),
        })
      );
    });

    test('should warn if timer not found', () => {
      logger.setLevel(LogLevel.WARN);
      const duration = logger.endTimer('nonexistent');
      expect(duration).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Timer 'nonexistent' not found")
      );
    });

    test('should skip timing when disabled', () => {
      const noTimingLogger = new Logger('Test', {
        enablePerformanceTiming: false,
        level: LogLevel.DEBUG,
      });
      noTimingLogger.startTimer('test');
      expect(noTimingLogger.timers.size).toBe(0);
      const duration = noTimingLogger.endTimer('test');
      expect(duration).toBeNull();
    });
  });

  describe('State Snapshots', () => {
    test('should log state snapshot', () => {
      logger.setLevel(LogLevel.DEBUG);
      const state = { count: 5, active: true };
      logger.snapshot(state);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('State Snapshot'),
        expect.objectContaining({ state })
      );
    });

    test('should log snapshot with custom label', () => {
      logger.setLevel(LogLevel.DEBUG);
      const state = { data: 'test' };
      logger.snapshot(state, 'Custom Snapshot');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Custom Snapshot'),
        expect.objectContaining({ state })
      );
    });

    test('should skip snapshot when level too low', () => {
      logger.setLevel(LogLevel.WARN);
      logger.snapshot({ data: 'test' });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('Child Loggers', () => {
    test('should create child logger with nested component name', () => {
      const childLogger = logger.child('SubComponent');
      expect(childLogger.component).toBe('TestComponent.SubComponent');
    });

    test('should inherit parent configuration', () => {
      logger.setLevel(LogLevel.DEBUG);
      const childLogger = logger.child('SubComponent');
      expect(childLogger.config.level).toBe(LogLevel.DEBUG);
      expect(childLogger.config.prefix).toBe('QuickTabs');
    });

    test('should allow child-specific configuration', () => {
      const childLogger = logger.child('SubComponent', {
        level: LogLevel.ERROR,
      });
      expect(childLogger.config.level).toBe(LogLevel.ERROR);
    });

    test('should log with nested component name', () => {
      logger.setLevel(LogLevel.DEBUG);
      const childLogger = logger.child('SubComponent');
      childLogger.debug('Child message');
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('[QuickTabs:TestComponent.SubComponent]');
    });
  });

  describe('Log Grouping', () => {
    let consoleGroupSpy;
    let consoleGroupEndSpy;

    beforeEach(() => {
      consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation();
      consoleGroupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation();
    });

    afterEach(() => {
      consoleGroupSpy.mockRestore();
      consoleGroupEndSpy.mockRestore();
    });

    test('should start log group', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.startGroup('Test Group');
      expect(consoleGroupSpy).toHaveBeenCalledWith(
        expect.stringContaining('[QuickTabs:TestComponent] Test Group')
      );
    });

    test('should end log group', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.endGroup();
      expect(consoleGroupEndSpy).toHaveBeenCalled();
    });

    test('should skip grouping when level too low', () => {
      logger.setLevel(LogLevel.WARN);
      logger.startGroup('Test');
      logger.endGroup();
      expect(consoleGroupSpy).not.toHaveBeenCalled();
      expect(consoleGroupEndSpy).not.toHaveBeenCalled();
    });
  });

  describe('Global Log Level', () => {
    test('should set global log level', () => {
      setGlobalLogLevel(LogLevel.ERROR);
      const newLogger = createLogger('GlobalTest');
      expect(newLogger.config.level).toBe(LogLevel.ERROR);
    });
  });

  describe('Error Logging', () => {
    test('should log errors with ERROR level', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('Critical error', { code: 500 });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.objectContaining({ code: 500 })
      );
    });
  });

  describe('Warning Logging', () => {
    test('should log warnings with WARN level', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('Warning message', { reason: 'test' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]'),
        expect.objectContaining({ reason: 'test' })
      );
    });
  });

  describe('Info Logging', () => {
    test('should log info with INFO level', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('Info message', { status: 'ok' });
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.objectContaining({ status: 'ok' })
      );
    });
  });
});
