// Minimal type declarations for the africastalking package.
// The package itself ships without TypeScript types.

declare module 'africastalking' {
  interface SmsRecipient {
    status: string;
    messageId?: string;
    number: string;
    cost?: string;
  }

  interface SmsSendResult {
    SMSMessageData: {
      Message: string;
      Recipients: SmsRecipient[];
    };
  }

  interface SmsOptions {
    to: string[];
    message: string;
    from?: string;
    enqueue?: boolean;
  }

  interface SmsClient {
    send(options: SmsOptions): Promise<SmsSendResult>;
  }

  interface AfricasTalkingOptions {
    username: string;
    apiKey: string;
  }

  interface AfricasTalkingClient {
    SMS: SmsClient;
  }

  function AfricasTalking(options: AfricasTalkingOptions): AfricasTalkingClient;

  export default AfricasTalking;
}