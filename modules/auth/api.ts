import { post } from "@/shared/api/client";
import type { StaffSession } from "@/shared/types/api";
import type { Customer, PlatformAdmin, Rider } from "@/shared/types/entities";

/** Auth module: one function per login endpoint (POST /auth/...). */
export const authApi = {
  email: (email: string) => post<{ token: string; customer: Customer; needs_profile: boolean }>("/auth/email", { email }),
  google: (b: { email?: string; name?: string; google_id?: string; credential?: string }) => post<{ token: string; customer: Customer; needs_profile: boolean }>("/auth/google", b),
  sendOtp: (phone: string) => post<{ sent: boolean; demo_otp?: string }>("/auth/otp/send", { phone }),
  verifyOtp: (phone: string, otp: string) => post<{ token: string | null; customer: Customer; claimed: boolean; needs_profile: boolean }>("/auth/otp/verify", { phone, otp }, { auth: "customer" }),
  phoneLogin: (phone: string, otp: string, name?: string) => post<{ token: string; customer: Customer; needs_profile: boolean }>("/auth/phone", { phone, otp, name }),
  pin: (employee_code: string, pin: string) => post<StaffSession & { token: string }>("/auth/pin", { employee_code, pin }),
  /** First sign-in without a PIN: a code goes to the employee's mobile, then they choose a PIN. */
  pinCode: (employee_code: string) => post<{ sent: boolean; phone_hint: string | null; demo_otp?: string }>("/auth/pin/code", { employee_code }),
  pinSetup: (employee_code: string, otp: string, pin: string) => post<StaffSession & { token: string }>("/auth/pin/setup", { employee_code, otp, pin }),
  approve: (b: { pin: string; kind?: string; amount?: number }) => post<{ approver_id: string; approver_name: string; role: string }>("/auth/approve", b, { auth: "staff" }),
  rider: (phone: string, otp: string) => post<{ token: string; rider: Rider }>("/auth/rider", { phone, otp }),
  control: (email: string, otp: string) => post<{ token: string; admin: PlatformAdmin }>("/control/auth", { email, otp }),
};
