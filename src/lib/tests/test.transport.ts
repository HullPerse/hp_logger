export { captureLogger, createCaptureTransport, withMutedConsole } from "../../testing/index.js";

interface CapturedConsole {
  outputs: string[];
  restore: () => void;
}

export const captureConsole = (): CapturedConsole => {
  const outputs: string[] = [];
  const original = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const capture = (...values: unknown[]): void => {
    outputs.push(values.map(String).join(" "));
  };
  console.debug = capture;
  console.error = capture;
  console.log = capture;
  console.warn = capture;
  return {
    outputs,
    restore: () => {
      console.debug = original.debug;
      console.error = original.error;
      console.log = original.log;
      console.warn = original.warn;
    },
  };
};

