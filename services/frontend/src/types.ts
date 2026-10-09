export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  lastUpdated: number;
}

export interface BobConfig {
  mode: 'agent' | 'code' | 'ask' | 'plan' | 'advanced';
  approvalMode: 'default' | 'yolo';
  systemInstruction: string;
}
