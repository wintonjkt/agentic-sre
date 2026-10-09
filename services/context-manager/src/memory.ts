import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export class MemoryStore {
  private static getKey(sessionId: string): string {
    return `chat:session:${sessionId}:history`;
  }

  static async getHistory(sessionId: string, limit = 20): Promise<ChatMessage[]> {
    const key = this.getKey(sessionId);
    const rawMessages = await redis.lrange(key, -limit, -1);
    return rawMessages.map((msg) => JSON.parse(msg) as ChatMessage);
  }

  static async appendMessage(sessionId: string, message: ChatMessage, ttlSeconds = 86400): Promise<void> {
    const key = this.getKey(sessionId);
    await redis.rpush(key, JSON.stringify(message));
    await redis.expire(key, ttlSeconds);
  }

  static async eraseMemory(sessionId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    const deleted = await redis.del(key);
    return deleted > 0;
  }
}
