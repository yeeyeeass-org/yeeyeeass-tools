import z from "zod";
import { server } from "../index.js";

// Register weather tools
server.tool(
  "write_helloworld",
  "write_helloworld",
  {
    number: z.number().min(0).describe("A number representing the state"),
  },
  async ({ number }) => {
    let alertsText = "";

    for(let i = 0; i < number; i++) {
      alertsText += `Hello, World! ${i + 1}\n`;
    }

    console.log(alertsText);

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  },
);