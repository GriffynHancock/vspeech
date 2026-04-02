export type MessageStatus =
  | 'queued' | 'encoding' | 'sending' | 'sent' | 'delivered'
  | 'received' | 'decoding' | 'decoded' | 'undecoded' | 'failed';
export type MessageDirection = 'sent' | 'received';
export type SecurityLevel    = 'low' | 'medium' | 'high';
export type CorpusType       = 'wikipedia' | 'url' | 'local';

export interface Contact {
  id: string; name: string; ip: string; port: number; created_at: string;
  conversation_id?: string; current_key?: string;
  message_count?: number; last_message?: string; last_message_at?: string;
}
export interface Conversation {
  id: string; contact_id: string; current_key: string;
  next_iteration: number; recv_iteration: number;
  security_level: SecurityLevel;
  corpus_type: CorpusType; corpus_source: string;
  created_at: string; updated_at: string;
}
export interface Message {
  id: string; conversation_id: string; direction: MessageDirection;
  plaintext: string | null; token_vector: string | null;
  iteration: number; key_used: string; security_level: SecurityLevel;
  status: MessageStatus; error_message: string | null; created_at: string;
}
export interface SystemInfo {
  myIp: string; advertisedIp: string; port: number;
  engine: { ok: boolean; message: string; python: string };
  version: string; logFile: string;
}
export interface FriendRequest {
  id: string; request_id: string;
  from_name: string; from_ip: string; from_port: number;
  status: string; created_at: string;
}
export interface AppSettings {
  public_ip?: string;
  display_name?: string;
  [key: string]: string | undefined;
}

export type WSEvent =
  | { type: 'message_update';        message: Message;          conversation_id?: string }
  | { type: 'new_message';           message: Message;          conversation_id: string; contact: Contact; corpus_fingerprint?: string }
  | { type: 'new_contact';           contact: Contact }
  | { type: 'contact_update';        contact: Contact }
  | { type: 'conversation_update';   conversation: Conversation }
  | { type: 'friend_request';        request: FriendRequest }
  | { type: 'friend_request_update'; requestId: string; status: string }
  | { type: 'contacts_changed' };
