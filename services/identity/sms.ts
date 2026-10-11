import { ApiError } from "../../packages/shared-config/runtime.ts";
import { local } from "./security.ts";
export interface SmsAdapter {
  send(phone: string, code: string): Promise<void>;
}
export const sms: SmsAdapter = {
  async send(phone, code) {
    if (local) return; // Caller returns a conspicuous local-only delivery field; never logs a code.
    if (!process.env.SMS_ADAPTER_URL || !process.env.SMS_ADAPTER_TOKEN)
      throw new ApiError(
        503,
        "SMS_NOT_CONFIGURED",
        "SMS sign-in is not available yet.",
      );
    if (!process.env.SMS_ADAPTER_URL.startsWith("https://"))
      throw new Error("SMS adapter must use HTTPS");
    const response = await fetch(process.env.SMS_ADAPTER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SMS_ADAPTER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ to: phone, template: "raahi_sign_in", code }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new ApiError(
        503,
        "SMS_UNAVAILABLE",
        "The code could not be delivered. Please retry later.",
      );
  },
};
