type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;

function emit(level: LogLevel, message: string, meta?: LogMeta): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: LogMeta): void => emit('debug', message, meta),
  info: (message: string, meta?: LogMeta): void => emit('info', message, meta),
  warn: (message: string, meta?: LogMeta): void => emit('warn', message, meta),
  error: (message: string, meta?: LogMeta): void => emit('error', message, meta),
};
