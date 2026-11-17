import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memory: MongoMemoryServer | null = null;

export async function startTestDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('repoverse-test'));
}

export async function stopTestDB(): Promise<void> {
  await mongoose.disconnect();
  if (memory) {
    await memory.stop();
    memory = null;
  }
}
