export interface ChannelSendResult {
  providerMessageId?: string;
  success: boolean;
  error?: string;
}

export interface ChannelAdapter {
  send(to: { phone?: string | null; email?: string | null; memberId: string }, title: string, content: string): Promise<ChannelSendResult>;
}
