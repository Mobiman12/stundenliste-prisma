export type EntryActionState =
  | {
      status: 'success' | 'error';
      message: string;
    }
  | null;
