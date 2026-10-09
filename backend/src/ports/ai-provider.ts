export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProvider {
  complete(input: {
    messages: AiMessage[];
    maxTokens: number;
    temperature: number;
  }): Promise<string>;
}
