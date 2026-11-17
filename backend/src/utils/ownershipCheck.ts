import { Document, Model } from 'mongoose';
import { notFound } from './appError';

/**
 * Ownership guard (blueprint Section 4) — used in every controller that
 * accesses a resource by ID. Always 404, never 403, so we don't confirm
 * that another user's resource exists. All our user-scoped models carry
 * `userId` and the soft-delete flag `isDeleted`.
 */
export async function assertOwnership<T extends Document & { userId: unknown }>(
  ModelClass: Model<T>,
  resourceId: string,
  userId: string
): Promise<T> {
  type FindFilter = Parameters<Model<T>['findOne']>[0];
  const filter = {
    _id: resourceId,
    userId,
    isDeleted: false,
  } as unknown as FindFilter;

  const doc = await ModelClass.findOne(filter);
  if (!doc) {
    throw notFound();
  }
  return doc;
}
