import z from "zod";
import { server } from "../index.js";
import { readFileSync, existsSync, statSync } from "fs";
import { relative, extname } from "path";
import { glob } from "fast-glob";
// Register read_many_files tool
server.tool("read_many_files", "Reads content from multiple files specified by paths or glob patterns. Concatenates text file contents with separators. Supports recursive directory traversal and file filtering. Useful for getting an overview of multiple files or analyzing codebases.", {
    paths: z.array(z.string()).min(1).describe("Array of file paths or glob patterns to read. Examples: ['src/**/*.ts'], ['README.md', 'docs/']"),
    include: z.array(z.string()).optional().describe("Additional glob patterns to include. Merged with paths. Example: ['*.test.ts']"),
    exclude: z.array(z.string()).optional().describe("Glob patterns to exclude. Example: ['node_modules/**', '*.log']"),
    recursive: z.boolean().optional().default(true).describe("Whether to search directories recursively"),
    max_files: z.number().optional().default(50).describe("Maximum number of files to read (default: 50)"),
    max_lines_per_file: z.number().optional().default(1000).describe("Maximum lines to read per file (default: 1000)"),
}, async ({ paths, include = [], exclude = [], recursive = true, max_files = 50, max_lines_per_file = 1000 }) => {
    try {
        const cwd = process.cwd();
        const allPatterns = [...paths, ...include];
        // Build glob options
        const globOptions = {
            cwd,
            absolute: true,
            dot: true,
            ignore: [
                'node_modules/**',
                '.git/**',
                'dist/**',
                'build/**',
                '*.log',
                ...exclude
            ]
        };
        if (!recursive) {
            globOptions.deep = 1;
        }
        // Find all matching files
        const filePaths = await glob(allPatterns, globOptions);
        if (filePaths.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No files found matching the specified patterns.",
                    },
                ],
            };
        }
        // Convert Entry objects to strings and limit number of files
        const stringPaths = filePaths.map(entry => typeof entry === 'string' ? entry : entry.path);
        const filesToRead = stringPaths.slice(0, max_files);
        const skippedCount = stringPaths.length - filesToRead.length;
        let result = "";
        let processedCount = 0;
        let skippedFiles = [];
        for (const filePath of filesToRead) {
            try {
                // Check if file exists and is readable
                if (!existsSync(filePath)) {
                    skippedFiles.push(`${relative(cwd, filePath)} (file not found)`);
                    continue;
                }
                const stats = statSync(filePath);
                if (!stats.isFile()) {
                    skippedFiles.push(`${relative(cwd, filePath)} (not a file)`);
                    continue;
                }
                // Read file content
                const content = readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const relativePath = relative(cwd, filePath);
                // Check if file is binary or too large
                const fileExt = extname(filePath).toLowerCase();
                const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.tar', '.gz'];
                const isBinary = binaryExtensions.includes(fileExt) ||
                    content.includes('\0') || // Null bytes indicate binary
                    stats.size > 1024 * 1024; // > 1MB
                if (isBinary) {
                    skippedFiles.push(`${relativePath} (binary file)`);
                    continue;
                }
                // Truncate if too many lines
                let fileContent = content;
                let isTruncated = false;
                if (lines.length > max_lines_per_file) {
                    fileContent = lines.slice(0, max_lines_per_file).join('\n');
                    isTruncated = true;
                }
                // Add file separator and content
                result += `--- ${relativePath} ---\n`;
                result += fileContent;
                if (isTruncated) {
                    result += `\n\n[TRUNCATED: File has ${lines.length} lines, showing first ${max_lines_per_file}]\n`;
                }
                result += '\n\n';
                processedCount++;
            }
            catch (error) {
                const relativePath = relative(cwd, filePath);
                skippedFiles.push(`${relativePath} (read error: ${error instanceof Error ? error.message : 'Unknown error'})`);
            }
        }
        // Add summary
        let summary = `## Read Many Files Result\n\n`;
        summary += `**Processed:** ${processedCount} files\n`;
        if (skippedCount > 0) {
            summary += `**Total found:** ${filePaths.length} files (${skippedCount} skipped due to limit)\n`;
        }
        if (skippedFiles.length > 0) {
            summary += `\n**Skipped files:**\n`;
            skippedFiles.slice(0, 10).forEach(file => {
                summary += `- ${file}\n`;
            });
            if (skippedFiles.length > 10) {
                summary += `- ... and ${skippedFiles.length - 10} more\n`;
            }
        }
        if (processedCount === 0) {
            summary += `\nNo files could be read. All matching files were skipped or had errors.\n`;
        }
        result = summary + '\n' + result;
        // Final truncation check for very large results
        const maxResultLength = 100000; // ~100KB limit
        if (result.length > maxResultLength) {
            result = result.substring(0, maxResultLength) +
                '\n\n[RESULT TRUNCATED: Output too large. Consider using more specific patterns or reducing max_files/max_lines_per_file.]';
        }
        return {
            content: [
                {
                    type: "text",
                    text: result.trim(),
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error reading files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
            ],
        };
    }
});
