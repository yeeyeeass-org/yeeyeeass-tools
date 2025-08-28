import z from "zod";
import { server } from "../index.js";
import { readFileSync, statSync } from "fs";
import { extname, relative, resolve, basename } from "path";
import fg from "fast-glob";

// Default exclusion patterns for common files/directories to skip
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.svn/**",
  "**/.hg/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.nyc_output/**",
  "**/tmp/**",
  "**/temp/**",
  "**/*.log",
  "**/*.tmp",
  "**/*.cache",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/*.exe",
  "**/*.dll",
  "**/*.so",
  "**/*.dylib",
  "**/*.bin",
  "**/*.zip",
  "**/*.tar.gz",
  "**/*.rar",
  "**/*.7z",
];

// Register read_many_files tool
server.tool(
  "read_many_files",
  "Reads and concatenates content from multiple files specified by glob patterns. Useful for analyzing codebases, reviewing multiple configuration files, or getting an overview of related files. Handles text files primarily, with optional support for explicitly requested image/PDF files.",
  {
    patterns: z
      .array(z.string())
      .describe(
        "Array of glob patterns to match files (e.g., ['src/**/*.ts', '*.md']). Patterns are relative to the current working directory."
      ),
    exclude: z
      .array(z.string())
      .optional()
      .describe(
        "Optional: Additional glob patterns to exclude files/directories. These are added to default exclusions."
      ),
    use_default_excludes: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Optional: Whether to apply default exclusion patterns (node_modules, .git, build artifacts, etc.). Defaults to true."
      ),
    max_files: z
      .number()
      .optional()
      .default(50)
      .describe(
        "Optional: Maximum number of files to process. Defaults to 50 to prevent overwhelming output."
      ),
    max_file_size: z
      .number()
      .optional()
      .default(100000)
      .describe(
        "Optional: Maximum file size in bytes to process per file. Defaults to 100KB. Larger files will be truncated."
      ),
    include_file_info: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Optional: Whether to include file path separators and metadata in output. Defaults to true."
      ),
  },
  async ({
    patterns,
    exclude = [],
    use_default_excludes = true,
    max_files = 50,
    max_file_size = 100000,
    include_file_info = true,
  }) => {
    try {
      // Prepare exclusion patterns
      const excludePatterns = use_default_excludes
        ? [...DEFAULT_EXCLUDES, ...exclude]
        : [...exclude];

      // Use fast-glob to find matching files
      const matchedFiles = await fg(patterns, {
        ignore: excludePatterns,
        onlyFiles: true,
        dot: false,
        absolute: true,
        suppressErrors: true,
        globstar: true,
      });

      if (matchedFiles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No files found matching patterns: ${patterns.join(
                ", "
              )}\n\nExcluded patterns: ${excludePatterns
                .slice(0, 5)
                .join(", ")}${excludePatterns.length > 5 ? "..." : ""}`,
            },
          ],
        };
      }

      // Sort files for consistent output
      const sortedFiles = matchedFiles.sort();

      // Limit number of files if needed
      const filesToProcess = sortedFiles.slice(0, max_files);
      const filesSkipped = sortedFiles.length - filesToProcess.length;

      const results: string[] = [];
      const processedFiles: string[] = [];
      const skippedFiles: Array<{ path: string; reason: string }> = [];

      // Process each file
      for (const filePath of filesToProcess) {
        try {
          const stats = statSync(filePath);
          const relativePath = relative(process.cwd(), filePath);

          // Check file size
          if (stats.size > max_file_size) {
            // Read truncated content
            const buffer = Buffer.alloc(max_file_size);
            const fd = require("fs").openSync(filePath, "r");
            const bytesRead = require("fs").readSync(
              fd,
              buffer,
              0,
              max_file_size,
              0
            );
            require("fs").closeSync(fd);

            const truncatedContent = buffer
              .subarray(0, bytesRead)
              .toString("utf-8");
            const lines = truncatedContent.split("\n").length;

            if (include_file_info) {
              results.push(
                `--- ${relativePath} ---`,
                `[WARNING: File truncated - showing first ${max_file_size} bytes of ${stats.size} total bytes]`,
                "",
                truncatedContent,
                ""
              );
            } else {
              results.push(truncatedContent);
            }

            processedFiles.push(relativePath);
            continue;
          }

          // Detect file type based on extension
          const fileExtension = extname(filePath).toLowerCase();
          const isTextFile =
            !fileExtension ||
            [
              ".txt",
              ".md",
              ".js",
              ".ts",
              ".jsx",
              ".tsx",
              ".json",
              ".xml",
              ".html",
              ".htm",
              ".css",
              ".scss",
              ".less",
              ".py",
              ".java",
              ".c",
              ".cpp",
              ".h",
              ".hpp",
              ".php",
              ".rb",
              ".go",
              ".rs",
              ".swift",
              ".kt",
              ".scala",
              ".sh",
              ".bash",
              ".yml",
              ".yaml",
              ".toml",
              ".ini",
              ".cfg",
              ".conf",
              ".env",
              ".gitignore",
              ".gitattributes",
              ".editorconfig",
              ".eslintrc",
              ".prettierrc",
              ".dockerfile",
              ".sql",
              ".graphql",
              ".vue",
              ".svelte",
              ".astro",
              ".R",
              ".m",
              ".pl",
              ".ps1",
              ".bat",
              ".cmd",
              ".vbs",
              ".awk",
              ".sed",
              ".tex",
              ".bib",
              ".cls",
              ".sty",
              ".log",
              ".config",
              ".properties",
              ".gradle",
              ".maven",
              ".cmake",
              ".make",
              ".makefile",
              ".lock",
              ".spec",
              ".test",
              ".story",
              ".stories",
            ].includes(fileExtension);

          if (!isTextFile) {
            // Check if this is an explicitly requested non-text file
            const fileName = basename(filePath);
            const explicitlyRequested = patterns.some(
              (pattern) =>
                pattern.includes(fileExtension) ||
                pattern.includes(fileName) ||
                pattern.includes("*" + fileExtension)
            );

            if (!explicitlyRequested) {
              skippedFiles.push({
                path: relativePath,
                reason: `Binary/non-text file (${fileExtension}) not explicitly requested`,
              });
              continue;
            }
          }

          // Read file content
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n").length;

          if (include_file_info) {
            results.push(
              `--- ${relativePath} ---`,
              `[File info: ${lines} lines, ${stats.size} bytes]`,
              "",
              content,
              ""
            );
          } else {
            results.push(content);
          }

          processedFiles.push(relativePath);
        } catch (error) {
          const relativePath = relative(process.cwd(), filePath);
          skippedFiles.push({
            path: relativePath,
            reason: `Error reading file: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          });
        }
      }

      // Build final output
      let finalOutput = "";

      if (include_file_info) {
        finalOutput += `=== READ MANY FILES SUMMARY ===\n`;
        finalOutput += `Processed: ${processedFiles.length} files\n`;

        if (skippedFiles.length > 0) {
          finalOutput += `Skipped: ${skippedFiles.length} files\n`;
        }

        if (filesSkipped > 0) {
          finalOutput += `Truncated: ${filesSkipped} files (exceeded max_files limit of ${max_files})\n`;
        }

        finalOutput += `Patterns: ${patterns.join(", ")}\n\n`;

        if (processedFiles.length > 0) {
          finalOutput += `PROCESSED FILES:\n`;
          processedFiles.forEach((file) => {
            finalOutput += `- ${file}\n`;
          });
          finalOutput += "\n";
        }

        if (skippedFiles.length > 0) {
          finalOutput += `SKIPPED FILES:\n`;
          skippedFiles.slice(0, 10).forEach(({ path, reason }) => {
            finalOutput += `- ${path}: ${reason}\n`;
          });
          if (skippedFiles.length > 10) {
            finalOutput += `- ...and ${skippedFiles.length - 10} more\n`;
          }
          finalOutput += "\n";
        }

        finalOutput += `=== FILE CONTENTS ===\n\n`;
      }

      if (results.length > 0) {
        finalOutput += results.join("\n");

        if (include_file_info) {
          finalOutput += "\n\n=== END OF FILES ===";
        }
      } else {
        finalOutput += "No file content was successfully read.";
      }

      return {
        content: [
          {
            type: "text",
            text: finalOutput,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error processing files: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
        ],
      };
    }
  }
);
