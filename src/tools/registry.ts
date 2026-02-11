import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseToolHandler } from "../handlers/core/BaseToolHandler.js";
import { ALLOWED_EVENT_FIELDS } from "../utils/field-mask-builder.js";

// Import all handlers
import { ListCalendarsHandler } from "../handlers/core/ListCalendarsHandler.js";
import { ListEventsHandler } from "../handlers/core/ListEventsHandler.js";
import { SearchEventsHandler } from "../handlers/core/SearchEventsHandler.js";
import { GetEventHandler } from "../handlers/core/GetEventHandler.js";
import { ListColorsHandler } from "../handlers/core/ListColorsHandler.js";
import { CreateEventHandler } from "../handlers/core/CreateEventHandler.js";
import { UpdateEventHandler } from "../handlers/core/UpdateEventHandler.js";
import { DeleteEventHandler } from "../handlers/core/DeleteEventHandler.js";
import { FreeBusyEventHandler } from "../handlers/core/FreeBusyEventHandler.js";
import { GetCurrentTimeHandler } from "../handlers/core/GetCurrentTimeHandler.js";
import { RespondToEventHandler } from "../handlers/core/RespondToEventHandler.js";
import { SetOutOfOfficeHandler } from "../handlers/core/SetOutOfOfficeHandler.js";
import { SetWorkingLocationHandler } from "../handlers/core/SetWorkingLocationHandler.js";

// Shared datetime validation regex
const ISO8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?$/;
const ISO8601_DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?)?$/;

// Simplified shared schemas with shorter descriptions
const timeMinSchema = z.string()
  .refine((val) => ISO8601_DATETIME.test(val), "ISO 8601 format required")
  .describe("Start boundary (e.g., '2024-01-01T00:00:00')")
  .optional();

const timeMaxSchema = z.string()
  .refine((val) => ISO8601_DATETIME.test(val), "ISO 8601 format required")
  .describe("End boundary (e.g., '2024-01-01T23:59:59')")
  .optional();

const timeZoneSchema = z.string().optional().describe("IANA timezone (e.g., America/Los_Angeles)");

