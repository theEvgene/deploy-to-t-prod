export type LogLevel = "step" | "info" | "warn" | "error";

export type LogEntry = {
  time: string;
  level: LogLevel;
  message: string;
};

type LogSink = (entry: LogEntry) => void;

const sinks = new Set<LogSink>();

export const logger = {
  step(message: string): void {
    writeLog("step", message);
  },

  info(message: string): void {
    writeLog("info", message);
  },

  warn(message: string): void {
    writeLog("warn", message);
  },

  error(message: string): void {
    writeLog("error", message);
  },

  addSink(sink: LogSink): () => void {
    sinks.add(sink);
    return () => {
      sinks.delete(sink);
    };
  },
};

function writeLog(level: LogLevel, message: string): void {
  const line = `[${level}] ${message}`;
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    message,
  };

  if (level === "warn") {
    console.warn(line);
  } else if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  for (const sink of sinks) {
    sink(entry);
  }
}
