import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let logStream = null;
let logPathValue = "agent.log";

export const logger = {
  setPath(newPath) {
    logPathValue = newPath;
    if (logStream) {
      logStream.end();
      logStream = null;
    }
  },

  info(...parts) {
    this.write("INFO", ...parts);
  },

  warn(...parts) {
    this.write("WARN", ...parts);
  },

  error(...parts) {
    this.write("ERROR", ...parts);
  },

  write(level, ...parts) {
    const line = new Date().toISOString() + " [" + level + "] " + parts.join(" ");

    if (!logStream) {
      logPathValue = path.resolve(logPathValue);
      if (!fs.existsSync(path.dirname(logPathValue))) {
        fs.mkdirSync(path.dirname(logPathValue), { recursive: true });
      }
      logStream = fs.createWriteStream(logPathValue, { flags: "a" });
    }

    logStream.write(line + "\n");

    if (level === "ERROR") {
      console.error(line);
    } else {
      console.log(line);
    }
  },
};