// Generic helper to parse JSON string arrays
const parseJsonStringArray = (val: unknown): unknown => {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      let jsonString = trimmed;
      if (jsonString.includes("'")) {
        jsonString = jsonString
          .replace(/\[\s*'/g, '["')
          .replace(/'\s*,\s*'/g, '", "')
          .replace(/'\s*\]/g, '"]');
      }
      const parsed = JSON.parse(jsonString);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return val;
};

const fieldsSchema = z.preprocess(
  parseJsonStringArray,
  z.array(z.enum(ALLOWED_EVENT_FIELDS))
).optional().describe("Additional fields to retrieve");

const recurrenceSchema = z.preprocess(
  parseJsonStringArray,
  z.array(z.string())
).optional().describe("RFC5545 recurrence rules (e.g., [\"RRULE:FREQ=WEEKLY;COUNT=5\"])");

// Account schemas - simplified descriptions
const accountIdRegex = /^[a-z0-9_-]{1,64}$/;

const parseAccountJsonString = (val: unknown): unknown => {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      let jsonString = trimmed;
      if (jsonString.includes("'")) {
        jsonString = jsonString
          .replace(/\[\s*'/g, '["')
          .replace(/'\s*,\s*'/g, '", "')
          .replace(/'\s*\]/g, '"]');
      }
      const parsed = JSON.parse(jsonString);
      if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string')) return parsed;
    } catch { /* fall through */ }
  }
  return val;
};

const singleAccountSchema = z.string()
  .regex(accountIdRegex)
  .optional()
  .describe("Account nickname (e.g., 'work'). Auto-selects if only one account.");

const multiAccountSchema = z.preprocess(
  parseAccountJsonString,
  z.union([
    z.string().regex(accountIdRegex),
    z.array(z.string().regex(accountIdRegex)).min(1).max(10)
  ])
).optional().describe("Account(s) to query. Omit to query all.");

// Tool Schemas - SIMPLIFIED for reduced token usage
export const ToolSchemas = {
  'list-calendars': z.object({
    account: multiAccountSchema
  }),

  'list-events': z.object({
    account: multiAccountSchema,
    calendarId: z.union([
      z.string(),
      z.array(z.string().min(1)).min(1).max(50)
    ]).describe("Calendar ID(s) or name(s). Use 'primary' for main calendar."),
    timeMin: timeMinSchema,
    timeMax: timeMaxSchema,
    timeZone: timeZoneSchema,
    fields: fieldsSchema
  }),

  'search-events': z.object({
    account: multiAccountSchema,
    calendarId: z.union([z.string(), z.array(z.string())]).transform((val) => {
      if (typeof val === 'string' && val.startsWith('[')) {
        try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch { /* ignore */ }
      }
      return val;
    }).describe("Calendar ID(s) to search"),
    query: z.string().describe("Search text (matches summary, description, location, attendees)"),
    timeMin: z.string().refine((val) => ISO8601_DATETIME.test(val)).describe("Start boundary"),
    timeMax: z.string().refine((val) => ISO8601_DATETIME.test(val)).describe("End boundary"),
    timeZone: timeZoneSchema,
    fields: fieldsSchema
  }),

  'get-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("Calendar ID ('primary' for main)"),
    eventId: z.string().describe("Event ID"),
    fields: fieldsSchema
  }),

  'list-colors': z.object({
    account: singleAccountSchema,
  }),

  // SIMPLIFIED create-event - removed rarely used fields
  'create-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("Calendar ID ('primary' for main)"),
    summary: z.string().describe("Event title"),
    description: z.string().optional().describe("Event description"),
    start: z.string()
      .refine((val) => ISO8601_DATE_OR_DATETIME.test(val), "ISO 8601 format")
      .describe("Start: '2025-01-01T10:00:00' or '2025-01-01' for all-day"),
    end: z.string()
      .refine((val) => ISO8601_DATE_OR_DATETIME.test(val), "ISO 8601 format")
      .describe("End: '2025-01-01T11:00:00' or '2025-01-02' for all-day"),
    timeZone: timeZoneSchema,
    location: z.string().optional().describe("Event location"),
    attendees: z.array(z.object({
      email: z.string().email().describe("Attendee email")
    })).optional().describe("Attendees list"),
    recurrence: recurrenceSchema,
    eventType: z.enum(["default", "focusTime"]).optional().describe("'focusTime' for Focus Time blocks"),
    focusTimeProperties: z.object({
      autoDeclineMode: z.enum(["declineNone", "declineAllConflictingInvitations", "declineOnlyNewConflictingInvitations"]).optional(),
      chatStatus: z.enum(["available", "doNotDisturb"]).optional(),
      declineMessage: z.string().optional()
    }).optional().describe("Focus Time settings (requires Google Workspace)")
  }).refine(
    (data) => {
      if (data.eventType === 'focusTime') {
        const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
        return !dateOnlyRegex.test(data.start) && !dateOnlyRegex.test(data.end);
      }
      return true;
    },
    { message: "Focus Time events cannot be all-day", path: ["eventType"] }
  ),

  // SIMPLIFIED update-event - removed rarely used fields
  'update-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("Calendar ID"),
    eventId: z.string().describe("Event ID to update"),
    summary: z.string().optional().describe("Updated title"),
    description: z.string().optional().describe("Updated description"),
    start: z.string()
      .refine((val) => ISO8601_DATE_OR_DATETIME.test(val), "ISO 8601 format")
      .optional()
      .describe("Updated start time"),
    end: z.string()
      .refine((val) => ISO8601_DATE_OR_DATETIME.test(val), "ISO 8601 format")
      .optional()
      .describe("Updated end time"),
    timeZone: timeZoneSchema,
    location: z.string().optional().describe("Updated location"),
    attendees: z.array(z.object({
      email: z.string().email()
    })).optional().describe("Updated attendees"),
    recurrence: recurrenceSchema,
    sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all").describe("Send notifications"),
    modificationScope: z.enum(["thisAndFollowing", "all", "thisEventOnly"]).optional().describe("Recurring event scope"),
    originalStartTime: z.string()
      .refine((val) => ISO8601_DATETIME.test(val))
      .optional()
      .describe("Original start (required for 'thisEventOnly')"),
    futureStartDate: z.string()
      .refine((val) => ISO8601_DATETIME.test(val))
      .optional()
      .describe("Future start (required for 'thisAndFollowing')")
  }).refine(
    (data) => !(data.modificationScope === 'thisEventOnly' && !data.originalStartTime),
    { message: "originalStartTime is required when modificationScope is 'thisEventOnly'", path: ["originalStartTime"] }
  ).refine(
    (data) => !(data.modificationScope === 'thisAndFollowing' && !data.futureStartDate),
    { message: "futureStartDate is required when modificationScope is 'thisAndFollowing'", path: ["futureStartDate"] }
  ).refine(
    (data) => {
      if (data.futureStartDate) {
        return new Date(data.futureStartDate) > new Date();
      }
      return true;
    },
    { message: "futureStartDate must be in the future", path: ["futureStartDate"] }
  ),

  'delete-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("Calendar ID"),
    eventId: z.string().describe("Event ID to delete"),
    sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all").describe("Send cancellation notices")
  }),

  'get-freebusy': z.object({
    account: multiAccountSchema,
    calendars: z.array(z.object({
      id: z.string().describe("Calendar ID")
    })).describe("Calendars to check"),
    timeMin: z.string().refine((val) => ISO8601_DATETIME.test(val)).describe("Start boundary"),
    timeMax: z.string().refine((val) => ISO8601_DATETIME.test(val)).describe("End boundary"),
    timeZone: timeZoneSchema
  }),

  'get-current-time': z.object({
    account: singleAccountSchema,
    timeZone: z.string().optional().describe("IANA timezone (defaults to calendar timezone)")
  }),

  'respond-to-event': z.object({
    calendarId: z.string().describe("Calendar ID"),
    eventId: z.string().describe("Event ID"),
    account: singleAccountSchema,
    response: z.enum(["accepted", "declined", "tentative", "needsAction"]).describe("Your response"),
    comment: z.string().optional().describe("Optional response message"),
    modificationScope: z.enum(["thisEventOnly", "all"]).optional().describe("For recurring events"),
    originalStartTime: z.string()
      .refine((val) => ISO8601_DATETIME.test(val))
      .optional()
      .describe("Required for 'thisEventOnly'"),
    sendUpdates: z.enum(["all", "externalOnly", "none"]).optional().describe("Send notifications")
  }).refine(
    (data) => !(data.modificationScope === 'thisEventOnly' && !data.originalStartTime),
    { message: "originalStartTime required for 'thisEventOnly'", path: ["originalStartTime"] }
  ),

  'set-out-of-office': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("Calendar ID ('primary' for main)"),
    summary: z.string().optional().default("Out of office").describe("Event title"),
    start: z.string().refine((val) => ISO8601_DATETIME.test(val)).describe("Start time"),
    end: z.string().refine((val) => ISO8601_DATETIME.test(val)).describe("End time"),
    timeZone: timeZoneSchema,
    autoDeclineMode: z.enum(["declineNone", "declineAllConflictingInvitations", "declineOnlyNewConflictingInvitations"])
      .optional().default("declineAllConflictingInvitations").describe("How to handle conflicts"),
    declineMessage: z.string().optional().describe("Message for declined invitations")
  }),

  'set-working-location': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("Calendar ID ('primary' for main)"),
    summary: z.string().optional().describe("Event title (auto-generated if omitted)"),
    start: z.string().refine((val) => ISO8601_DATE_OR_DATETIME.test(val)).describe("Start"),
    end: z.string().refine((val) => ISO8601_DATE_OR_DATETIME.test(val)).describe("End"),
    timeZone: timeZoneSchema,
    locationType: z.enum(["homeOffice", "officeLocation", "customLocation"]).describe("Location type"),
    officeLabel: z.string().optional().describe("Office name (for officeLocation)"),
    customLocationLabel: z.string().optional().describe("Custom location name")
  })
} as const;

