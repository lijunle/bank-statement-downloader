export type AccountType =
  | "Checking"
  | "Savings"
  | "CreditCard"
  | "Loan"
  | "Investment";

export type Profile = {
  /** Session ID */
  sessionId: string;

  /** Profile ID */
  profileId: string;

  /** Profile name */
  profileName: string;
};

export type Account = {
  /** Profile this account belongs to */
  profile: Profile;

  /** Account ID */
  accountId: string;

  /** Account name */
  accountName: string;

  /** The last 4 digits of the account number (last 5 for American Express) */
  accountMask: string;

  /** Account type */
  accountType: AccountType;
};

export type Statement = {
  /** The account this statement belongs to */
  account: Account;

  /** Statement ID */
  statementId: string;

  /** Statement date (ISO 8601 string format) */
  statementDate: string;
};

/** Bank identifier. This should be a unique string for each bank. Example, 'chase' for Chase bank. */
export declare const bankId: string;

/** Bank name. The human-readable name of the bank. Example, 'Chase' for Chase bank. */
export declare const bankName: string;

/** Get the current session ID */
export declare function getSessionId(): string;

/** Get the current profile */
export declare function getProfile(sessionId: string): Promise<Profile>;

/** Get accounts for the bank */
export declare function getAccounts(profile: Profile): Promise<Account[]>;

/** Get statements for an account */
export declare function getStatements(account: Account): Promise<Statement[]>;

/** Download a statement */
export declare function downloadStatement(statement: Statement): Promise<Blob>;
