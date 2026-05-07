import pino from "pino"

const LEVEL = process.env.LOG_LEVEL ?? "info"

export const logger = pino({
  level: LEVEL,
  base: { app: "cz-mcp-server" },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export type Logger = typeof logger
