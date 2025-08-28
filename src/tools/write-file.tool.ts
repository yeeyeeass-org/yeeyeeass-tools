import z from "zod";
import { server } from "../index.js";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// Register write_file tool
server.tool(
  "write_file",
  "Writes content to a specified file. Creates directories if they don't exist. Can overwrite existing files.",
  {
    file_path: z.string().describe("The absolute path to the file to write to (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path."),
    content: z.string().describe("The content to write to the file."),
    overwrite: z.boolean().optional().describe("Whether to overwrite the file if it exists."),
  },
  async ({ file_path, content, overwrite }) => {
    try {
      // Check if file exists and overwrite is false
      if (!overwrite && existsSync(file_path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File already exists at ${file_path}. Set overwrite=true to overwrite it.`,
            },
          ],
        };
      }

      // Create directory if it doesn't exist
      const dir = dirname(file_path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Write the file
      writeFileSync(file_path, content, 'utf-8');

      const fileExists = existsSync(file_path);
      const message = fileExists
        ? `Successfully wrote to file: ${file_path}`
        : `Successfully created new file: ${file_path}`;

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error writing to file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  },
);