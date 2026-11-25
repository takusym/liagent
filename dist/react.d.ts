import { I as ChatOptions, P as Chat, R as ChatState } from "./box-DQExMXJa.js";
import { HubOptions } from "./client.js";
import { n as DraftOptions, r as DraftState, t as Draft } from "./draft-joi5pxvH.js";

//#region src/react.d.ts
/** The chat's state, or a slice of it; re-renders when that changes. */
declare function useChatState(chat: Chat): ChatState;
declare function useChatState<T>(chat: Chat, select: (s: ChatState) => T): T;
type UseHubChatOptions = HubOptions & Pick<ChatOptions, "requireActivation"> & {
  /** Read the agent's live replies aloud through this (liagent/voice's voice()). */voice?: {
    speak(text: string, id?: string): void;
  } | null;
};
/** A chat on the hub's page socket, for this component's life. */
declare function useHubChat(opts: UseHubChatOptions): Chat;
/**
 * The draft for `chat` (src/draft.ts): its state, the controller, and a ref
 * that wires a <textarea> or <input> to it.
 */
declare function useDraft(chat: Chat, opts?: Omit<DraftOptions, "send"> & {
  to?: string;
}): {
  state: DraftState;
  draft: Draft;
  ref: (el: HTMLTextAreaElement | HTMLInputElement | null) => void;
};
//#endregion
export { UseHubChatOptions, useChatState, useDraft, useHubChat };
//# sourceMappingURL=react.d.ts.map