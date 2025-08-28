import z from "zod";
import { server } from "../index.js";
import { spawn } from "child_process";
import { platform } from "os";
import path from "path";

server.tool(
  "run_shell_command",
  "Executes a shell command and returns the output. On Windows, commands are executed via cmd.exe. On Unix-like systems, commands are executed via bash. The tool returns stdout, stderr, exit code, and execution details.",
  {
    command: z
      .string()
      .describe(
        "The shell command to execute. On Windows: executed as 'cmd.exe /c <command>'. On Unix: executed as 'bash -c <command>'."
      ),
    description: z
      .string()
      .optional()
      .describe(
        "Optional brief description of what the command does for clarity and context."
      ),
    directory: z
      .string()
      .optional()
      .describe(
        "Optional working directory to execute the command in. Must be an absolute path. If not provided, uses the current working directory."
      ),
    timeout: z
      .number()
      .optional()
      .describe(
        "Optional timeout in milliseconds. Command will be terminated if it exceeds this duration. Default is 30000ms (30 seconds)."
      ),
  },
  async ({ command, description, directory, timeout = 30000 }) => {
    try {
      if (!command.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Command cannot be empty.",
            },
          ],
        };
      }

      const isWindows = platform() === "win32";
      const workingDir = directory || process.cwd();

      // Validate directory exists
      try {
        const fs = await import("fs");
        const stats = fs.statSync(workingDir);
        if (!stats.isDirectory()) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Specified directory is not a directory: ${workingDir}`,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Directory does not exist or is not accessible: ${workingDir}`,
            },
          ],
        };
      }

      // Setup command execution based on platform
      const shellCommand = isWindows ? "cmd.exe" : "bash";
      const shellArgs = isWindows ? ["/c", command] : ["-c", command];

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let isTimedOut = false;

        const child = spawn(shellCommand, shellArgs, {
          cwd: workingDir,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
          isTimedOut = true;
          child.kill("SIGTERM");

          // Force kill after additional 5 seconds if still running
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          }, 5000);
        }, timeout);

        // Collect stdout
        child.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        // Collect stderr
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        // Handle process completion
        child.on("close", (exitCode, signal) => {
          clearTimeout(timeoutId);

          let resultText = "";

          if (isTimedOut) {
            resultText = `Command timed out after ${timeout}ms and was terminated.\n`;
          }

          resultText += [
            `Command: ${command}`,
            `Directory: ${workingDir}`,
            `Platform: ${isWindows ? "Windows (cmd.exe)" : "Unix (bash)"}`,
            description ? `Description: ${description}` : "",
            `Exit Code: ${
              exitCode !== null ? exitCode : "(terminated by signal)"
            }`,
            `Signal: ${signal || "(none)"}`,
            `Stdout: ${stdout || "(empty)"}`,
            `Stderr: ${stderr || "(empty)"}`,
            isTimedOut
              ? `Status: TIMEOUT`
              : exitCode === 0
              ? `Status: SUCCESS`
              : `Status: ERROR`,
          ]
            .filter(Boolean)
            .join("\n");

          resolve({
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
          });
        });

        // Handle spawn errors
        child.on("error", (error) => {
          clearTimeout(timeoutId);
          resolve({
            content: [
              {
                type: "text",
                text: `Error executing command: ${error.message}\nCommand: ${command}\nDirectory: ${workingDir}`,
              },
            ],
          });
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : "Unknown error occurred"
            }`,
          },
        ],
      };
    }
  }
);
