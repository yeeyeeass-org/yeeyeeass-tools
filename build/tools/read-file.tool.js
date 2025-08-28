import z from "zod";
import { server } from "../index.js";
import { readFileSync } from "fs";
import { extname } from "path";
// Register read_file tool
server.tool("read_file", "Reads and returns the content of a specified file. If the file is large, the content will be truncated. The tool's response will clearly indicate if truncation has occurred and will provide details on how to read more of the file using the 'offset' and 'limit' parameters. Handles text files.", {
    absolute_path: z.string().describe("The absolute path to the file to read (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path."),
    offset: z.number().optional().describe("Optional: For text files, the 0-based line number to start reading from. Requires 'limit' to be set. Use for paginating through large files."),
    limit: z.number().optional().describe("Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. If omitted, reads the entire file (if feasible, up to a default limit)."),
}, async ({ absolute_path, offset, limit }) => {
    try {
        // Read the entire file content
        const fileContent = readFileSync(absolute_path, 'utf-8');
        const lines = fileContent.split('\n');
        const totalLines = lines.length;
        let content = fileContent;
        let isTruncated = false;
        let startLine = 0;
        let endLine = totalLines - 1;
        // Handle pagination with offset and limit
        if (offset !== undefined && limit !== undefined) {
            startLine = offset;
            endLine = Math.min(offset + limit - 1, totalLines - 1);
            content = lines.slice(startLine, endLine + 1).join('\n');
            isTruncated = endLine < totalLines - 1;
        }
        else if (limit !== undefined) {
            // If only limit is provided, read from start
            endLine = Math.min(limit - 1, totalLines - 1);
            content = lines.slice(0, endLine + 1).join('\n');
            isTruncated = endLine < totalLines - 1;
        }
        else {
            // Check if file is too large (arbitrary limit of 1000 lines)
            const maxLines = 1000;
            if (totalLines > maxLines) {
                endLine = maxLines - 1;
                content = lines.slice(0, maxLines).join('\n');
                isTruncated = true;
            }
        }
        let resultContent = content;
        if (isTruncated) {
            const nextOffset = offset ? offset + (endLine - startLine + 1) : endLine + 1;
            resultContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines ${startLine + 1}-${endLine + 1} of ${totalLines} total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: ${nextOffset}.

--- FILE CONTENT (truncated) ---
${content}`;
        }
        // Get file extension for context
        const fileExtension = extname(absolute_path);
        return {
            content: [
                {
                    type: "text",
                    text: resultContent,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
            ],
        };
    }
});
