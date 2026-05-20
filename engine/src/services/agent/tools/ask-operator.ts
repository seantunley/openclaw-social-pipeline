/**
 * askOperator — a special "tool" the agent calls when it needs a structured
 * choice from the operator. Unlike normal tools it has no `execute` — the
 * runtime detects this tool name, short-circuits, and returns the question +
 * options to the surface (dashboard drawer, telegram bot) which renders
 * them as buttons.
 *
 * Pattern is similar to function-calling for UI: the agent decides WHEN to
 * ask (missing required parameter, multi-platform ambiguity, etc.), the UI
 * decides HOW to render (buttons vs chips vs a select). Operator clicks a
 * button and the value is sent back as their next user message.
 */

import { z } from "zod";

export const askOperatorSchema = z.object({
  question: z
    .string()
    .min(2)
    .max(400)
    .describe("The question to show the operator. Keep it short and direct."),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .min(1)
          .max(80)
          .describe("The text shown on the button (e.g. 'LinkedIn')."),
        value: z
          .string()
          .min(1)
          .max(400)
          .describe(
            "The value sent back as the operator's next message when they tap the button (e.g. 'linkedin' or 'use linkedin and instagram').",
          ),
      }),
    )
    .min(2, "Provide at least 2 options. If there's no real choice, don't ask — just act.")
    .max(8)
    .describe("The buttons to render. 2–8 options."),
  multiSelect: z
    .boolean()
    .optional()
    .describe(
      "When true, the operator can pick multiple options. Selections are sent back as a single message joining the chosen values with ' and '.",
    ),
  allowFreeText: z
    .boolean()
    .optional()
    .describe(
      "When true, the drawer also keeps the textarea active so the operator can type a custom reply instead of using a button.",
    ),
});

export type AskOperatorInput = z.infer<typeof askOperatorSchema>;
