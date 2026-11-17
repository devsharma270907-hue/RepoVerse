import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from './env';
import { logger } from '../utils/logger';

let memoryServer: MongoMemoryServer | null = null;

export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);

  // Dev/test convenience: spin up an in-memory MongoDB instead of Atlas/local.
  // Never use in production (env validation rejects it there by convention).
  if (env.USE_MEMORY_DB) {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('repoverse'));
  } else {
    await mongoose.connect(env.MONGODB_URI);
  }

  logger.info(`✅ MongoDB connected: ${mongoose.connection.name}`);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  logger.info('MongoDB disconnected');
}
