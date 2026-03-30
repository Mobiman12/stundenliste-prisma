export type ReminderFormState = {
  status?: 'success' | 'error';
  message?: string;
  unknownKeys?: string[];
  settings?: {
    enabled: boolean;
    sendHour: number;
    subject: string;
    contentTemplate: string;
  };
  nextRun?: string;
};

export type ReminderTestState = {
  status?: 'success' | 'error';
  message?: string;
};
