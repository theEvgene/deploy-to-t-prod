import { stdin as input, stdout as output } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface as createPromisesInterface } from "node:readline/promises";

import { logger } from "../logger.js";
import {
  formatConfigForDisplay,
  getConfigFilePath,
  readConfig,
  setGitLabBaseUrl,
  setGitLabToken,
  setManualJobName,
  setProjectPath,
} from "./configStore.js";

export async function runConfigMenu(): Promise<number> {
  logger.step("Opening config menu");
  logger.info(`Local config path: ${getConfigFilePath()}`);

  let readline = createPromisesInterface({ input, output });

  while (true) {
    printMenu();
    const choice = await askMenuChoice(readline);
    if (choice === undefined) {
      logger.info("Config menu closed.");
      return 0;
    }

    if (choice === "1") {
      readline.close();
      const token = await askSecret("Enter GitLab access token: ");
      readline = createPromisesInterface({ input, output });

      if (!token) {
        logger.warn("Token was not changed: empty value.");
        continue;
      }

      await setGitLabToken(token);
      logger.info("GitLab token saved.");
      continue;
    }

    if (choice === "2") {
      const manualJobName = (await readline.question("Enter manual job name: ")).trim();
      if (!manualJobName) {
        logger.warn("Manual job name was not changed: empty value.");
        continue;
      }

      await setManualJobName(manualJobName);
      logger.info("Manual job name saved.");
      continue;
    }

    if (choice === "3") {
      const gitlabBaseUrl = (await readline.question("Enter GitLab URL: ")).trim();
      if (!gitlabBaseUrl) {
        logger.warn("GitLab URL was not changed: empty value.");
        continue;
      }

      await setGitLabBaseUrl(gitlabBaseUrl);
      logger.info("GitLab URL saved.");
      continue;
    }

    if (choice === "4") {
      const projectPath = (await readline.question("Enter project path or id: ")).trim();
      if (!projectPath) {
        logger.warn("Project path/id was not changed: empty value.");
        continue;
      }

      await setProjectPath(projectPath);
      logger.info("Project path/id saved.");
      continue;
    }

    if (choice === "5") {
      const config = await readConfig();
      for (const line of formatConfigForDisplay(config)) {
        logger.info(line);
      }
      continue;
    }

    if (choice === "6" || choice.toLowerCase() === "exit") {
      logger.info("Config menu closed.");
      readline.close();
      return 0;
    }

    logger.warn("Unknown option. Choose 1, 2, 3, 4, 5, or 6.");
  }
}

async function askMenuChoice(readline: ReturnType<typeof createPromisesInterface>): Promise<string | undefined> {
  try {
    return (await readline.question("Choose option: ")).trim();
  } catch (error) {
    if (error instanceof Error && error.message.includes("readline was closed")) {
      return undefined;
    }

    throw error;
  }
}

function printMenu(): void {
  console.log("");
  console.log("Config menu");
  console.log("1. Set/update GitLab token");
  console.log("2. Set manual job name");
  console.log("3. Set GitLab URL");
  console.log("4. Set project path or id");
  console.log("5. Show current config");
  console.log("6. Exit");
}

async function askSecret(question: string): Promise<string> {
  if (!input.isTTY) {
    const readline = createPromisesInterface({ input, output });
    try {
      return (await readline.question(question)).trim();
    } finally {
      readline.close();
    }
  }

  output.write(question);
  input.setRawMode(true);
  input.resume();
  emitKeypressEvents(input);

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      input.setRawMode(false);
      input.off("keypress", onKeypress);
    };

    const onKeypress = (character: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Execution stopped by user."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        output.write("\n");
        cleanup();
        resolve(value.trim());
        return;
      }

      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }

      if (character && !key.ctrl) {
        value += character;
      }
    };

    input.on("keypress", onKeypress);
  });
}
