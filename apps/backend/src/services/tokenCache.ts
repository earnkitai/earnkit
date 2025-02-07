import { LRUCache } from 'lru-cache';

const tokenCache = new LRUCache<string, boolean>({
  max: 5, // Store up to 100 tokens
  ttl: 60 * 60 * 1000, // 1-hour TTL (optional)
});

export default tokenCache;
