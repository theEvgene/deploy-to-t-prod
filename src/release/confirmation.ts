import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { UserAbortError, throwIfAborted } from "../utils/abort.js";

const yesAnswers = new Set(["yes", "y", "\u0434\u0430"]);
const noAnswers = new Set(["exit", "n", "no", "\u043d\u0435\u0442"]);

export async function askReleaseConfirmation(signal: AbortSignal): Promise<boolean> {
  const readline = createInterface({ input, output });
  const closeOnAbort = (): void => {
    readline.close();
  };

  signal.addEventListener("abort", closeOnAbort, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const answer = (await readline.question("Continue and create tag? [yes/no]: ")).trim().toLowerCase();
      throwIfAborted(signal);

      if (yesAnswers.has(answer)) {
        return true;
      }

      if (noAnswers.has(answer)) {
        return false;
      }

      console.log("Please answer yes/y/da or no/n/net/exit.");
    }
  } catch (error) {
    if (signal.aborted) {
      throw new UserAbortError();
    }

    throw error;
  } finally {
    signal.removeEventListener("abort", closeOnAbort);
    readline.close();
  }
}

