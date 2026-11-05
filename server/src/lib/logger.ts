import { pino } from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  ...(config.env === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  }),
});

export type Logger = typeof logger;
