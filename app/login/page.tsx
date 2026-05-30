import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — UW Degree Planner",
};

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto bg-zinc-50 px-6 py-8 dark:bg-zinc-950">
      <div className="my-auto w-full max-w-sm">
        <div className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-lg shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          <LoginForm />
        </div>
        <p className="mt-5 text-center text-xs text-zinc-400 dark:text-zinc-500">
          Plan every term of your UWaterloo degree on one screen.
        </p>
      </div>
    </div>
  );
}
