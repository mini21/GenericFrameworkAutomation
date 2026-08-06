import * as fs from 'fs';
import * as path from 'path';
import winston from 'winston';
import { EnvironmentManager } from '../config/environment-manager';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const messageFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
});

const timestampFormat = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' });

export const logger = winston.createLogger({
  level: EnvironmentManager.logLevel,
  format: winston.format.combine(timestampFormat, messageFormat),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), timestampFormat, messageFormat),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'run.log'),
    }),
  ],
});