// Generate TypeScript types from schemas
export type ToolInputs = {
  [K in keyof typeof ToolSchemas]: z.infer<typeof ToolSchemas[K]>
};

// Export individual types for convenience
export type ListCalendarsInput = ToolInputs['list-calendars'];
export type ListEventsInput = ToolInputs['list-events'];
export type SearchEventsInput = ToolInputs['search-events'];
export type GetEventInput = ToolInputs['get-event'];
export type ListColorsInput = ToolInputs['list-colors'];
export type CreateEventInput = ToolInputs['create-event'];
export type UpdateEventInput = ToolInputs['update-event'];
export type DeleteEventInput = ToolInputs['delete-event'];
export type GetFreeBusyInput = ToolInputs['get-freebusy'];
export type GetCurrentTimeInput = ToolInputs['get-current-time'];
export type RespondToEventInput = ToolInputs['respond-to-event'];
export type SetOutOfOfficeInput = ToolInputs['set-out-of-office'];
export type SetWorkingLocationInput = ToolInputs['set-working-location'];

interface ToolDefinition {
  name: keyof typeof ToolSchemas;
  description: string;
  schema: z.ZodType<any>;
  handler: new () => BaseToolHandler;
  handlerFunction?: (args: any) => Promise<any>;
  customInputSchema?: any;
}


export class ToolRegistry {
  private static extractSchemaShape(schema: z.ZodType<any>): any {
    const schemaAny = schema as any;

    if (schemaAny._def && schemaAny._def.typeName === 'ZodEffects') {
      return this.extractSchemaShape(schemaAny._def.schema);
    }

    if ('shape' in schemaAny) return schemaAny.shape;
    if (schemaAny._def && schemaAny._def.schema) {
      return this.extractSchemaShape(schemaAny._def.schema);
    }

    return schemaAny._def?.schema?.shape || schemaAny.shape;
  }

