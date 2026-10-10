export type ChatMessage = {
  id: string; // crypto.randomUUID()
  from: string; // display name
  fromId: string; // peer id (or 'host')
  senderId?: string; // stable client ID
  text: string; // max 500 chars, trimmed
  ts: number; // Date.now(), set by the host
  kind: 'user' | 'system';
};
