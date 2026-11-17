import { z } from 'zod';

/**
 * Workspace state inputs (PRD Phase 3). All free-text is bounded; node keys
 * are validated against the analysis graph in the controller.
 */

const nodeKeyField = z.string().trim().min(1).max(300);
const filterKind = z.enum(['file', 'class', 'function', 'method']);

export const savedViewStateSchema = z.object({
  level: z.enum(['file', 'symbol']).default('file'),
  searchQuery: z.string().trim().max(300).optional(),
  focusNode: nodeKeyField.optional(),
  isolatedNode: nodeKeyField.optional(),
  highlightedNodes: z.array(nodeKeyField).max(200).default([]),
  filterKinds: z.array(filterKind).max(4).default([]),
});

export const createSavedViewSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    description: z.string().trim().max(300).optional(),
    state: savedViewStateSchema,
    isPinned: z.boolean().default(false),
  }),
};

/**
 * Patch variant without `.default()` values — Zod `.partial()` keeps defaults
 * and would silently reset omitted fields (e.g. wipe highlightedNodes).
 */
export const savedViewStatePatchSchema = z.object({
  level: z.enum(['file', 'symbol']).optional(),
  searchQuery: z.string().trim().max(300).optional(),
  focusNode: nodeKeyField.optional(),
  isolatedNode: nodeKeyField.optional(),
  highlightedNodes: z.array(nodeKeyField).max(200).optional(),
  filterKinds: z.array(filterKind).max(4).optional(),
});

export const updateSavedViewSchema = {
  body: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(300).nullable().optional(),
      state: savedViewStatePatchSchema.optional(),
      isPinned: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
};

export const createPinSchema = {
  body: z.object({
    nodeKey: nodeKeyField,
    note: z.string().trim().max(500).optional(),
  }),
};

export const updatePinSchema = {
  body: z
    .object({
      note: z.string().trim().max(500).nullable().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
};

export const sessionIdParamSchema = {
  params: z.object({
    sessionId: z.string().trim().min(8).max(100),
  }),
};

export const reportQuerySchema = {
  query: z.object({
    format: z.enum(['json', 'markdown']).default('json'),
  }),
};