  // Simplified tool definitions with shorter descriptions
  private static tools: ToolDefinition[] = [
    {
      name: "list-calendars",
      description: "List available calendars",
      schema: ToolSchemas['list-calendars'],
      handler: ListCalendarsHandler
    },
    {
      name: "list-events",
      description: "List events from calendar(s)",
      schema: ToolSchemas['list-events'],
      handler: ListEventsHandler,
      handlerFunction: async (args: ListEventsInput & { calendarId: string | string[] }) => {
        let processedCalendarId: string | string[] = args.calendarId;

        if (Array.isArray(args.calendarId)) {
          processedCalendarId = args.calendarId;
        } else if (typeof args.calendarId === 'string' && args.calendarId.trim().startsWith('[')) {
          try {
            let jsonString = args.calendarId.trim();
            if (jsonString.includes("'")) {
              jsonString = jsonString
                .replace(/\[\s*'/g, '["')
                .replace(/'\s*,\s*'/g, '", "')
                .replace(/'\s*\]/g, '"]');
            }
            const parsed = JSON.parse(jsonString);
            if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string' && id.length > 0)) {
              processedCalendarId = parsed;
            }
          } catch { /* use original */ }
        }

        return {
          account: args.account,
          calendarId: processedCalendarId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          timeZone: args.timeZone,
          fields: args.fields
        };
      }
    },
    {
      name: "search-events",
      description: "Search events by text",
      schema: ToolSchemas['search-events'],
      handler: SearchEventsHandler
    },
    {
      name: "get-event",
      description: "Get event details by ID",
      schema: ToolSchemas['get-event'],
      handler: GetEventHandler
    },
    {
      name: "list-colors",
      description: "List available event colors",
      schema: ToolSchemas['list-colors'],
      handler: ListColorsHandler
    },
    {
      name: "create-event",
      description: "Create calendar event. Supports regular events and Focus Time blocks.",
      schema: ToolSchemas['create-event'],
      handler: CreateEventHandler
    },
    {
      name: "update-event",
      description: "Update calendar event with recurring event support",
      schema: ToolSchemas['update-event'],
      handler: UpdateEventHandler
    },
    {
      name: "delete-event",
      description: "Delete calendar event",
      schema: ToolSchemas['delete-event'],
      handler: DeleteEventHandler
    },
    {
      name: "get-freebusy",
      description: "Query free/busy for calendars (max 3 month range)",
      schema: ToolSchemas['get-freebusy'],
      handler: FreeBusyEventHandler
    },
    {
      name: "get-current-time",
      description: "Get current date/time. Call FIRST before creating/searching events.",
      schema: ToolSchemas['get-current-time'],
      handler: GetCurrentTimeHandler
    },
    {
      name: "respond-to-event",
      description: "Respond to event invitation (accept/decline/tentative)",
      schema: ToolSchemas['respond-to-event'],
      handler: RespondToEventHandler
    },
    {
      name: "set-out-of-office",
      description: "Set Out of Office with auto-decline (requires Google Workspace)",
      schema: ToolSchemas['set-out-of-office'],
      handler: SetOutOfOfficeHandler
    },
    {
      name: "set-working-location",
      description: "Set working location (requires Google Workspace)",
      schema: ToolSchemas['set-working-location'],
      handler: SetWorkingLocationHandler
    }
  ];

  static getToolsWithSchemas() {
    return this.tools.map(tool => {
      const jsonSchema = tool.customInputSchema
        ? zodToJsonSchema(z.object(tool.customInputSchema))
        : zodToJsonSchema(tool.schema);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema
      };
    });
  }

  private static normalizeDateTimeFields(toolName: string, args: any): any {
    const toolsWithDateTime = ['create-event', 'update-event', 'set-out-of-office', 'set-working-location'];
    if (!toolsWithDateTime.includes(toolName)) return args;

    const normalized = { ...args };
    const dateTimeFields = ['start', 'end', 'originalStartTime', 'futureStartDate'];

    for (const field of dateTimeFields) {
      if (normalized[field] && typeof normalized[field] === 'object') {
        const obj = normalized[field];
        if (obj.date) normalized[field] = obj.date;
        else if (obj.dateTime) normalized[field] = obj.dateTime;
      }
    }

    return normalized;
  }

  static async registerAll(
    server: McpServer,
    executeWithHandler: (
      handler: any,
      args: any
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>
  ) {
    for (const tool of this.tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.customInputSchema || this.extractSchemaShape(tool.schema)
        },
        async (args: any) => {
          const normalizedArgs = this.normalizeDateTimeFields(tool.name, args);
          const validatedArgs = tool.schema.parse(normalizedArgs);
          const processedArgs = tool.handlerFunction ? await tool.handlerFunction(validatedArgs) : validatedArgs;
          const handler = new tool.handler();
          return executeWithHandler(handler, processedArgs);
        }
      );
    }
  }
}
