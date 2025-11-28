import type { Account, Statement } from "../bank/bank.types";

/**
 * Map message action to request and response data types
 */
export type MessageDataMap = {
  getBankId: {
    request: {};
    response: string;
  };
  getBankName: {
    request: {};
    response: string;
  };
  getSessionId: {
    request: {};
    response: string;
  };
  getAccounts: {
    request: { forceRefresh?: boolean };
    response: Account[];
  };
  getStatements: {
    request: { account: Account };
    response: Statement[];
  };
  downloadStatement: {
    request: { statement: Statement };
    response: string;
  };
  clearCache: {
    request: {};
    response: null;
  };
};

/**
 * Action keys for messages
 */
export type MessageAction = keyof MessageDataMap;

/**
 * Union of all possible messages sent from popup to content script
 */
export type ContentMessage = {
  [K in MessageAction]: {
    action: K;
  } & MessageDataMap[K]["request"];
}[MessageAction];

/**
 * Generic success response type
 */
export type SuccessResponse<A extends MessageAction> = {
  action: A;
  data: MessageDataMap[A]["response"];
};

/**
 * Error response from content script
 */
export interface ErrorResponse {
  action: "error";
  error: string;
}

/**
 * Union of all possible responses from content script
 */
export type MessageResponse = SuccessResponse<MessageAction> | ErrorResponse;

/**
 * Request fetch message sent from content script to popup
 * Used for cross-domain requests that need to bypass CORS
 */
export type RequestFetchMessage = {
  action: "requestFetch";
  url: string;
  options?: {
    method?: string;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  };
};

/**
 * Success response to requestFetch message
 */
export type RequestFetchSuccessResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

/**
 * Error response to requestFetch message
 */
export type RequestFetchErrorResponse = {
  error: string;
};

/**
 * Response to requestFetch message
 * Contains the fetch response data or error
 */
export type RequestFetchResponse =
  | RequestFetchSuccessResponse
  | RequestFetchErrorResponse;

/**
 * Union of all messages that can be sent to the background worker
 * Includes both ContentMessage (from popup) and RequestFetchMessage (from content script)
 */
export type BackgroundMessage = ContentMessage | RequestFetchMessage;

/**
 * Success response from background worker to popup
 */
export interface BackgroundSuccessResponse<T = any> {
  success: true;
  data: T;
}

/**
 * Error response from background worker to popup
 */
export interface BackgroundErrorResponse {
  success: false;
  error: string;
}

/**
 * Union of all possible responses from background worker
 * For ContentMessage requests, returns BackgroundSuccessResponse or BackgroundErrorResponse
 * For RequestFetchMessage requests, returns RequestFetchSuccessResponse or RequestFetchErrorResponse
 */
export type BackgroundResponse =
  | BackgroundSuccessResponse
  | BackgroundErrorResponse
  | RequestFetchSuccessResponse
  | RequestFetchErrorResponse;
