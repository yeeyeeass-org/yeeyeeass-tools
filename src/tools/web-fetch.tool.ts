import z from "zod";
import { server } from "../index.js";
import { convert } from "html-to-text";
import { URL } from "url"; // Explicitly import URL from 'node:url'

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^127\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

class FetchError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "FetchError";
  }
}

interface NodeJSError extends Error {
  code?: string;
}

function isNodeError(error: unknown): error is NodeJSError {
  return error instanceof Error && "code" in error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isPrivateIp(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return PRIVATE_IP_RANGES.some((range) => range.test(hostname));
  } catch (_e) {
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    if (isNodeError(error) && error.code === "ABORT_ERR") {
      throw new FetchError(`Request timed out after ${timeout}ms`, "ETIMEDOUT");
    }
    throw new FetchError(getErrorMessage(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

// Register web_fetch tool
server.tool(
  "web_fetch",
  "Fetches and processes content from a specified URL included in the prompt. Supports up to one URL for fetching. If the content is large, it will be truncated, with details on how to read more using 'offset' and 'limit' parameters. Handles HTTP/HTTPS URLs, including GitHub blob URLs (automatically converted to raw URLs).",
  {
    prompt: z
      .string()
      .describe(
        "A prompt containing exactly one URL (http:// or https://) to fetch and optional instructions for processing (e.g., 'Summarize https://example.com/article'). Relative URLs or multiple URLs are not supported."
      ),
    offset: z
      .number()
      .optional()
      .describe(
        "Optional: The 0-based character index to start reading from the fetched content. Requires 'limit' to be set. Use for paginating through large content."
      ),
    limit: z
      .number()
      .optional()
      .describe(
        "Optional: Maximum number of characters to return from the fetched content. Use with 'offset' to paginate through large content. If omitted, returns the entire content (up to a default limit)."
      ),
  },
  async ({ prompt, offset, limit }) => {
    try {
      // Extract URL from prompt
      const urlRegex = /(https?:\/\/[^\s]+)/;
      const match = prompt.match(urlRegex);
      if (!match) {
        throw new Error(
          "Prompt must contain exactly one valid URL starting with http:// or https://"
        );
      }
      let url = match[0];

      // Convert GitHub blob URL to raw URL
      if (url.includes("github.com") && url.includes("/blob/")) {
        url = url
          .replace("github.com", "raw.githubusercontent.com")
          .replace("/blob/", "/");
      }

      // Check for private IP
      if (isPrivateIp(url)) {
        throw new Error("Fetching from private IP addresses is not allowed");
      }

      // Fetch content with timeout
      const fetchTimeoutMs = 10000;
      const response = await fetchWithTimeout(url, fetchTimeoutMs);
      if (!response.ok) {
        throw new Error(
          `Request failed with status code ${response.status} ${response.statusText}`
        );
      }
      const html = await response.text();
      const textContent = convert(html, {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
        ],
      });

      const totalChars = textContent.length;
      let content = textContent;
      let isTruncated = false;
      let startChar = 0;
      let endChar = totalChars - 1;

      // Handle pagination with offset and limit
      if (offset !== undefined && limit !== undefined) {
        startChar = offset;
        endChar = Math.min(offset + limit - 1, totalChars - 1);
        content = textContent.slice(startChar, endChar + 1);
        isTruncated = endChar < totalChars - 1;
      } else if (limit !== undefined) {
        // If only limit is provided, read from start
        endChar = Math.min(limit - 1, totalChars - 1);
        content = textContent.slice(0, endChar + 1);
        isTruncated = endChar < totalChars - 1;
      } else {
        // Check if content is too large (arbitrary limit of 100,000 characters)
        const maxChars = 100000;
        if (totalChars > maxChars) {
          endChar = maxChars - 1;
          content = textContent.slice(0, maxChars);
          isTruncated = true;
        }
      }

      let resultContent = content;

      if (isTruncated) {
        const nextOffset = offset
          ? offset + (endChar - startChar + 1)
          : endChar + 1;
        resultContent = `
IMPORTANT: The content has been truncated.
Status: Showing characters ${startChar + 1}-${
          endChar + 1
        } of ${totalChars} total characters.
Action: To read more of the content, use the 'offset' and 'limit' parameters in a subsequent 'web_fetch' call. For example, use offset: ${nextOffset}.

--- WEB CONTENT (truncated) ---
${content}`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultContent,
          },
          {
            type: "text",
            text: `Source: ${url}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching content: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
        ],
      };
    }
  }
);
